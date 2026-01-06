"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Session = { username: string; role: "MASTER" | "USER" };

type Empresa = { id: string; razaoSocial: string; grupo?: string };
type Obra = { id: string; empresaId: string; nome: string };

type Unidade = {
  id: string;
  empresaId: string;
  obraId: string;

  compradorNome?: string;
  cpfCnpjDigits?: string;
  valorVenda?: number;
  dataVenda?: string;

  percentualCusto?: number; // 0..100 ou 0..1 (até 7 casas)
  tipoCusto?: string;

  criadoEm: string;
  atualizadoEm?: string;
};

type QuadroUnidade = {
  unidadeId: string; // 4 dígitos
  percentual: number; // até 7 casas (pode ser 0..100 ou 0..1)
  tipo: string | undefined; // ✅ agora é obrigatório (mas pode ser undefined)
  cor: string | undefined;  // recomendo também padronizar assim
  isEspecial?: boolean;
};

type CustoMensal = {
  id: string;
  competencia: string; // mm/aaaa
  valor: number;
  criadoEm: string;
};

type QuadroCustos = {
  id: string;
  empresaId: string;
  obraId: string;
  criadoEm: string;
  atualizadoEm: string;

  unidades: QuadroUnidade[];

  valorTerreno: number;
  custosMensais: CustoMensal[];
};

const STORAGE_EMPRESAS = "ci_empresas";
const STORAGE_OBRAS = "ci_obras";
const STORAGE_UNIDADES = "ci_unidades";
const STORAGE_CUSTOS = "ci_quadro_custos";

function onlyDigits(v: string | undefined | null) {
  return String(v ?? "").replace(/\D/g, "");
}
function pad4(v: string | undefined | null) {
  const d = onlyDigits(v).slice(0, 4);
  return d.padStart(4, "0");
}
function uuid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}
function moneyBR(v: number) {
  const vv = Number(v ?? 0);
  try {
    return vv.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  } catch {
    return `R$ ${vv.toFixed(2)}`;
  }
}
function loadJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function saveJson<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}
function parseMoneyInput(s: string) {
  const t = String(s ?? "").trim();
  if (!t) return 0;
  const normalized = t.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

// ✅ percentual/peso: aceita vírgula e força 7 casas
function parsePercentInput(s: string) {
  const t = String(s ?? "").trim();
  if (!t) return 0;
  const cleaned = t.replace(/\s/g, "");
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(7));
}
function percentBR(p: number) {
  const n = Number(p ?? 0);
  return n.toFixed(7).replace(".", ","); // sempre 7 casas
}
function fmt7(n: number) {
  return Number(Number(n || 0).toFixed(7));
}
function isClose(a: number, b: number, tol = 0.0000005) {
  return Math.abs(a - b) <= tol;
}
function inferTarget(sum: number) {
  const d100 = Math.abs(100 - sum);
  const d1 = Math.abs(1 - sum);
  return d1 <= d100 ? 1 : 100;
}

function competenciaMask(raw: string) {
  const d = onlyDigits(raw).slice(0, 6);
  const mm = d.slice(0, 2);
  const yy = d.slice(2, 6);
  let out = "";
  if (mm) out += mm;
  if (d.length > 2) out += "/";
  if (yy) out += yy;
  return out;
}
function normalizeCompetencia(raw: string) {
  const d = onlyDigits(raw).slice(0, 6);
  if (!d) return "";
  const mmRaw = d.slice(0, 2);
  const yyRaw = d.slice(2);

  const mm = mmRaw.length === 1 ? `0${mmRaw}` : mmRaw.padEnd(2, "0");
  let yyyy = String(new Date().getFullYear());
  if (yyRaw.length === 1) yyyy = "200" + yyRaw;
  else if (yyRaw.length === 2) yyyy = "20" + yyRaw;
  else if (yyRaw.length === 3) yyyy = "2" + yyRaw;
  else if (yyRaw.length >= 4) yyyy = yyRaw.slice(0, 4);

  return `${mm}/${yyyy}`;
}
function isValidCompetencia(s: string) {
  const m = String(s ?? "").match(/^(\d{2})\/(\d{4})$/);
  if (!m) return false;
  const mm = Number(m[1]);
  const yyyy = Number(m[2]);
  if (!(mm >= 1 && mm <= 12)) return false;
  if (!(yyyy >= 1900 && yyyy <= 2200)) return false;
  return true;
}
function chaveEO(empresaId: string, obraId: string) {
  return `${pad4(empresaId)}-${pad4(obraId)}`;
}

// ✅ ORDEM POR ANDAR e depois FINAL
// unidade = (andar*10 + final). Ex: 11..17, 21..27 ... 141..147; térreo 04..07 é andar=0 final=4..7
function parseFloorFinal(unidadeId: string) {
  const n = Number(onlyDigits(unidadeId) || "0");
  const floor = Math.floor(n / 10);
  const final = n % 10;
  return { n, floor, final };
}
function compareUnidade(a: string, b: string) {
  const A = parseFloorFinal(a);
  const B = parseFloorFinal(b);
  if (A.floor !== B.floor) return A.floor - B.floor; // 0,1,2...14
  if (A.final !== B.final) return A.final - B.final; // 1..7 (ou 4..7 no térreo)
  return A.n - B.n;
}

function textColorForBg(hex: string) {
  const h = String(hex || "").trim();
  if (!h) return "#111";
  if (h.startsWith("hsl(")) return "#fff";
  let x = h.replace("#", "");
  if (x.length === 3) x = x.split("").map((c) => c + c).join("");
  if (x.length !== 6) return "#111";
  const r = parseInt(x.slice(0, 2), 16);
  const g = parseInt(x.slice(2, 4), 16);
  const b = parseInt(x.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? "#111" : "#fff";
}

const PALETTE = [
  "#0b4fd6",
  "#00a37a",
  "#b00020",
  "#ff8c00",
  "#6a5acd",
  "#008b8b",
  "#c2185b",
  "#2e7d32",
  "#1565c0",
  "#6d4c41",
];

const SPECIAL_PALETTE = [
  "#7b1fa2",
  "#d81b60",
  "#00897b",
  "#f4511e",
  "#3949ab",
  "#c0ca33",
  "#5d4037",
  "#039be5",
  "#8e24aa",
  "#43a047",
  "#fb8c00",
  "#546e7a",
];

function nextSpecialColor(used: Set<string>) {
  for (const c of SPECIAL_PALETTE) {
    const cc = c.toLowerCase();
    if (!used.has(cc)) return c;
  }
  for (let i = 0; i < 60; i++) {
    const hue = (i * 37) % 360;
    const c = `hsl(${hue} 70% 45%)`;
    const key = c.toLowerCase();
    if (!used.has(key)) return c;
  }
  return "#111111";
}

// ✅ parse “colar lista”: aceita "04-0,0081000", "04 0,0081000", etc
function parsePasteList(text: string): Array<{ unidadeId: string; percentual: number }> {
  const lines = String(text ?? "")
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter(Boolean);

  const out: Array<{ unidadeId: string; percentual: number }> = [];

  for (const line of lines) {
    const mUn = line.match(/(^|\D)(\d{1,4})(\D|$)/);
    if (!mUn) continue;
    const unidadeId = pad4(mUn[2]);

    const mVal =
      line.replace(mUn[2], " ").match(/-?\d+[.,]\d+/) ||
      line.replace(mUn[2], " ").match(/-?\d+(?:[.,]\d+)?/);

    if (!mVal) continue;

    const percentual = fmt7(parsePercentInput(mVal[0]));
    if (!(percentual > 0)) continue;

    out.push({ unidadeId, percentual });
  }

  // dedup: último ganha
  const map = new Map<string, { unidadeId: string; percentual: number }>();
  for (const it of out) map.set(it.unidadeId, it);
  return Array.from(map.values());
}

// ✅ rateio que fecha centavos exatamente no total (proporcional ao peso)
function allocateCents(totalReais: number, weights: number[]) {
  const totalCents = Math.round(Number(totalReais || 0) * 100);
  const w = weights.map((x) => Math.max(0, Number(x || 0)));
  const sumW = w.reduce((s, x) => s + x, 0);

  if (totalCents === 0) return w.map(() => 0);
  if (sumW <= 0) {
    const out = w.map(() => 0);
    out[out.length - 1] = totalCents;
    return out;
  }

  const raw = w.map((x) => (totalCents * x) / sumW);
  const floors = raw.map((x) => Math.floor(x));
  let used = floors.reduce((s, x) => s + x, 0);

  let rest = totalCents - used;
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);

  const out = floors.slice();
  let k = 0;
  while (rest > 0 && order.length > 0) {
    out[order[k].i] += 1;
    rest -= 1;
    k = (k + 1) % order.length;
  }
  return out;
}

export default function CustosPage() {
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [obras, setObras] = useState<Obra[]>([]);
  const [unidades, setUnidades] = useState<Unidade[]>([]);

  const [empresaSel, setEmpresaSel] = useState("");
  const [obraSel, setObraSel] = useState("");

  const [quadro, setQuadro] = useState<QuadroCustos | null>(null);

  const [showConfig, setShowConfig] = useState(false);

  // ✅ AVISO dentro do modal (melhoria 1)
  const [configNotice, setConfigNotice] = useState<string>("");

  // PRINCIPAIS: geradas por andares+finais OU coladas
  const [draftLinhas, setDraftLinhas] = useState<QuadroUnidade[]>([]);
  // ESPECIAIS: override (térreo/lojas/etc)
  const [especiais, setEspeciais] = useState<QuadroUnidade[]>([]);

  // colar listas
  const [pastePrincipal, setPastePrincipal] = useState("");
  const [pasteEspeciais, setPasteEspeciais] = useState("");

  // ✅ GERADOR ANDARES + FINAIS
  const [andarIni, setAndarIni] = useState("1");
  const [andarFim, setAndarFim] = useState("14");
  const [finaisStr, setFinaisStr] = useState("1,2,3,4,5,6,7");
  const [pesosPorFinal, setPesosPorFinal] = useState<Record<string, string>>({
    "1": "0,0112520",
    "2": "0,0073470",
    "3": "0,0093400",
    "4": "0,0077850",
    "5": "0,0108000",
    "6": "0,0107720",
    "7": "0,0106360",
  });

  const [valorTerrenoInput, setValorTerrenoInput] = useState("");
  const [compInput, setCompInput] = useState("");
  const [custoInput, setCustoInput] = useState("");

  const [editMesId, setEditMesId] = useState<string | null>(null);
  const [editMesValor, setEditMesValor] = useState<string>("");

  const isMaster = session?.role === "MASTER";

  useEffect(() => {
    const raw = localStorage.getItem("ci_session");
    if (!raw) {
      router.replace("/login");
      return;
    }
    try {
      setSession(JSON.parse(raw) as Session);
    } catch {
      localStorage.removeItem("ci_session");
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    const emps = loadJson<Empresa[]>(STORAGE_EMPRESAS, []).map((e) => ({
      ...e,
      id: pad4(e.id),
      grupo: e.grupo ? pad4(e.grupo) : undefined,
    }));
    const obs = loadJson<Obra[]>(STORAGE_OBRAS, []).map((o) => ({
      ...o,
      id: pad4(o.id),
      empresaId: pad4(o.empresaId),
    }));
    const uns = loadJson<any[]>(STORAGE_UNIDADES, []).map((u) => ({
      ...u,
      id: pad4(u?.id),
      empresaId: pad4(u?.empresaId),
      obraId: pad4(u?.obraId),
      compradorNome: u?.compradorNome ?? "",
      valorVenda: Number(u?.valorVenda ?? 0),
      percentualCusto: typeof u?.percentualCusto === "number" ? Number(u.percentualCusto) : undefined,
      tipoCusto: u?.tipoCusto ?? undefined,
    })) as Unidade[];

    setEmpresas(emps);
    setObras(obs);
    setUnidades(uns);
  }, []);

  const empresaAtual = useMemo(() => empresas.find((e) => e.id === pad4(empresaSel)) || null, [empresas, empresaSel]);

  const obrasDaEmpresa = useMemo(() => {
    const emp = pad4(empresaSel);
    return obras.filter((o) => o.empresaId === emp).sort((a, b) => a.id.localeCompare(b.id));
  }, [obras, empresaSel]);

  const obraAtual = useMemo(
    () => obras.find((o) => o.empresaId === pad4(empresaSel) && o.id === pad4(obraSel)) || null,
    [obras, empresaSel, obraSel]
  );

  useEffect(() => {
    if (!empresaSel || !obraSel) {
      setQuadro(null);
      setValorTerrenoInput("");
      return;
    }
    const all = loadJson<Record<string, QuadroCustos>>(STORAGE_CUSTOS, {});
    const key = chaveEO(empresaSel, obraSel);
    const q = all[key] ?? null;
    setQuadro(q);

    if (q) {
      setValorTerrenoInput(
        q.valorTerreno > 0 ? q.valorTerreno.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""
      );
    } else {
      setValorTerrenoInput("");
    }
  }, [empresaSel, obraSel]);

  function abrirConfig() {
    if (!isMaster) return alert("Somente Master pode processar o Quadro de Custos.");
    if (!empresaAtual || !obraAtual) return alert("Selecione Empresa e Obra.");

    setConfigNotice("");

    if (quadro?.unidades?.length) {
      setDraftLinhas(
        quadro.unidades
          .map((u) => ({ ...u, unidadeId: pad4(u.unidadeId), percentual: fmt7(u.percentual), isEspecial: !!u.isEspecial }))
          .sort((a, b) => compareUnidade(a.unidadeId, b.unidadeId))
      );
      setEspeciais([]);
      setPasteEspeciais("");
      setPastePrincipal("");
    } else {
      setDraftLinhas([]);
      setEspeciais([]);
      setPasteEspeciais("");
      setPastePrincipal("");
    }

    setShowConfig(true);
  }

  // ✅ MELHORIA 1: apagar e já manter modal aberto com aviso e drafts limpos
  function apagarQuadro() {
    if (!isMaster) return alert("Somente Master pode apagar.");
    if (!empresaAtual || !obraAtual) return alert("Selecione Empresa e Obra.");
    if (!confirm("Apagar o quadro desta obra? (Terreno e lançamentos do mês também serão apagados)")) return;

    const all = loadJson<Record<string, QuadroCustos>>(STORAGE_CUSTOS, {});
    const key = chaveEO(empresaAtual.id, obraAtual.id);
    if (all[key]) {
      delete all[key];
      saveJson(STORAGE_CUSTOS, all);
    }

    setQuadro(null);

    // limpa drafts e mantém modal aberto para refazer
    setDraftLinhas([]);
    setEspeciais([]);
    setPastePrincipal("");
    setPasteEspeciais("");
    setShowConfig(true);

    setConfigNotice(
      "Quadro apagado. Agora clique em “Gerar” (ou cole lista) e depois em “Processar”. Se preferir, use “Gerar + Processar (rápido)”."
    );
  }

  function importarPrincipais() {
    const parsed = parsePasteList(pastePrincipal);
    if (!parsed.length) return alert("Não encontrei linhas válidas. Cole: unidade valor (uma por linha).");

    const linhas: QuadroUnidade[] = parsed
      .map((it) => ({
        unidadeId: pad4(it.unidadeId),
        percentual: fmt7(it.percentual),
        tipo: "Principal",
        cor: "",
        isEspecial: false,
      }))
      .sort((a, b) => compareUnidade(a.unidadeId, b.unidadeId));

    setDraftLinhas(linhas);
    setPastePrincipal("");
    alert(`Importado como PRINCIPAL: ${linhas.length} unidade(s).`);
  }

  function importarEspeciais() {
    const parsed = parsePasteList(pasteEspeciais);
    if (!parsed.length) return alert("Não encontrei linhas válidas. Cole: unidade valor (uma por linha).");

    // cores especiais nunca repetem as principais
    const used = new Set<string>();
    for (const b of draftLinhas) {
      const c = String(b.cor || "").trim().toLowerCase();
      if (c) used.add(c);
    }
    for (const sp of especiais) {
      const c = String(sp.cor || "").trim().toLowerCase();
      if (c) used.add(c);
    }

    const next: QuadroUnidade[] = [];
    for (const it of parsed) {
      const cor = nextSpecialColor(used);
      used.add(String(cor).toLowerCase());
      next.push({
        unidadeId: pad4(it.unidadeId),
        percentual: fmt7(it.percentual),
        tipo: "Especial",
        cor,
        isEspecial: true,
      });
    }

    // merge especiais (último ganha)
    const map = new Map<string, QuadroUnidade>();
    for (const sp of especiais) map.set(pad4(sp.unidadeId), { ...sp, unidadeId: pad4(sp.unidadeId), percentual: fmt7(sp.percentual) });
    for (const sp of next) map.set(pad4(sp.unidadeId), sp);

    const merged = Array.from(map.values()).sort((a, b) => compareUnidade(a.unidadeId, b.unidadeId));
    setEspeciais(merged);
    setPasteEspeciais("");
  }

  // ✅ cores automáticas por PESO nas principais (mesmo peso => mesma cor)
  function applyAutoColorsByPercent(base: QuadroUnidade[], especiaisIds: Set<string>) {
    const map = new Map<string, string>(); // peso(7 casas) -> cor
    let idx = 0;

    const pick = () => {
      const c = PALETTE[idx % PALETTE.length];
      idx++;
      return c;
    };

    return base.map((u) => {
      const id = pad4(u.unidadeId);
      if (especiaisIds.has(id)) return u; // especiais já tem cor própria
      const key = percentBR(Number(u.percentual || 0));
      let cor = map.get(key);
      if (!cor) {
        cor = pick();
        map.set(key, cor);
      }
      return { ...u, cor, isEspecial: false };
    });
  }

  // ✅ Helper: monta as linhas sem depender do setState (para “Gerar + Processar”)
  function buildAndaresFinaisLinhas(): { linhas: QuadroUnidade[]; finais: number[]; ini: number; fim: number } {
    const ini = Math.max(0, Number(onlyDigits(andarIni) || "0"));
    const fim = Math.max(0, Number(onlyDigits(andarFim) || "0"));
    if (fim < ini) throw new Error("Andar final deve ser >= andar inicial.");

    const finais = String(finaisStr)
      .split(",")
      .map((s) => onlyDigits(s))
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => n >= 0 && n <= 9);

    if (!finais.length) throw new Error("Informe os finais. Ex: 1,2,3,4,5,6,7");

    const finalPeso = new Map<number, number>();
    for (const f of finais) {
      const raw = pesosPorFinal[String(f)] ?? "";
      const v = fmt7(parsePercentInput(raw));
      if (!(v > 0)) throw new Error(`Peso inválido no final ${f}.`);
      finalPeso.set(f, v);
    }

    const linhas: QuadroUnidade[] = [];
    for (let andar = ini; andar <= fim; andar++) {
      for (const f of finais) {
        const unidadeN = andar * 10 + f; // 11,12... 141,142...
        linhas.push({
          unidadeId: pad4(String(unidadeN)),
          percentual: finalPeso.get(f)!,
          tipo: `Final ${f}`,
          cor: "",
          isEspecial: false,
        });
      }
    }

    linhas.sort((a, b) => compareUnidade(a.unidadeId, b.unidadeId));
    return { linhas, finais, ini, fim };
  }

  function gerarAndaresFinais() {
    try {
      const { linhas, finais, ini, fim } = buildAndaresFinaisLinhas();
      setDraftLinhas(linhas);
      setConfigNotice("");
      alert(`Gerado: andares ${ini}..${fim} com finais ${finais.join(",")} => ${linhas.length} unidade(s).`);
    } catch (e: any) {
      alert(String(e?.message || e));
    }
  }

  // ✅ MELHORIA 2: Gerar + Processar (rápido) sem depender do state assíncrono
  function gerarEProcessarRapido() {
    try {
      const { linhas } = buildAndaresFinaisLinhas();
      setDraftLinhas(linhas);
      setConfigNotice("");
      processarQuadro(linhas, especiais);
    } catch (e: any) {
      alert(String(e?.message || e));
    }
  }

  // processar aceita override opcional (pra “rápido”)
  function processarQuadro(principaisOverride?: QuadroUnidade[], especiaisOverride?: QuadroUnidade[]) {
    if (!isMaster) return alert("Somente Master pode processar.");
    if (!empresaAtual || !obraAtual) return alert("Selecione Empresa e Obra.");

    const principais = principaisOverride ?? draftLinhas;
    const esp = especiaisOverride ?? especiais;

    if (!principais.length && !esp.length) return alert("Gere/cole unidades antes de processar.");

    // base = principais; depois sobrescreve com especiais
    const baseMap = new Map<string, QuadroUnidade>();
    for (const b of principais) baseMap.set(pad4(b.unidadeId), { ...b, unidadeId: pad4(b.unidadeId), isEspecial: false });
    for (const sp of esp) baseMap.set(pad4(sp.unidadeId), { ...sp, unidadeId: pad4(sp.unidadeId), isEspecial: true });

    let linhas = Array.from(baseMap.values()).map((x) => ({
      ...x,
      unidadeId: pad4(x.unidadeId),
      percentual: fmt7(Number(x.percentual || 0)),
      tipo: x.tipo?.trim() || undefined,
      cor: x.cor || undefined,
      isEspecial: !!x.isEspecial,
    }));

    for (const l of linhas) {
      if (!(Number(l.percentual) > 0)) return alert(`Peso inválido na unidade ${pad4(l.unidadeId)}.`);
    }

    // ✅ ordem por ANDAR e depois FINAL (0 primeiro)
    linhas.sort((a, b) => compareUnidade(a.unidadeId, b.unidadeId));

    // soma pode ser 1,0000000 ou 100,0000000
    // soma: pode vir "qualquer coisa" — vamos escolher o alvo (1 ou 100) e FECHAR no processamento
    const soma = fmt7(linhas.reduce((s, x) => s + Number(x.percentual || 0), 0));

    // regra prática:
    // - se a soma for grande (> 2), assume que você digitou em % (fecha em 100)
    // - se for pequena (<= 2), assume fração (fecha em 1)
    const target = soma > 2 ? 100 : 1;

// ✅ (opcional) avisinho só pra você entender o que aconteceu
// alert(`Soma atual: ${percentBR(soma)} → vou fechar em ${percentBR(target)}`);


    // ✅ arredonda/fecha no PROCESSAR (diferença vai pra última unidade especial; se não tiver, última da lista)
    const soma2 = fmt7(linhas.reduce((s, x) => s + x.percentual, 0));
    const diff = fmt7(target - soma2);

    if (Math.abs(diff) > 0) {
      let idxTarget = -1;
      for (let i = linhas.length - 1; i >= 0; i--) {
        if (linhas[i].isEspecial) {
          idxTarget = i;
          break;
        }
      }
      if (idxTarget < 0) idxTarget = linhas.length - 1;

      const novoVal = fmt7(linhas[idxTarget].percentual + diff);
      if (novoVal > 0) linhas[idxTarget].percentual = novoVal;
    }

    const somaFinal = fmt7(linhas.reduce((s, x) => s + x.percentual, 0));
    if (!isClose(somaFinal, target)) {
      return alert(`Falha ao fechar o total. Ficou em ${percentBR(somaFinal)} (alvo ${percentBR(target)}).`);
    }

    // ✅ cores por peso nas NÃO-especiais (mesmo peso = mesma cor => final 1 em todos os andares fica igual)
    const especiaisIds = new Set(linhas.filter((x) => x.isEspecial).map((x) => pad4(x.unidadeId)));
    linhas = applyAutoColorsByPercent(
    linhas.map((x) => ({ ...x, tipo: x.tipo ?? undefined })),
    especiaisIds
    );

    const now = new Date().toISOString();
    const key = chaveEO(empresaAtual.id, obraAtual.id);

    const all = loadJson<Record<string, QuadroCustos>>(STORAGE_CUSTOS, {});
    const existente = all[key];

    const novo: QuadroCustos = {
      id: existente?.id ?? uuid(),
      empresaId: empresaAtual.id,
      obraId: obraAtual.id,
      criadoEm: existente?.criadoEm ?? now,
      atualizadoEm: now,
      unidades: linhas,
      valorTerreno: existente?.valorTerreno ?? 0,
      custosMensais: existente?.custosMensais ?? [],
    };

    all[key] = novo;
    saveJson(STORAGE_CUSTOS, all);
    setQuadro(novo);

    // criar/atualizar unidades LIVRES
    const listaU = loadJson<any[]>(STORAGE_UNIDADES, []).map((u) => ({
      ...u,
      id: pad4(u?.id),
      empresaId: pad4(u?.empresaId),
      obraId: pad4(u?.obraId),
    })) as Unidade[];

    const idxMap = new Map<string, number>();
    for (let i = 0; i < listaU.length; i++) {
      const u = listaU[i];
      idxMap.set(`${u.empresaId}-${u.obraId}-${u.id}`, i);
    }

    const nextU = listaU.slice();
    for (const l of novo.unidades) {
      const k = `${novo.empresaId}-${novo.obraId}-${l.unidadeId}`;
      const idx = idxMap.get(k);

      if (idx == null) {
        nextU.push({
          id: l.unidadeId,
          empresaId: novo.empresaId,
          obraId: novo.obraId,
          compradorNome: "",
          valorVenda: 0,
          percentualCusto: l.percentual,
          tipoCusto: l.tipo,
          criadoEm: now,
          atualizadoEm: now,
        });
      } else {
        nextU[idx] = {
          ...nextU[idx],
          percentualCusto: l.percentual,
          tipoCusto: l.tipo,
          atualizadoEm: now,
        };
      }
    }

    saveJson(STORAGE_UNIDADES, nextU);
    setUnidades(nextU);

    setShowConfig(false);
    alert(`Quadro processado! Soma: ${percentBR(somaFinal)} (alvo ${percentBR(target)})`);
  }

  function salvarValorTerreno() {
    if (!isMaster) return alert("Somente Master pode alterar.");
    if (!quadro) return alert("Processe o Quadro primeiro.");

    const v = Number(parseMoneyInput(valorTerrenoInput).toFixed(2));
    const all = loadJson<Record<string, QuadroCustos>>(STORAGE_CUSTOS, {});
    const key = chaveEO(quadro.empresaId, quadro.obraId);
    const cur = all[key];
    if (!cur) return alert("Quadro não encontrado.");

    const next: QuadroCustos = { ...cur, valorTerreno: v, atualizadoEm: new Date().toISOString() };
    all[key] = next;
    saveJson(STORAGE_CUSTOS, all);
    setQuadro(next);
    alert("Valor do terreno salvo.");
  }

  function addCustoMensal() {
    if (!isMaster) return alert("Somente Master pode lançar.");
    if (!quadro) return alert("Processe o Quadro primeiro.");

    const comp = normalizeCompetencia(compInput);
    if (!comp || !isValidCompetencia(comp)) return alert("Competência inválida. Use mm/aaaa (ex.: 01/2026).");
    const valor = Number(parseMoneyInput(custoInput).toFixed(2));
    if (!(valor > 0)) return alert("Informe o valor do custo do mês.");

    if (quadro.custosMensais.some((c) => c.competencia === comp)) return alert("Já existe lançamento para essa competência.");

    const novo: CustoMensal = { id: uuid(), competencia: comp, valor, criadoEm: new Date().toISOString() };

    const all = loadJson<Record<string, QuadroCustos>>(STORAGE_CUSTOS, {});
    const key = chaveEO(quadro.empresaId, quadro.obraId);
    const cur = all[key];
    if (!cur) return alert("Quadro não encontrado.");

    const next: QuadroCustos = {
      ...cur,
      custosMensais: [...cur.custosMensais, novo].sort((a, b) => a.competencia.localeCompare(b.competencia)),
      atualizadoEm: new Date().toISOString(),
    };
    all[key] = next;
    saveJson(STORAGE_CUSTOS, all);
    setQuadro(next);

    setCompInput("");
    setCustoInput("");
  }

  function startEditarMes(m: CustoMensal) {
    setEditMesId(m.id);
    setEditMesValor(m.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }
  function cancelarEditarMes() {
    setEditMesId(null);
    setEditMesValor("");
  }
  function salvarEditarMes() {
    if (!isMaster) return alert("Somente Master pode alterar.");
    if (!quadro) return alert("Quadro não encontrado.");
    if (!editMesId) return;

    const v = Number(parseMoneyInput(editMesValor).toFixed(2));
    if (!(v > 0)) return alert("Valor inválido.");

    const all = loadJson<Record<string, QuadroCustos>>(STORAGE_CUSTOS, {});
    const key = chaveEO(quadro.empresaId, quadro.obraId);
    const cur = all[key];
    if (!cur) return alert("Quadro não encontrado.");

    const nextMeses = cur.custosMensais.map((m) => (m.id === editMesId ? { ...m, valor: v } : m));
    const next: QuadroCustos = { ...cur, custosMensais: nextMeses, atualizadoEm: new Date().toISOString() };
    all[key] = next;
    saveJson(STORAGE_CUSTOS, all);
    setQuadro(next);

    cancelarEditarMes();
  }
  function excluirMes(id: string) {
    if (!isMaster) return alert("Somente Master pode excluir.");
    if (!quadro) return alert("Quadro não encontrado.");
    if (!confirm("Excluir este mês?")) return;

    const all = loadJson<Record<string, QuadroCustos>>(STORAGE_CUSTOS, {});
    const key = chaveEO(quadro.empresaId, quadro.obraId);
    const cur = all[key];
    if (!cur) return alert("Quadro não encontrado.");

    const next: QuadroCustos = { ...cur, custosMensais: cur.custosMensais.filter((m) => m.id !== id), atualizadoEm: new Date().toISOString() };
    all[key] = next;
    saveJson(STORAGE_CUSTOS, all);
    setQuadro(next);
  }

  async function exportarExcel() {
    if (!quadro) return alert("Processe o Quadro primeiro.");
    try {
      const XLSX = await import("xlsx");

      const pesos = quadro.unidades.map((u) => Number(u.percentual || 0));

      const terrenoCents = allocateCents(quadro.valorTerreno, pesos);
      const terrenoMap = new Map<string, number>();
      quadro.unidades.forEach((u, i) => terrenoMap.set(u.unidadeId, terrenoCents[i] / 100));

      const meses = quadro.custosMensais.slice().sort((a, b) => a.competencia.localeCompare(b.competencia));
      const mesesMap = new Map<string, Map<string, number>>();
      for (const u of quadro.unidades) mesesMap.set(u.unidadeId, new Map());
      for (const c of meses) {
        const cents = allocateCents(c.valor, pesos);
        quadro.unidades.forEach((u, i) => mesesMap.get(u.unidadeId)!.set(c.competencia, cents[i] / 100));
      }

      const rows: any[] = [];
      for (const u of quadro.unidades.slice().sort((a, b) => compareUnidade(a.unidadeId, b.unidadeId))) {
        const terreno = terrenoMap.get(u.unidadeId) || 0;
        let somaMeses = 0;
        const row: any = {
          Empresa: `${quadro.empresaId}`,
          Obra: `${quadro.obraId}`,
          Unidade: u.unidadeId,
          Peso: Number(u.percentual),
          Especial: u.isEspecial ? "SIM" : "NÃO",
          Terreno: terreno,
        };
        for (const m of meses) {
          const v = mesesMap.get(u.unidadeId)?.get(m.competencia) || 0;
          row[m.competencia] = v;
          somaMeses += v;
        }
        row["Total Mensal"] = somaMeses;
        row["Total Geral"] = terreno + somaMeses;
        rows.push(row);
      }

      const rowsLanc: any[] = [
        { Campo: "Empresa", Valor: quadro.empresaId },
        { Campo: "Obra", Valor: quadro.obraId },
        { Campo: "Valor Terreno", Valor: quadro.valorTerreno },
        { Campo: "Soma Pesos", Valor: quadro.unidades.reduce((s, x) => s + Number(x.percentual || 0), 0) },
        {},
        { Competencia: "Competência", Valor: "Valor Total" },
        ...meses.map((m) => ({ Competencia: m.competencia, Valor: m.valor })),
      ];

      const ws1 = XLSX.utils.json_to_sheet(rows);
      const ws2 = XLSX.utils.json_to_sheet(rowsLanc);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, "Quadro");
      XLSX.utils.book_append_sheet(wb, ws2, "Lançamentos");

      const nome = `QuadroCustos_${quadro.empresaId}_${quadro.obraId}.xlsx`;
      XLSX.writeFile(wb, nome);
    } catch (e: any) {
      alert(`Falha ao exportar Excel. Verifique se instalou 'xlsx'.\n\n${String(e?.message || e)}`);
    }
  }

  const card: React.CSSProperties = {
    background: "white",
    borderRadius: 12,
    padding: 12,
    boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
  };
  const btn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ddd",
    background: "white",
    cursor: "pointer",
    fontWeight: 900,
  };
  const primaryBtn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "none",
    background: "#0b4fd6",
    color: "white",
    cursor: "pointer",
    fontWeight: 900,
  };
  const dangerBtn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "none",
    background: "#b00020",
    color: "white",
    cursor: "pointer",
    fontWeight: 900,
  };

  const rateioPorUnidade = useMemo(() => {
    if (!quadro) return [];
    const pesos = quadro.unidades.map((u) => Number(u.percentual || 0));
    const terrenoCents = allocateCents(quadro.valorTerreno, pesos);

    const meses = quadro.custosMensais.slice().sort((a, b) => a.competencia.localeCompare(b.competencia));

    return quadro.unidades.map((u, idxU) => {
      const valores: Record<string, number> = {};
      let somaMeses = 0;

      for (const c of meses) {
        const cents = allocateCents(c.valor, pesos);
        const v = cents[idxU] / 100;
        valores[c.competencia] = v;
        somaMeses += v;
      }

      const terreno = terrenoCents[idxU] / 100;
      const totalGeral = terreno + somaMeses;

      return {
        unidadeId: u.unidadeId,
        percentual: u.percentual,
        cor: u.cor,
        isEspecial: !!u.isEspecial,
        terreno,
        somaMeses,
        totalGeral,
        valores,
      };
    });
  }, [quadro]);

  if (!session) {
    return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>Carregando...</main>;
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f2f2f2", padding: 16 }}>
      <style>{`
        .mini{font-size:13px;color:#666}
        .gridTop{display:grid;grid-template-columns:1.2fr 1.2fr 2fr;gap:12px}
        @media(max-width:1100px){.gridTop{grid-template-columns:1fr}}
        .table{width:100%;border-collapse:collapse}
        .th{background:#f7f7f7;text-align:left;padding:10px;font-weight:900;border-bottom:1px solid #eee}
        .td{padding:10px;border-bottom:1px solid #eee}
        .nowrap{white-space:nowrap}
        .modalOverlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:grid;place-items:center;padding:18px;z-index:50}
        .modal{width:min(1200px,98vw);max-height:92vh;overflow:auto;background:white;border-radius:14px;padding:14px;box-shadow:0 20px 60px rgba(0,0,0,.35)}
        textarea{font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;}
        .badge{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:999px;font-size:12px;border:1px solid rgba(0,0,0,.12);background:rgba(255,255,255,.6)}
        .dot{width:10px;height:10px;border-radius:999px;display:inline-block}
      `}</style>

      <div style={{ maxWidth: 1500, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, color: "#333" }}>Controle de Imóveis — Quadro de Custos</h1>
            <div className="mini" style={{ marginTop: 6 }}>
              Usuário: <b>{session.username}</b> ({session.role})
            </div>
            <div style={{ color: "#444", marginTop: 6 }}>
              Empresa: <b>{empresaAtual ? `${empresaAtual.id} — ${empresaAtual.razaoSocial}` : "(selecione)"}</b>{" "}
              | Obra: <b>{obraAtual ? `${obraAtual.id} — ${obraAtual.nome}` : "(selecione)"}</b>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button style={btn} onClick={() => router.push("/dashboard")}>Voltar</button>
            <button style={btn} onClick={() => router.push("/gestao")}>Gestão (Vendas)</button>
          </div>
        </div>

        <div style={{ marginTop: 12 }} className="gridTop">
          <section style={card}>
            <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>Empresa</h2>
            <div style={{ marginTop: 10 }}>
              <select
                style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                value={empresaSel}
                onChange={(e) => {
                  setEmpresaSel(pad4(e.target.value));
                  setObraSel("");
                }}
              >
                <option value="">Selecione...</option>
                {empresas.slice().sort((a, b) => a.id.localeCompare(b.id)).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.id} — {e.razaoSocial}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section style={card}>
            <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>Obra</h2>
            <div style={{ marginTop: 10 }}>
              <select
                style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                value={obraSel}
                onChange={(e) => setObraSel(pad4(e.target.value))}
                disabled={!empresaSel}
              >
                <option value="">{empresaSel ? "Selecione..." : "Selecione a empresa"}</option>
                {obrasDaEmpresa.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.id} — {o.nome}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>Ações</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  style={!isMaster || !empresaAtual || !obraAtual ? { ...primaryBtn, opacity: 0.55, cursor: "not-allowed" } : primaryBtn}
                  disabled={!isMaster || !empresaAtual || !obraAtual}
                  onClick={abrirConfig}
                >
                  {quadro ? "Reprocessar Quadro" : "Configurar / Processar"}
                </button>

                <button
                  style={!isMaster || !empresaAtual || !obraAtual ? { ...dangerBtn, opacity: 0.55, cursor: "not-allowed" } : dangerBtn}
                  disabled={!isMaster || !empresaAtual || !obraAtual}
                  onClick={apagarQuadro}
                >
                  Apagar Quadro
                </button>
              </div>
            </div>
          </section>
        </div>

        <section style={{ ...card, marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>Quadro de Custos</h2>
            <div className="mini">
              {quadro ? `Atualizado em ${new Date(quadro.atualizadoEm).toLocaleString("pt-BR")}` : "—"}
            </div>
          </div>

          {!quadro ? (
            <div className="mini" style={{ marginTop: 10 }}>
              Selecione Empresa/Obra e clique em <b>Configurar / Processar</b>.
            </div>
          ) : (
            <>
              <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 12, padding: 12, background: "#fafafa" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr auto", gap: 12, alignItems: "end" }}>
                  <div>
                    <div className="mini">Valor do Terreno (único)</div>
                    <input
                      style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc", marginTop: 6 }}
                      value={valorTerrenoInput}
                      onChange={(e) => setValorTerrenoInput(e.target.value)}
                      placeholder="ex.: 1.250.000,00"
                    />
                  </div>

                  <div>
                    <div className="mini">Lançar mês (mm/aaaa) + valor</div>
                    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, marginTop: 6 }}>
                      <input
                        style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                        value={competenciaMask(compInput)}
                        onChange={(e) => setCompInput(e.target.value)}
                        onBlur={(e) => setCompInput(normalizeCompetencia(e.target.value))}
                        placeholder="ex.: 01/2026"
                      />
                      <input
                        style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                        value={custoInput}
                        onChange={(e) => setCustoInput(e.target.value)}
                        placeholder="ex.: 180.000,00"
                      />
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button style={!isMaster ? { ...primaryBtn, opacity: 0.55, cursor: "not-allowed" } : primaryBtn} disabled={!isMaster} onClick={salvarValorTerreno}>
                      Salvar Terreno
                    </button>
                    <button style={!isMaster ? { ...primaryBtn, opacity: 0.55, cursor: "not-allowed" } : primaryBtn} disabled={!isMaster} onClick={addCustoMensal}>
                      Incluir mês
                    </button>
                    <button style={btn} onClick={exportarExcel}>Exportar Excel</button>
                  </div>
                </div>

                {quadro.custosMensais.length > 0 && (
                  <div style={{ marginTop: 12, borderTop: "1px solid #e9e9e9", paddingTop: 12 }}>
                    <div className="mini" style={{ marginBottom: 8 }}>Meses lançados:</div>

                    <div style={{ display: "grid", gap: 8 }}>
                      {quadro.custosMensais
                        .slice()
                        .sort((a, b) => a.competencia.localeCompare(b.competencia))
                        .map((m) => (
                          <div
                            key={m.id}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "120px 200px auto",
                              gap: 10,
                              alignItems: "center",
                              background: "#fff",
                              border: "1px solid #eee",
                              borderRadius: 12,
                              padding: 10,
                            }}
                          >
                            <div style={{ fontWeight: 900 }}>{m.competencia}</div>

                            {editMesId === m.id ? (
                              <input
                                style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                                value={editMesValor}
                                onChange={(e) => setEditMesValor(e.target.value)}
                              />
                            ) : (
                              <div style={{ fontWeight: 900 }}>{moneyBR(m.valor)}</div>
                            )}

                            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                              {editMesId === m.id ? (
                                <>
                                  <button style={primaryBtn} onClick={salvarEditarMes}>Salvar</button>
                                  <button style={btn} onClick={cancelarEditarMes}>Cancelar</button>
                                </>
                              ) : (
                                <>
                                  <button style={btn} onClick={() => startEditarMes(m)} disabled={!isMaster}>Editar</button>
                                  <button style={dangerBtn} onClick={() => excluirMes(m.id)} disabled={!isMaster}>Excluir</button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 12, overflow: "auto", border: "1px solid #eee", borderRadius: 12 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th className="th nowrap">Unidade</th>
                      <th className="th nowrap">Tipo</th>
                      <th className="th nowrap" style={{ textAlign: "right" }}>Peso</th>
                      <th className="th nowrap" style={{ textAlign: "right" }}>Terreno</th>
                      {(quadro.custosMensais || []).slice().sort((a, b) => a.competencia.localeCompare(b.competencia)).map((c) => (
                        <th key={c.id} className="th nowrap" style={{ textAlign: "right" }}>{c.competencia}</th>
                      ))}
                      <th className="th nowrap" style={{ textAlign: "right" }}>Total Mensal</th>
                      <th className="th nowrap" style={{ textAlign: "right" }}>Total Geral</th>
                    </tr>
                  </thead>

                  <tbody>
                    {rateioPorUnidade
                      .slice()
                      .sort((a, b) => compareUnidade(a.unidadeId, b.unidadeId))
                      .map((u) => {
                        const bg = u.cor || "#fff";
                        const fg = bg === "#fff" ? "#111" : textColorForBg(bg);
                        const rowStyle: React.CSSProperties = bg && bg !== "#fff" ? { background: bg, color: fg } : { background: "#fff", color: "#111" };

                        return (
                          <tr key={u.unidadeId} style={rowStyle}>
                            <td className="td nowrap" style={{ fontWeight: 900 }}>{u.unidadeId}</td>
                            <td className="td nowrap">
                              <span className="badge">
                                <span className="dot" style={{ background: u.isEspecial ? "#000" : "#fff", border: "1px solid rgba(0,0,0,.35)" }} />
                                {u.isEspecial ? "Especial" : "Principal"}
                              </span>
                            </td>
                            <td className="td nowrap" style={{ textAlign: "right", fontWeight: 900 }}>{percentBR(u.percentual)}</td>
                            <td className="td nowrap" style={{ textAlign: "right", fontWeight: 900 }}>{moneyBR(u.terreno)}</td>

                            {(quadro.custosMensais || []).slice().sort((a, b) => a.competencia.localeCompare(b.competencia)).map((c) => (
                              <td key={c.id} className="td nowrap" style={{ textAlign: "right", fontWeight: 900 }}>
                                {moneyBR(u.valores[c.competencia] || 0)}
                              </td>
                            ))}

                            <td className="td nowrap" style={{ textAlign: "right", fontWeight: 900 }}>{moneyBR(u.somaMeses)}</td>
                            <td className="td nowrap" style={{ textAlign: "right", fontWeight: 900 }}>{moneyBR(u.totalGeral)}</td>
                          </tr>
                        );
                      })}
                  </tbody>

                  <tfoot>
                    <tr style={{ background: "#f0f0f0", fontWeight: 900 }}>
                      <td className="td nowrap" colSpan={3}>Totais</td>
                      <td className="td nowrap" style={{ textAlign: "right" }}>{moneyBR(quadro.valorTerreno)}</td>
                      {(quadro.custosMensais || []).slice().sort((a, b) => a.competencia.localeCompare(b.competencia)).map((c) => (
                        <td key={c.id} className="td nowrap" style={{ textAlign: "right" }}>{moneyBR(c.valor)}</td>
                      ))}
                      <td className="td nowrap" style={{ textAlign: "right" }}>
                        {moneyBR((quadro.custosMensais || []).reduce((s, x) => s + Number(x.valor || 0), 0))}
                      </td>
                      <td className="td nowrap" style={{ textAlign: "right" }}>
                        {moneyBR(Number(quadro.valorTerreno || 0) + (quadro.custosMensais || []).reduce((s, x) => s + Number(x.valor || 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      {showConfig && (
        <div className="modalOverlay" onMouseDown={() => setShowConfig(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 900, fontSize: 16, color: "#333" }}>
                Configurar Quadro — {empresaAtual?.id} / {obraAtual?.id}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={btn} onClick={() => setShowConfig(false)}>Fechar</button>
                <button style={dangerBtn} onClick={() => processarQuadro()}>Processar</button>
              </div>
            </div>

            {configNotice && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid #ffe08a", background: "#fff7d6", color: "#6a4b00", fontWeight: 900 }}>
                {configNotice}
              </div>
            )}

            {/* ✅ GERAR ANDARES + FINAIS */}
            <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
              <div style={{ padding: 10, borderBottom: "1px solid #eee", fontWeight: 900, color: "#333" }}>
                Gerar andares + finais (principal)
              </div>

              <div style={{ padding: 12, background: "#fafafa" }}>
                <div style={{ display: "grid", gridTemplateColumns: "140px 140px 1fr auto", gap: 10, alignItems: "end" }}>
                  <div>
                    <div className="mini">Andar inicial</div>
                    <input
                      style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc", marginTop: 6 }}
                      value={andarIni}
                      onChange={(e) => setAndarIni(onlyDigits(e.target.value).slice(0, 2))}
                      placeholder="1"
                    />
                  </div>
                  <div>
                    <div className="mini">Andar final</div>
                    <input
                      style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc", marginTop: 6 }}
                      value={andarFim}
                      onChange={(e) => setAndarFim(onlyDigits(e.target.value).slice(0, 2))}
                      placeholder="14"
                    />
                  </div>
                  <div>
                    <div className="mini">Finais (separados por vírgula)</div>
                    <input
                      style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc", marginTop: 6 }}
                      value={finaisStr}
                      onChange={(e) => setFinaisStr(e.target.value)}
                      placeholder="1,2,3,4,5,6,7"
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button style={primaryBtn} onClick={gerarAndaresFinais}>Gerar</button>
                    <button style={primaryBtn} onClick={gerarEProcessarRapido}>Gerar + Processar (rápido)</button>
                  </div>
                </div>

                {/* pesos por final */}
                <div style={{ marginTop: 12, overflow: "auto", border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="th nowrap">Final</th>
                        <th className="th nowrap">Peso (7 casas)</th>
                        <th className="th nowrap">Exemplo unidade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {String(finaisStr)
                        .split(",")
                        .map((s) => onlyDigits(s))
                        .filter(Boolean)
                        .map((s) => Number(s))
                        .filter((n) => n >= 0 && n <= 9)
                        .map((f) => (
                          <tr key={f}>
                            <td className="td nowrap" style={{ fontWeight: 900 }}>{f}</td>
                            <td className="td nowrap">
                              <input
                                style={{ width: 180, padding: 8, borderRadius: 10, border: "1px solid #ddd" }}
                                value={pesosPorFinal[String(f)] ?? ""}
                                onChange={(e) => setPesosPorFinal((p) => ({ ...p, [String(f)]: e.target.value }))}
                                onBlur={(e) => {
                                  const v = parsePercentInput(e.target.value);
                                  setPesosPorFinal((p) => ({ ...p, [String(f)]: percentBR(v) }));
                                }}
                                placeholder="0,0112520"
                              />
                            </td>
                            <td className="td nowrap" style={{ color: "#555" }}>
                              {pad4(String((Number(onlyDigits(andarIni) || "1") || 1) * 10 + f))}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                <div className="mini" style={{ marginTop: 8 }}>
                  Dica: as unidades principais geradas serão 0011..0017, 0021..0027, ... 0141..0147. O térreo (0004..0007) entra como <b>especial</b> (override).
                </div>
              </div>
            </div>

            {/* COLAR LISTA PRINCIPAL */}
            <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
              <div style={{ padding: 10, borderBottom: "1px solid #eee", fontWeight: 900, color: "#333" }}>
                Colar lista PRINCIPAL (opcional)
              </div>

              <div style={{ padding: 12, background: "#fafafa", borderBottom: "1px solid #eee" }}>
                <div className="mini">Você pode colar qualquer lista pronta (substitui o principal atual).</div>
                <textarea
                  style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc", marginTop: 8, minHeight: 120 }}
                  value={pastePrincipal}
                  onChange={(e) => setPastePrincipal(e.target.value)}
                  placeholder={`Ex:\n11 0,0112520\n12 0,0073470\n...\n141 0,0112520`}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  <button style={primaryBtn} onClick={importarPrincipais}>Importar PRINCIPAL</button>
                  <button style={btn} onClick={() => setPastePrincipal("")}>Limpar</button>
                </div>
              </div>
            </div>

            {/* COLAR ESPECIAIS */}
            <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
              <div style={{ padding: 10, borderBottom: "1px solid #eee", fontWeight: 900, color: "#333" }}>
                Colar lista ESPECIAIS (override) — térreo/lojas/etc
              </div>

              <div style={{ padding: 12, background: "#fafafa", borderBottom: "1px solid #eee" }}>
                <div className="mini">Essas unidades substituem as principais somente nelas (ex.: 0004..0007).</div>
                <textarea
                  style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc", marginTop: 8, minHeight: 120 }}
                  value={pasteEspeciais}
                  onChange={(e) => setPasteEspeciais(e.target.value)}
                  placeholder={`Ex:\n04-0,0081000\n05-0,0108000\n06-0,0160350\n07-0,0138500`}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  <button style={primaryBtn} onClick={importarEspeciais}>Importar/Atualizar especiais</button>
                  <button style={btn} onClick={() => { setEspeciais([]); setPasteEspeciais(""); }}>Limpar especiais</button>
                </div>

                {especiais.length > 0 && (
                  <div className="mini" style={{ marginTop: 10 }}>
                    Especiais cadastradas: <b>{especiais.length}</b> (cores automáticas exclusivas)
                  </div>
                )}
              </div>
            </div>

            {/* Preview simples */}
            <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
              <div style={{ padding: 10, borderBottom: "1px solid #eee", fontWeight: 900, color: "#333" }}>
                Preview (ordem por andar)
              </div>
              <div style={{ padding: 12 }}>
                <div className="mini">
                  Principais: <b>{draftLinhas.length}</b> | Especiais: <b>{especiais.length}</b>
                </div>
                <div className="mini" style={{ marginTop: 6 }}>
                  Primeiras 20 unidades (já ordenadas):{" "}
                  <b>
                    {draftLinhas
                      .slice()
                      .sort((a, b) => compareUnidade(a.unidadeId, b.unidadeId))
                      .slice(0, 20)
                      .map((x) => x.unidadeId)
                      .join(", ")}
                  </b>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}
    </main>
  );
}
