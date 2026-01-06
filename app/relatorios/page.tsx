"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Session = { username: string; role: "MASTER" | "USER" };

type Empresa = { id: string; razaoSocial: string; grupo?: string; cnpj?: string };
type Obra = { id: string; empresaId: string; nome: string };

type Unidade = {
  id: string; // 4 dígitos
  empresaId: string;
  obraId: string;
  compradorNome: string;
  compradorCpfCnpj?: string;
  valorVenda: number;
  criadoEm: string;
};

type TipoPagamento =
  | "Entrada"
  | "Mensal"
  | "Semestral"
  | "Anual"
  | "Única"
  | "Financiamento"
  | "Outras";

type ParcelaPrevista = {
  id: string;
  empresaId: string;
  obraId: string;
  unidadeId: string;
  tipo: TipoPagamento;
  vencimento: string; // dd/mm/aaaa
  valorPrevisto: number;
};

type PagamentoKind = "PAGAMENTO" | "DESCONTO";

type PagamentoParcial = {
  id: string;
  parcelaId?: string;
  parcela_id?: string;
  parcelaPrevistaId?: string;

  valor: number;
  data?: string; // dd/mm/aaaa
  dataRecebimento?: string; // alias

  criadoEm?: string; // ISO
  createdAt?: string; // alias

  loteId?: string;
  kind?: PagamentoKind;
};

type PagamentosPorParcela = Record<string, PagamentoParcial[]>;

const STORAGE_EMPRESAS = "ci_empresas";
const STORAGE_OBRAS = "ci_obras";
const STORAGE_UNIDADES = "ci_unidades";
const STORAGE_PARCELAS = "ci_parcelas_previstas";
const STORAGE_PAGAMENTOS = "ci_pagamentos_parciais";

function onlyDigits(v: string | undefined | null) {
  return String(v ?? "").replace(/\D/g, "");
}
function pad4(v: string | undefined | null) {
  const d = onlyDigits(v).slice(0, 4);
  return d.padStart(4, "0");
}
function fmt2(v: number) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
function moneyBR(v: number) {
  try {
    return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  } catch {
    return `R$ ${Number(v || 0).toFixed(2)}`;
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
function parseDateBR(s: string) {
  const m = String(s ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const d = new Date(yyyy, mm - 1, dd);
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return d;
}
function sortDateBR(a: string, b: string) {
  const da = parseDateBR(a);
  const db = parseDateBR(b);
  if (!da || !db) return String(a).localeCompare(String(b));
  return da.getTime() - db.getTime();
}
function normalizeAnoOnBlur(v: string) {
  const d = onlyDigits(v).slice(0, 4);
  if (!d) return String(new Date().getFullYear());
  if (d.length === 1) return "200" + d;
  if (d.length === 2) return "20" + d;
  if (d.length === 3) return "2" + d;
  return d;
}
function monthYearKey(mm: string, yyyy: string) {
  return `${String(mm).padStart(2, "0")}/${String(yyyy)}`;
}
function inCompetencia(dt: string, mm: string, yyyy: string) {
  const d = parseDateBR(dt);
  if (!d) return false;
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const y = String(d.getFullYear());
  return m === String(mm).padStart(2, "0") && y === String(yyyy);
}
function beforeCompetencia(dt: string, mm: string, yyyy: string) {
  const d = parseDateBR(dt);
  if (!d) return false;
  const start = new Date(Number(yyyy), Number(mm) - 1, 1);
  return d.getTime() < start.getTime();
}
function inRangeDateBR(dt: string, de: string, ate: string) {
  const d = parseDateBR(dt);
  const d1 = parseDateBR(de);
  const d2 = parseDateBR(ate);
  if (!d || !d1 || !d2) return false;
  const t = d.getTime();
  return t >= d1.getTime() && t <= d2.getTime();
}
function dateMask(raw: string) {
  const d = onlyDigits(raw).slice(0, 8);
  const dd = d.slice(0, 2);
  const mm = d.slice(2, 4);
  const yy = d.slice(4, 8);
  let out = "";
  if (dd) out += dd;
  if (mm) out += "/" + mm;
  else if (d.length > 2) out += "/";
  if (yy) out += "/" + yy;
  else if (d.length > 4) out += "/";
  return out;
}
function normalizeDateOnBlur(raw: string) {
  const d = onlyDigits(raw).slice(0, 8);
  if (!d) return "";
  const ddRaw = d.slice(0, 2);
  const mmRaw = d.slice(2, 4);
  const yyRaw = d.slice(4);
  const dd = ddRaw.length === 1 ? `0${ddRaw}` : ddRaw.padEnd(2, "0");
  const mm = mmRaw.length === 0 ? "01" : mmRaw.length === 1 ? `0${mmRaw}` : mmRaw.padEnd(2, "0");
  let yyyy = String(new Date().getFullYear());
  if (yyRaw.length === 1) yyyy = "200" + yyRaw;
  else if (yyRaw.length === 2) yyyy = "20" + yyRaw;
  else if (yyRaw.length === 3) yyyy = "2" + yyRaw;
  else if (yyRaw.length >= 4) yyyy = yyRaw.slice(0, 4);
  return `${dd}/${mm}/${yyyy}`;
}
function isValidDateBR(s: string) {
  const d = parseDateBR(s);
  return !!d;
}

// aceita "1000,25" / "1.000,25" / "-10,50" / "-1.234,00"
function parseMoneyLoose(raw: string) {
  const t = String(raw ?? "").trim();
  if (!t) return 0;
  const normalized = t.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}
function formatInputBR(v: number) {
  const n = Number(v || 0);
  return n.toFixed(2).replace(".", ",");
}

type ManualLineMode = "FIXA_TOTAL" | "LIVRE_2COL";
type ManualLine = {
  id: string;
  nome: string;
  mode: ManualLineMode;

  previsto: number;
  variacao: number;
  descontos: number; // sempre 0 nas linhas manuais
  total: number; // FIXA_TOTAL: digitado; LIVRE_2COL: previsto + variacao
};

type PisRow = {
  empresaId: string;
  empresaNome: string;
  obraId: string;
  obraNome: string;

  unidadeId: string;
  comprador: string;

  tipo: TipoPagamento;
  vencimento: string;

  previsto: number;
  variacao: number;
  descontos: number; // negativo quando quitou com desconto
  totalRecebido: number;

  quitouNoMes: boolean;
};

type UnidadeReportTipo = "FICHA" | "INFORME";

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(";") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** ✅ Logo vindo do /public/logo.png */
function getLogoSrc(): string {
  return "/logo.png";
}

/** ======= Extenso simples PT-BR (reais/centavos) ======= */
function extensoBR(valor: number) {
  const n = Math.max(0, Math.floor(Math.round((Number(valor) + Number.EPSILON) * 100) / 100));
  const cent = Math.round((Number(valor) + Number.EPSILON) * 100) % 100;

  const unidades = [
    "zero",
    "um",
    "dois",
    "três",
    "quatro",
    "cinco",
    "seis",
    "sete",
    "oito",
    "nove",
    "dez",
    "onze",
    "doze",
    "treze",
    "quatorze",
    "quinze",
    "dezesseis",
    "dezessete",
    "dezoito",
    "dezenove",
  ];
  const dezenas = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  const centenas = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

  function ate999(x: number): string {
    if (x === 0) return "";
    if (x < 20) return unidades[x];
    if (x < 100) {
      const d = Math.floor(x / 10);
      const u = x % 10;
      return u ? `${dezenas[d]} e ${unidades[u]}` : dezenas[d];
    }
    if (x === 100) return "cem";
    const c = Math.floor(x / 100);
    const r = x % 100;
    return r ? `${centenas[c]} e ${ate999(r)}` : centenas[c];
  }

  function grupo(x: number, singular: string, plural: string) {
    if (x === 0) return "";
    if (x === 1) return `${ate999(x)} ${singular}`;
    return `${ate999(x)} ${plural}`;
  }

  const milhoes = Math.floor(n / 1_000_000);
  const milhares = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;

  const parts: string[] = [];
  if (milhoes) parts.push(grupo(milhoes, "milhão", "milhões"));
  if (milhares) parts.push(milhares === 1 ? "mil" : `${ate999(milhares)} mil`);
  if (resto) parts.push(ate999(resto));

  const reaisTxt = parts.length ? parts.join(parts.length > 1 ? " e " : "") : "zero";
  const reaisLabel = n === 1 ? "real" : "reais";
  const centTxt = cent ? (cent === 1 ? "um centavo" : `${ate999(cent)} centavos`) : "";

  if (centTxt) return `${reaisTxt} ${reaisLabel} e ${centTxt}`;
  return `${reaisTxt} ${reaisLabel}`;
}

export default function RelatoriosPage() {
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [obras, setObras] = useState<Obra[]>([]);
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [parcelas, setParcelas] = useState<ParcelaPrevista[]>([]);
  const [pagamentosPorParcelaId, setPagamentosPorParcelaId] = useState<PagamentosPorParcela>({});

  // competência PIS/COFINS
  const [pisMes, setPisMes] = useState(String(new Date().getMonth() + 1).padStart(2, "0"));
  const [pisAno, setPisAno] = useState(String(new Date().getFullYear()));

  // aba
  const [tab, setTab] = useState<"PIS" | "UNIDADE" | "PERIODO">("PIS");

  // linhas manuais
  const [manual, setManual] = useState<ManualLine[]>([]);
  const [manualDraft, setManualDraft] = useState<Record<string, { previsto: string; variacao: string; total: string }>>({});

  const [processado, setProcessado] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const isMaster = session?.role === "MASTER";

  const competencia = monthYearKey(pisMes, pisAno);

  const manualKey = useMemo(
    () => `ci_rel_piscofins_manual_${String(pisMes).padStart(2, "0")}${String(pisAno)}`,
    [pisMes, pisAno]
  );

  // ====== Por Unidade (modal + filtros) ======
  const [showUnModal, setShowUnModal] = useState(false);
  const [unTipo, setUnTipo] = useState<UnidadeReportTipo>("FICHA");

  const [fEmp, setFEmp] = useState<string>(""); // opcional
  const [fObra, setFObra] = useState<string>(""); // opcional
  const [fUnid, setFUnid] = useState<string>(""); // opcional

  const today = useMemo(() => {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear());
    return `${dd}/${mm}/${yy}`;
  }, []);

  const [de, setDe] = useState(`01/01/${String(new Date().getFullYear())}`);
  const [ate, setAte] = useState(`31/12/${String(new Date().getFullYear())}`);

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
    setEmpresas(
      loadJson<Empresa[]>(STORAGE_EMPRESAS, []).map((e) => ({
        ...e,
        id: pad4(e.id),
        grupo: e.grupo ? pad4(e.grupo) : undefined,
      }))
    );

    setObras(
      loadJson<Obra[]>(STORAGE_OBRAS, []).map((o) => ({
        ...o,
        id: pad4(o.id),
        empresaId: pad4(o.empresaId),
      }))
    );

    setUnidades(
      loadJson<Unidade[]>(STORAGE_UNIDADES, []).map((u) => ({
        ...u,
        id: pad4(u.id),
        empresaId: pad4(u.empresaId),
        obraId: pad4(u.obraId),
      }))
    );

    setParcelas(
      loadJson<ParcelaPrevista[]>(STORAGE_PARCELAS, []).map((p) => ({
        ...p,
        empresaId: pad4(p.empresaId),
        obraId: pad4(p.obraId),
        unidadeId: pad4(p.unidadeId),
      }))
    );

    // pagamentos robusto
    const rawPaysAny = loadJson<any>(STORAGE_PAGAMENTOS, {});
    const byId: PagamentosPorParcela = {};

    const push = (k: string, p: PagamentoParcial) => {
      if (!k) return;
      if (!byId[k]) byId[k] = [];
      byId[k].push(p);
    };

    if (rawPaysAny && typeof rawPaysAny === "object" && !Array.isArray(rawPaysAny)) {
      for (const k of Object.keys(rawPaysAny)) {
        const arr = Array.isArray(rawPaysAny[k]) ? rawPaysAny[k] : [];
        for (const p0 of arr) {
          const p: PagamentoParcial = {
            ...p0,
            id: String(p0?.id ?? `${k}-${Date.now()}`),
            valor: Number(p0?.valor ?? 0),
            kind: (p0?.kind ?? "PAGAMENTO") as PagamentoKind,
            data: p0?.data ?? p0?.dataRecebimento ?? "",
            criadoEm: p0?.criadoEm ?? p0?.createdAt ?? new Date().toISOString(),
            parcelaId: p0?.parcelaId ?? p0?.parcela_id ?? p0?.parcelaPrevistaId ?? k,
          };
          push(String(p.parcelaId ?? k), p);
        }
      }
    }

    if (Array.isArray(rawPaysAny)) {
      for (const p0 of rawPaysAny) {
        const p: PagamentoParcial = {
          ...p0,
          id: String(p0?.id ?? `${Date.now()}`),
          valor: Number(p0?.valor ?? 0),
          kind: (p0?.kind ?? "PAGAMENTO") as PagamentoKind,
          data: p0?.data ?? p0?.dataRecebimento ?? "",
          criadoEm: p0?.criadoEm ?? p0?.createdAt ?? new Date().toISOString(),
          parcelaId: p0?.parcelaId ?? p0?.parcela_id ?? p0?.parcelaPrevistaId ?? "",
        };
        if (p.parcelaId) push(String(p.parcelaId), p);
      }
    }

    for (const k of Object.keys(byId)) {
      byId[k].sort((a, b) => String(a.criadoEm ?? "").localeCompare(String(b.criadoEm ?? "")));
    }
    setPagamentosPorParcelaId(byId);
  }, [router]);

  // ===== Linhas manuais por competência =====
  useEffect(() => {
    const existing = loadJson<ManualLine[] | null>(manualKey, null);
    if (existing && Array.isArray(existing) && existing.length === 10) {
      setManual(existing);
      return;
    }

    const base: ManualLine[] = [
      { id: "M1", nome: "Aluguéis", mode: "FIXA_TOTAL", previsto: 0, variacao: 0, descontos: 0, total: 0 },
      { id: "M2", nome: "IPTU", mode: "FIXA_TOTAL", previsto: 0, variacao: 0, descontos: 0, total: 0 },
      { id: "M3", nome: "Condomínios", mode: "FIXA_TOTAL", previsto: 0, variacao: 0, descontos: 0, total: 0 },
      { id: "M4", nome: "Rendas Eventuais", mode: "FIXA_TOTAL", previsto: 0, variacao: 0, descontos: 0, total: 0 },
      { id: "M5", nome: "Receita Financeira", mode: "FIXA_TOTAL", previsto: 0, variacao: 0, descontos: 0, total: 0 },

      { id: "M6", nome: "", mode: "LIVRE_2COL", previsto: 0, variacao: 0, descontos: 0, total: 0 },
      { id: "M7", nome: "", mode: "LIVRE_2COL", previsto: 0, variacao: 0, descontos: 0, total: 0 },
      { id: "M8", nome: "", mode: "LIVRE_2COL", previsto: 0, variacao: 0, descontos: 0, total: 0 },
      { id: "M9", nome: "", mode: "LIVRE_2COL", previsto: 0, variacao: 0, descontos: 0, total: 0 },
      { id: "M10", nome: "", mode: "LIVRE_2COL", previsto: 0, variacao: 0, descontos: 0, total: 0 },
    ];

    setManual(base);
    saveJson(manualKey, base);
  }, [manualKey]);

  useEffect(() => {
    const next: Record<string, { previsto: string; variacao: string; total: string }> = {};
    for (const m of manual) {
      next[m.id] = {
        previsto: formatInputBR(m.previsto || 0),
        variacao: formatInputBR(m.variacao || 0),
        total: formatInputBR(m.total || 0),
      };
    }
    setManualDraft(next);
  }, [manual]);

  function pagamentosDaParcela(parcelaId: string) {
    return (pagamentosPorParcelaId[parcelaId] ?? []).slice();
  }

  function sumPagamentos(list: PagamentoParcial[], kind: PagamentoKind, pred: (p: PagamentoParcial) => boolean) {
    return fmt2(
      list
        .filter((p) => (p.kind ?? "PAGAMENTO") === kind)
        .filter(pred)
        .reduce((s, p) => s + (Number(p.valor) || 0), 0)
    );
  }

  // ====== PIS/COFINS (Base) ======
  const pisRows: PisRow[] = useMemo(() => {
    const mm = String(pisMes).padStart(2, "0");
    const yyyy = String(pisAno);

    const empMap = new Map(empresas.map((e) => [e.id, e]));
    const obraMap = new Map(obras.map((o) => [`${o.empresaId}|${o.id}`, o]));
    const unMap = new Map(unidades.map((u) => [`${u.empresaId}|${u.obraId}|${u.id}`, u]));

    const out: PisRow[] = [];

    for (const p of parcelas) {
      const pays = pagamentosDaParcela(p.id);
      if (!pays.length) continue;

      const pagoNoMes = sumPagamentos(pays, "PAGAMENTO", (x) => inCompetencia(x.data ?? x.dataRecebimento ?? "", mm, yyyy));
      const descNoMes = sumPagamentos(pays, "DESCONTO", (x) => inCompetencia(x.data ?? x.dataRecebimento ?? "", mm, yyyy));

      if (!(pagoNoMes > 0 || descNoMes > 0)) continue;

      const quitAntesPago = sumPagamentos(pays, "PAGAMENTO", (x) => beforeCompetencia(x.data ?? x.dataRecebimento ?? "", mm, yyyy));
      const quitAntesDesc = sumPagamentos(pays, "DESCONTO", (x) => beforeCompetencia(x.data ?? x.dataRecebimento ?? "", mm, yyyy));
      const quitAntes = fmt2(quitAntesPago + quitAntesDesc);

      const totalPrevisto = fmt2(p.valorPrevisto || 0);
      const quitDepois = fmt2(quitAntes + pagoNoMes + descNoMes);

      const quitouNoMes = quitAntes < totalPrevisto && quitDepois >= totalPrevisto && fmt2(pagoNoMes + descNoMes) > 0;

      let previsto = 0;
      let descontos = 0;
      let variacao = 0;
      let totalRecebido = fmt2(pagoNoMes);

      if (quitouNoMes) {
        const faltaParaQuitar = fmt2(Math.max(0, totalPrevisto - quitAntes));
        previsto = faltaParaQuitar;

        descontos = fmt2(-Math.max(0, descNoMes)); // negativo
        variacao = fmt2(totalRecebido - fmt2(previsto + descontos));
      } else {
        previsto = fmt2(totalRecebido);
        descontos = 0;
        variacao = 0;
      }

      totalRecebido = fmt2(previsto + variacao + descontos);

      const emp = empMap.get(pad4(p.empresaId));
      const ob = obraMap.get(`${pad4(p.empresaId)}|${pad4(p.obraId)}`);
      const un = unMap.get(`${pad4(p.empresaId)}|${pad4(p.obraId)}|${pad4(p.unidadeId)}`);

      out.push({
        empresaId: pad4(p.empresaId),
        empresaNome: emp?.razaoSocial ?? "",
        obraId: pad4(p.obraId),
        obraNome: ob?.nome ?? "",
        unidadeId: pad4(p.unidadeId),
        comprador: un?.compradorNome ?? "",
        tipo: p.tipo,
        vencimento: p.vencimento,
        previsto,
        variacao,
        descontos,
        totalRecebido,
        quitouNoMes,
      });
    }

    out.sort((a, b) => {
      const k1 = `${a.empresaId}|${a.obraId}|${a.unidadeId}`;
      const k2 = `${b.empresaId}|${b.obraId}|${b.unidadeId}`;
      const c = k1.localeCompare(k2);
      if (c !== 0) return c;
      const d = sortDateBR(a.vencimento, b.vencimento);
      if (d !== 0) return d;
      return String(a.tipo).localeCompare(String(b.tipo));
    });

    return out;
  }, [pisMes, pisAno, empresas, obras, unidades, parcelas, pagamentosPorParcelaId]);

  const byObra = useMemo(() => {
    const map = new Map<
      string,
      { key: string; empresaId: string; empresaNome: string; obraId: string; obraNome: string; rows: PisRow[] }
    >();
    for (const r of pisRows) {
      const k = `${r.empresaId}|${r.obraId}`;
      if (!map.has(k)) {
        map.set(k, { key: k, empresaId: r.empresaId, empresaNome: r.empresaNome, obraId: r.obraId, obraNome: r.obraNome, rows: [] });
      }
      map.get(k)!.rows.push(r);
    }
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [pisRows]);

  function sumCol(rows: Array<{ previsto: number; variacao: number; descontos: number; totalRecebido: number }>) {
    const previsto = fmt2(rows.reduce((s, x) => s + (x.previsto || 0), 0));
    const variacao = fmt2(rows.reduce((s, x) => s + (x.variacao || 0), 0));
    const descontos = fmt2(rows.reduce((s, x) => s + (x.descontos || 0), 0));
    const totalRecebido = fmt2(rows.reduce((s, x) => s + (x.totalRecebido || 0), 0));
    return { previsto, variacao, descontos, totalRecebido };
  }

  function saveManual(next: ManualLine[]) {
    saveJson(manualKey, next);
  }

  function onManualDraftChange(id: string, field: "previsto" | "variacao" | "total", raw: string) {
    setManualDraft((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { previsto: "0,00", variacao: "0,00", total: "0,00" }), [field]: raw },
    }));
    setProcessado(false);
  }

  function commitManualDraft(id: string, field: "previsto" | "variacao" | "total") {
    const cur = manualDraft[id];
    if (!cur) return;

    const raw = cur[field];
    const v = fmt2(parseMoneyLoose(raw));

    setManual((prev) => {
      const next = prev.map((x) => {
        if (x.id !== id) return x;

        if (x.mode === "FIXA_TOTAL") {
          if (field !== "total") return x;
          return { ...x, total: v, previsto: 0, variacao: 0, descontos: 0 };
        }

        if (field === "previsto") {
          const previsto = v;
          const total = fmt2(previsto + x.variacao);
          return { ...x, previsto, total };
        }
        if (field === "variacao") {
          const variacao = v;
          const total = fmt2(x.previsto + variacao);
          return { ...x, variacao, total };
        }
        return x;
      });

      saveManual(next);
      return next;
    });

    setManualDraft((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? { previsto: "0,00", variacao: "0,00", total: "0,00" }),
        [field]: formatInputBR(v),
      } as any,
    }));
  }

  function setManualName(id: string, nome: string) {
    setManual((prev) => {
      const next = prev.map((x) => (x.id === id ? { ...x, nome } : x));
      saveManual(next);
      return next;
    });
    setProcessado(false);
  }

  const totalsPIS = useMemo(() => {
    const colBase = sumCol(pisRows);
    const manualAsRows = manual.map((m) => ({
      previsto: m.mode === "LIVRE_2COL" ? m.previsto : 0,
      variacao: m.mode === "LIVRE_2COL" ? m.variacao : 0,
      descontos: 0,
      totalRecebido: m.total,
    }));
    const colManual = sumCol(manualAsRows);
    return {
      base: colBase,
      manual: colManual,
      geral: {
        previsto: fmt2(colBase.previsto + colManual.previsto),
        variacao: fmt2(colBase.variacao + colManual.variacao),
        descontos: fmt2(colBase.descontos + colManual.descontos),
        totalRecebido: fmt2(colBase.totalRecebido + colManual.totalRecebido),
      },
    };
  }, [pisRows, manual]);

  function processarPis() {
    setProcessado(true);
    setInfo(`PIS/COFINS processado para competência ${competencia}. Totais calculados no rodapé.`);
  }

  function baixarCSV() {
    const lines: string[] = [];
    lines.push(
      [
        "Competência",
        "Empresa",
        "Obra",
        "Unid",
        "Comprador",
        "Tipo",
        "Vencimento",
        "Previsto",
        "Variação",
        "Descontos",
        "Valor total recebido",
      ].map(csvEscape).join(";")
    );

    for (const bloco of byObra) {
      for (const r of bloco.rows) {
        lines.push(
          [
            competencia,
            `${r.empresaId} — ${r.empresaNome}`,
            `${r.obraId} — ${r.obraNome}`,
            r.unidadeId,
            r.comprador,
            r.tipo,
            r.vencimento,
            formatInputBR(r.previsto),
            formatInputBR(r.variacao),
            formatInputBR(r.descontos),
            formatInputBR(r.totalRecebido),
          ].map(csvEscape).join(";")
        );
      }

      const t = sumCol(bloco.rows);
      lines.push(
        [
          competencia,
          `${bloco.empresaId} — ${bloco.empresaNome}`,
          `${bloco.obraId} — ${bloco.obraNome}`,
          "",
          "",
          "TOTAL OBRA",
          "",
          formatInputBR(t.previsto),
          formatInputBR(t.variacao),
          formatInputBR(t.descontos),
          formatInputBR(t.totalRecebido),
        ].map(csvEscape).join(";")
      );
      lines.push("");
    }

    lines.push(["", "", "", "", "", "LANÇAMENTOS MANUAIS", "", "", "", "", ""].map(csvEscape).join(";"));
    for (const m of manual) {
      lines.push(
        [
          competencia,
          "",
          "",
          "",
          "",
          m.nome || "(sem nome)",
          "",
          formatInputBR(m.mode === "LIVRE_2COL" ? m.previsto : 0),
          formatInputBR(m.mode === "LIVRE_2COL" ? m.variacao : 0),
          formatInputBR(0),
          formatInputBR(m.total),
        ].map(csvEscape).join(";")
      );
    }

    lines.push("");
    lines.push(
      [
        competencia,
        "",
        "",
        "",
        "",
        "TOTAL GERAL",
        "",
        formatInputBR(totalsPIS.geral.previsto),
        formatInputBR(totalsPIS.geral.variacao),
        formatInputBR(totalsPIS.geral.descontos),
        formatInputBR(totalsPIS.geral.totalRecebido),
      ].map(csvEscape).join(";")
    );

    const csv = lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `PIS_COFINS_${String(pisMes).padStart(2, "0")}_${String(pisAno)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setInfo("Arquivo gerado (.csv). O Excel abre normalmente.");
  }

  // ======= RELATÓRIO POR UNIDADE (HTML + print) =======
  function computeFichaRowsForUnidade(un: Unidade, deBR: string, ateBR: string) {
    const ps = parcelas
      .filter((p) => p.empresaId === un.empresaId && p.obraId === un.obraId && p.unidadeId === un.id)
      .slice()
      .sort((a, b) => sortDateBR(a.vencimento, b.vencimento));

    const rows: Array<{
      tipo: TipoPagamento;
      vencimento: string;
      previsto: number;
      variacao: number;
      descontos: number; // negativo
      recebido: number;
      obs: string;
    }> = [];

    for (const p of ps) {
      const pays = pagamentosDaParcela(p.id);
      if (!pays.length) continue;

      const pagoNoPer = sumPagamentos(pays, "PAGAMENTO", (x) => inRangeDateBR(x.data ?? x.dataRecebimento ?? "", deBR, ateBR));
      const descNoPer = sumPagamentos(pays, "DESCONTO", (x) => inRangeDateBR(x.data ?? x.dataRecebimento ?? "", deBR, ateBR));
      if (!(pagoNoPer > 0 || descNoPer > 0)) continue;

      const quitAntesPago = sumPagamentos(pays, "PAGAMENTO", (x) => {
        const dt = x.data ?? x.dataRecebimento ?? "";
        const d = parseDateBR(dt);
        const d1 = parseDateBR(deBR);
        if (!d || !d1) return false;
        return d.getTime() < d1.getTime();
      });
      const quitAntesDesc = sumPagamentos(pays, "DESCONTO", (x) => {
        const dt = x.data ?? x.dataRecebimento ?? "";
        const d = parseDateBR(dt);
        const d1 = parseDateBR(deBR);
        if (!d || !d1) return false;
        return d.getTime() < d1.getTime();
      });
      const quitAntes = fmt2(quitAntesPago + quitAntesDesc);

      const totalPrev = fmt2(p.valorPrevisto || 0);
      const quitDepois = fmt2(quitAntes + pagoNoPer + descNoPer);

      const quitouNoPeriodo = quitAntes < totalPrev && quitDepois >= totalPrev && fmt2(pagoNoPer + descNoPer) > 0;

      let previsto = 0;
      let descontos = 0;
      let variacao = 0;

      // dinheiro recebido no período (cash)
      const cash = fmt2(pagoNoPer);

      if (quitouNoPeriodo) {
        const falta = fmt2(Math.max(0, totalPrev - quitAntes));
        previsto = falta;
        descontos = fmt2(-Math.max(0, descNoPer));
        variacao = fmt2(cash - fmt2(previsto + descontos));
      } else {
        // parcial no período: previsto = cash, sem var/desc
        previsto = fmt2(cash);
        descontos = 0;
        variacao = 0;
      }

      const recebido = fmt2(previsto + variacao + descontos);

      rows.push({
        tipo: p.tipo,
        vencimento: p.vencimento,
        previsto,
        variacao,
        descontos,
        recebido,
        obs: quitouNoPeriodo ? "Quitou no período" : "Pagamento parcial no período",
      });
    }

    const totalPrevisto = fmt2(rows.reduce((s, x) => s + x.previsto, 0));
    const totalVariacao = fmt2(rows.reduce((s, x) => s + x.variacao, 0));
    const totalDescontos = fmt2(rows.reduce((s, x) => s + x.descontos, 0));
    const totalRecebido = fmt2(rows.reduce((s, x) => s + x.recebido, 0));

    return { rows, totals: { totalPrevisto, totalVariacao, totalDescontos, totalRecebido } };
  }

  function totalRecebidoCashNoPeriodo(un: Unidade, deBR: string, ateBR: string) {
    const ps = parcelas.filter((p) => p.empresaId === un.empresaId && p.obraId === un.obraId && p.unidadeId === un.id);
    let total = 0;
    for (const p of ps) {
      const pays = pagamentosDaParcela(p.id);
      total += sumPagamentos(pays, "PAGAMENTO", (x) => inRangeDateBR(x.data ?? x.dataRecebimento ?? "", deBR, ateBR));
    }
    return fmt2(total);
  }

  function openPrintWindow(html: string, title: string) {
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) {
      alert("Seu navegador bloqueou pop-up. Libere pop-ups para gerar o PDF/impressão.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.document.title = title;
    w.focus();
    setTimeout(() => {
      try {
        w.print();
      } catch {}
    }, 250);
  }

  function buildPrintHTML(docs: Array<{ title: string; body: string }>) {
    const css = `
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color:#111; }
      .page { page-break-after: always; }
      .page:last-child { page-break-after: auto; }
      .hdr { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
      .logo { width: 170px; max-height: 70px; object-fit: contain; }
      .h1 { font-size: 16px; font-weight: 900; margin: 0; }
      .muted { color:#555; font-size: 12px; }
      .block { border:1px solid #ddd; border-radius:10px; padding:10px; margin-top:10px; }
      table { width:100%; border-collapse: collapse; margin-top:10px; }
      th, td { border-bottom: 1px solid #eee; padding: 8px; font-size: 12px; }
      th { background:#f7f7f7; text-align:left; font-weight:900; }
      .num { text-align:right; white-space:nowrap; }
      .tot { background:#fafafa; font-weight:900; }
      .neg { color:#b00020; font-weight:900; }
      .sign { margin-top: 22px; display:flex; justify-content:space-between; gap:16px; }
      .line { border-top: 1px solid #333; flex:1; padding-top:6px; font-size:12px; text-align:center; }
      .small { font-size: 11px; color:#444; }
    `;
    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8"/>
          <meta name="viewport" content="width=device-width,initial-scale=1"/>
          <title>Relatório</title>
          <style>${css}</style>
        </head>
        <body>
          ${docs
            .map(
              (d) => `
                <section class="page">
                  ${d.body}
                </section>
              `
            )
            .join("")}
        </body>
      </html>
    `;
  }

  function gerarRelatorioPorUnidade() {
    const deN = normalizeDateOnBlur(de);
    const ateN = normalizeDateOnBlur(ate);

    if (!isValidDateBR(deN) || !isValidDateBR(ateN)) return alert("Período inválido. Use dd/mm/aaaa.");
    const d1 = parseDateBR(deN)!;
    const d2 = parseDateBR(ateN)!;
    if (d2.getTime() < d1.getTime()) return alert("Período inválido: 'Até' é menor que 'De'.");

    // confirmação do Informe se não for ano fechado
    if (unTipo === "INFORME") {
      const yDe = String(d1.getFullYear());
      const yAte = String(d2.getFullYear());
      const isAnoFechado =
        yDe === yAte &&
        deN === `01/01/${yDe}` &&
        ateN === `31/12/${yAte}`;

      if (!isAnoFechado) {
        const ok = confirm(
          `ATENÇÃO: O Informe de Rendimentos normalmente é do exercício inteiro.\n\nPeríodo selecionado: ${deN} até ${ateN}\n\nConfirma que deseja continuar?`
        );
        if (!ok) return;
      }
    }

    // filtros (vazios = todos)
    const empF = fEmp ? pad4(fEmp) : "";
    const obraF = fObra ? pad4(fObra) : "";
    const unF = fUnid ? pad4(fUnid) : "";

    let baseUnidades = unidades.slice();

    if (empF) baseUnidades = baseUnidades.filter((u) => u.empresaId === empF);
    if (obraF) baseUnidades = baseUnidades.filter((u) => u.obraId === obraF);
    if (unF) baseUnidades = baseUnidades.filter((u) => u.id === unF);

    // regra: se não selecionar, imprime todas que atendem e que tenham recebimento no período
    const selecionadas = baseUnidades
      .filter((u) => {
        const cash = totalRecebidoCashNoPeriodo(u, deN, ateN);
        return cash > 0; // só quem teve recebido no período
      })
      .sort((a, b) => `${a.empresaId}|${a.obraId}|${a.id}`.localeCompare(`${b.empresaId}|${b.obraId}|${b.id}`));

    if (selecionadas.length === 0) {
      alert("Nenhuma unidade com recebimento no período e filtros informados.");
      return;
    }

    const empMap = new Map(empresas.map((e) => [e.id, e]));
    const obraMap = new Map(obras.map((o) => [`${o.empresaId}|${o.id}`, o]));

    // abre uma janela por unidade (facilita salvar PDF individual)
    for (const u of selecionadas) {
      const emp = empMap.get(u.empresaId);
      const ob = obraMap.get(`${u.empresaId}|${u.obraId}`);

      const empresaNome = emp?.razaoSocial ?? "";
      const empresaCnpj = (emp as any)?.cnpj ?? "";
      const obraNome = ob?.nome ?? "";

      const logoSrc = getLogoSrc();

      if (unTipo === "FICHA") {
        const { rows, totals } = computeFichaRowsForUnidade(u, deN, ateN);

        const body = `
          <div class="hdr">
            <img class="logo" src="${logoSrc}" alt="Logo"/>
            <div style="text-align:right">
              <div class="h1">FICHA DA UNIDADE</div>
              <div class="muted">Período: <b>${deN}</b> até <b>${ateN}</b></div>
            </div>
          </div>

          <div class="block">
            <div><b>Empresa:</b> ${u.empresaId} — ${empresaNome}${empresaCnpj ? ` | <b>CNPJ:</b> ${empresaCnpj}` : ""}</div>
            <div><b>Obra:</b> ${u.obraId} — ${obraNome}</div>
            <div style="margin-top:6px"><b>Unidade:</b> ${u.id} | <b>Comprador:</b> ${u.compradorNome || "—"}${u.compradorCpfCnpj ? ` | <b>CPF/CNPJ:</b> ${u.compradorCpfCnpj}` : ""}</div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Venc.</th>
                <th class="num">Previsto</th>
                <th class="num">Variação</th>
                <th class="num">Descontos</th>
                <th class="num">Valor recebido</th>
                <th>Obs.</th>
              </tr>
            </thead>
            <tbody>
              ${
                rows.length
                  ? rows
                      .map((r) => {
                        const negV = r.variacao < 0;
                        const negD = r.descontos < 0;
                        return `
                          <tr>
                            <td>${r.tipo}</td>
                            <td>${r.vencimento}</td>
                            <td class="num"><b>${moneyBR(r.previsto)}</b></td>
                            <td class="num ${negV ? "neg" : ""}">${moneyBR(r.variacao)}</td>
                            <td class="num ${negD ? "neg" : ""}">${moneyBR(r.descontos)}</td>
                            <td class="num"><b>${moneyBR(r.recebido)}</b></td>
                            <td>${r.obs}</td>
                          </tr>
                        `;
                      })
                      .join("")
                  : `<tr><td colspan="7" class="small">Nenhum lançamento no período.</td></tr>`
              }
            </tbody>
            <tfoot>
              <tr class="tot">
                <td colspan="2">TOTAL RECEBIDO NO PERÍODO</td>
                <td class="num">${moneyBR(totals.totalPrevisto)}</td>
                <td class="num">${moneyBR(totals.totalVariacao)}</td>
                <td class="num">${moneyBR(totals.totalDescontos)}</td>
                <td class="num">${moneyBR(totals.totalRecebido)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>

          <div class="small" style="margin-top:10px">
            Obs.: esta ficha mostra somente parcelas que tiveram recebimento (ou quitação) no período selecionado. Totais representam o efetivamente recebido (inclui parciais), com variação e descontos conforme regras do sistema.
          </div>

          <div class="sign">
            <div class="line">Assinatura</div>
            <div class="line">Data</div>
          </div>
        `;

        const html = buildPrintHTML([{ title: "Ficha", body }]);
        const fname = `${u.empresaId}_${u.id}_ficha_${onlyDigits(deN).slice(4, 8)}${onlyDigits(ateN).slice(4, 8)}`.replace(/\s+/g, "_");
        openPrintWindow(html, fname);
      } else {
        // INFORME
        const totalCash = totalRecebidoCashNoPeriodo(u, deN, ateN);
        const valorExt = extensoBR(totalCash);

        const body = `
          <div class="hdr">
            <img class="logo" src="${logoSrc}" alt="Logo"/>
            <div style="text-align:right">
              <div class="h1">INFORME DE RENDIMENTOS</div>
              <div class="muted">Período: <b>${deN}</b> até <b>${ateN}</b></div>
            </div>
          </div>

          <div class="block">
            <div><b>Fonte Pagadora (Empresa):</b> ${u.empresaId} — ${empresaNome}${empresaCnpj ? ` | <b>CNPJ:</b> ${empresaCnpj}` : ""}</div>
            <div><b>Obra:</b> ${u.obraId} — ${obraNome}</div>
            <div style="margin-top:6px"><b>Beneficiário (Comprador):</b> ${u.compradorNome || "—"}${u.compradorCpfCnpj ? ` | <b>CPF/CNPJ:</b> ${u.compradorCpfCnpj}` : ""}</div>
            <div style="margin-top:6px"><b>Unidade:</b> ${u.id}</div>
          </div>

          <div class="block">
            <div style="font-weight:900;margin-bottom:6px">Rendimentos Recebidos (no período)</div>
            <table>
              <thead>
                <tr>
                  <th>Descrição</th>
                  <th class="num">Valor (R$)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Valores recebidos no período (${deN} a ${ateN})</td>
                  <td class="num"><b>${moneyBR(totalCash)}</b></td>
                </tr>
              </tbody>
            </table>

            <div class="small" style="margin-top:10px">
              <b>Valor por extenso:</b> ${valorExt}.
            </div>
          </div>

          <div class="small" style="margin-top:10px">
            Obs.: Informe gerado pelo sistema com base em recebimentos (PAGAMENTO) registrados no período. Descontos não representam entrada de caixa.
          </div>

          <div class="sign">
            <div class="line">Assinatura / Responsável</div>
            <div class="line">Data</div>
          </div>
        `;

        const html = buildPrintHTML([{ title: "Informe", body }]);
        const anoRef = parseDateBR(ateN)?.getFullYear() ?? new Date().getFullYear();
        const fname = `${u.empresaId}_${u.id}_informe_${anoRef}`.replace(/\s+/g, "_");
        openPrintWindow(html, fname);
      }
    }

    setShowUnModal(false);
    setInfo(`Relatório "${unTipo === "FICHA" ? "Ficha" : "Informe"}" gerado para ${selecionadas.length} unidade(s).`);
  }

  // ====== Filtros dependentes (combos) ======
  const obrasDaEmpresa = useMemo(() => {
    const emp = fEmp ? pad4(fEmp) : "";
    const list = emp ? obras.filter((o) => o.empresaId === emp) : obras.slice();
    return list.sort((a, b) => `${a.empresaId}|${a.id}`.localeCompare(`${b.empresaId}|${b.id}`));
  }, [obras, fEmp]);

  const unidadesDaSelecao = useMemo(() => {
    const emp = fEmp ? pad4(fEmp) : "";
    const ob = fObra ? pad4(fObra) : "";
    let list = unidades.slice();
    if (emp) list = list.filter((u) => u.empresaId === emp);
    if (ob) list = list.filter((u) => u.obraId === ob);
    return list.sort((a, b) => `${a.empresaId}|${a.obraId}|${a.id}`.localeCompare(`${b.empresaId}|${b.obraId}|${b.id}`));
  }, [unidades, fEmp, fObra]);

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

  const tableCss = `
    .mini{font-size:13px;color:#666}
    .tabs{display:flex;gap:8px;flex-wrap:wrap}
    .tabBtn{padding:10px 12px;border-radius:10px;border:1px solid #ddd;background:#fff;cursor:pointer;font-weight:900}
    .tabBtnOn{background:#eef4ff;border-color:#0b4fd6;color:#0b4fd6}
    .gridTop{display:grid;grid-template-columns:1.2fr 1fr;gap:12px}
    @media(max-width:1100px){.gridTop{grid-template-columns:1fr}}
    .table{width:100%;border-collapse:collapse}
    .th{background:#f7f7f7;text-align:left;padding:10px;font-weight:900;border-bottom:1px solid #eee}
    .td{padding:10px;border-bottom:1px solid #eee}
    .nowrap{white-space:nowrap}
    .num{text-align:right}
    .neg{color:#b00020;font-weight:900}
    .moneyInput{width:100%;padding:10px;border-radius:10px;border:1px solid #ccc;text-align:right;font-weight:900}
    .nameInput{width:100%;padding:10px;border-radius:10px;border:1px solid #ccc}
    .pill{font-size:12px;font-weight:900;padding:4px 8px;border-radius:999px;background:#f3f3f3}
    .modalOverlay{position:fixed;inset:0;background:rgba(0,0,0,0.45);display:grid;place-items:center;padding:18px;z-index:50}
    .modal{width:min(980px,98vw);max-height:92vh;overflow:auto;background:#fff;border-radius:14px;padding:14px;box-shadow:0 20px 60px rgba(0,0,0,0.35)}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    @media(max-width:900px){.grid2{grid-template-columns:1fr}}
  `;

  if (!session) {
    return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>Carregando...</main>;
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f2f2f2", padding: 16 }}>
      <style>{tableCss}</style>

      <div style={{ maxWidth: 1500, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, color: "#333" }}>Controle de Imóveis — Relatórios</h1>
            <div className="mini" style={{ marginTop: 6 }}>
              Usuário: <b>{session.username}</b> ({session.role})
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button style={btn} onClick={() => router.push("/dashboard")}>Voltar</button>
            <button style={btn} onClick={() => router.push("/gestao")}>Gestão</button>
            <button style={btn} onClick={() => router.push("/processamento")}>Processamento</button>
          </div>
        </div>

        {info && (
          <div style={{ marginTop: 12, background: "#e9f2ff", border: "1px solid #b7d2ff", color: "#0b2a66", padding: 10, borderRadius: 10 }}>
            {info}
          </div>
        )}

        <div style={{ ...card, marginTop: 12 }}>
          <div className="tabs">
            <button className={`tabBtn ${tab === "PIS" ? "tabBtnOn" : ""}`} onClick={() => setTab("PIS")}>
              PIS/COFINS
            </button>
            <button className={`tabBtn ${tab === "UNIDADE" ? "tabBtnOn" : ""}`} onClick={() => setTab("UNIDADE")}>
              Por Unidade
            </button>
            <button className={`tabBtn ${tab === "PERIODO" ? "tabBtnOn" : ""}`} onClick={() => setTab("PERIODO")}>
              Por Período (em breve)
            </button>
          </div>
        </div>

        {tab === "PIS" && (
          <>
            <div style={{ marginTop: 12 }} className="gridTop">
              <section style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>Competência PIS/COFINS</h2>
                  <span className="pill">Sempre por mês/ano</span>
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
                  <div style={{ minWidth: 120 }}>
                    <div className="mini">Mês</div>
                    <input
                      className="nameInput"
                      value={pisMes}
                      onChange={(e) => {
                        setPisMes(onlyDigits(e.target.value).slice(0, 2).padStart(2, "0"));
                        setProcessado(false);
                      }}
                      placeholder="MM"
                    />
                  </div>

                  <div style={{ minWidth: 160 }}>
                    <div className="mini">Ano</div>
                    <input
                      className="nameInput"
                      value={pisAno}
                      onChange={(e) => {
                        setPisAno(onlyDigits(e.target.value).slice(0, 4));
                        setProcessado(false);
                      }}
                      onBlur={() => setPisAno((v) => normalizeAnoOnBlur(v))}
                      placeholder="AAAA"
                    />
                  </div>

                  <div style={{ padding: "10px 12px", borderRadius: 10, background: "#f7f7f7", border: "1px solid #e6e6e6", fontWeight: 900, color: "#333" }}>
                    Competência: {competencia}
                  </div>
                </div>

                <div className="mini" style={{ marginTop: 10 }}>
                  Regras principais:
                  <ul style={{ margin: "6px 0 0 18px" }}>
                    <li>Se <b>quitou no mês</b>: Previsto = <b>falta para quitar</b>; Descontos (negativo) e Variação calculados; Total = soma.</li>
                    <li>Se <b>não quitou</b>: Previsto = <b>dinheiro recebido no mês</b>; Variação = 0; Descontos = 0; Total = Previsto.</li>
                    <li>Última coluna <b>sempre</b> é o resultado: <b>Previsto + Variação + Descontos</b>.</li>
                  </ul>
                </div>
              </section>

              <section style={card}>
                <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>Ações</h2>

                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button style={primaryBtn} onClick={processarPis}>
                    Processar PIS/COFINS
                  </button>

                  <button style={btn} onClick={baixarCSV}>
                    Baixar Excel (CSV)
                  </button>

                  <button
                    style={!isMaster ? { ...btn, opacity: 0.6, cursor: "not-allowed" } : btn}
                    disabled={!isMaster}
                    onClick={() => {
                      if (!isMaster) return;
                      localStorage.removeItem(manualKey);
                      setInfo("Linhas manuais resetadas para esta competência. Recarregue a página (F5).");
                    }}
                    title="Somente Master"
                  >
                    Reset linhas manuais
                  </button>
                </div>

                <div className="mini" style={{ marginTop: 10 }}>
                  {processado ? (
                    <span style={{ fontWeight: 900, color: "#0b4fd6" }}>Processado ✅ (totais exibidos no rodapé)</span>
                  ) : (
                    <span>Não processado ainda (você pode processar após ajustar as linhas manuais).</span>
                  )}
                </div>
              </section>
            </div>

            {/* Tabela principal */}
            <section style={{ ...card, marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>Relatório PIS/COFINS (recebimentos do mês)</h2>
                <div className="mini">Mostra somente parcelas com recebimentos (ou quitação) no mês selecionado.</div>
              </div>

              {pisRows.length === 0 ? (
                <div className="mini" style={{ marginTop: 10 }}>
                  Nenhum recebimento encontrado na competência <b>{competencia}</b>.
                </div>
              ) : (
                <div style={{ marginTop: 10, overflow: "auto", border: "1px solid #eee", borderRadius: 12, maxHeight: "60vh" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="th nowrap">Empresa</th>
                        <th className="th nowrap">Obra</th>
                        <th className="th nowrap">Unid</th>
                        <th className="th nowrap">Comprador</th>
                        <th className="th nowrap">Tipo</th>
                        <th className="th nowrap">Venc.</th>

                        <th className="th nowrap num">Previsto</th>
                        <th className="th nowrap num">Variação</th>
                        <th className="th nowrap num">Descontos</th>
                        <th className="th nowrap num">Valor total recebido</th>
                      </tr>
                    </thead>

                    <tbody>
                      {byObra.map((bloco) => {
                        const tot = sumCol(bloco.rows);

                        return (
                          <tbody key={bloco.key}>
                            {bloco.rows.map((r) => {
                              const negVar = r.variacao < 0;
                              const negDesc = r.descontos < 0;
                              return (
                                <tr key={`${r.unidadeId}|${r.tipo}|${r.vencimento}`}>
                                  <td className="td nowrap">{r.empresaId}</td>
                                  <td className="td nowrap">
                                    {r.obraId} — {r.obraNome}
                                  </td>
                                  <td className="td nowrap">{r.unidadeId}</td>
                                  <td className="td nowrap">{r.comprador || "—"}</td>
                                  <td className="td nowrap">
                                    {r.tipo}{" "}
                                    {r.quitouNoMes ? <span className="pill" style={{ marginLeft: 6, background: "#e9fff0" }}>Quitou no mês</span> : null}
                                  </td>
                                  <td className="td nowrap">{r.vencimento}</td>

                                  <td className="td nowrap num" style={{ fontWeight: 900 }}>{moneyBR(r.previsto)}</td>

                                  <td className={`td nowrap num ${negVar ? "neg" : ""}`} style={{ fontWeight: r.variacao !== 0 ? 900 : 400 }}>
                                    {moneyBR(r.variacao)}
                                  </td>

                                  <td className={`td nowrap num ${negDesc ? "neg" : ""}`} style={{ fontWeight: r.descontos !== 0 ? 900 : 400 }}>
                                    {moneyBR(r.descontos)}
                                  </td>

                                  <td className="td nowrap num" style={{ fontWeight: 1000 }}>{moneyBR(r.totalRecebido)}</td>
                                </tr>
                              );
                            })}

                            <tr>
                              <td className="td" colSpan={6} style={{ fontWeight: 1000, background: "#fafafa" }}>
                                TOTAL OBRA — {bloco.obraId} — {bloco.obraNome}
                              </td>
                              <td className="td nowrap num" style={{ fontWeight: 1000, background: "#fafafa" }}>{moneyBR(tot.previsto)}</td>
                              <td className="td nowrap num" style={{ fontWeight: 1000, background: "#fafafa" }}>{moneyBR(tot.variacao)}</td>
                              <td className="td nowrap num" style={{ fontWeight: 1000, background: "#fafafa" }}>{moneyBR(tot.descontos)}</td>
                              <td className="td nowrap num" style={{ fontWeight: 1000, background: "#fafafa" }}>{moneyBR(tot.totalRecebido)}</td>
                            </tr>

                            <tr>
                              <td className="td" colSpan={10} style={{ padding: 6, borderBottom: "none" }} />
                            </tr>
                          </tbody>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Linhas manuais */}
            <section style={{ ...card, marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>Lançamentos manuais (10 linhas)</h2>
                <div className="mini">
                  As 5 primeiras aceitam valor só em <b>Valor total recebido</b>. As 5 últimas têm nome editável e aceitam <b>Previsto</b> e <b>Variação</b>.
                </div>
              </div>

              <div style={{ marginTop: 10, overflow: "auto", border: "1px solid #eee", borderRadius: 12 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th className="th nowrap" style={{ width: 420 }}>Descrição</th>
                      <th className="th nowrap num">Previsto</th>
                      <th className="th nowrap num">Variação</th>
                      <th className="th nowrap num">Descontos</th>
                      <th className="th nowrap num">Valor total recebido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {manual.map((m) => {
                      const isFixa = m.mode === "FIXA_TOTAL";
                      const isLivre = m.mode === "LIVRE_2COL";

                      return (
                        <tr key={m.id}>
                          <td className="td">
                            {isFixa ? (
                              <div style={{ fontWeight: 1000, color: "#333" }}>{m.nome}</div>
                            ) : (
                              <input
                                className="nameInput"
                                value={m.nome}
                                onChange={(e) => setManualName(m.id, e.target.value)}
                                placeholder="Digite o nome..."
                              />
                            )}
                          </td>

                          <td className="td num">
                            {isLivre ? (
                              <input
                                className="moneyInput"
                                inputMode="decimal"
                                value={manualDraft[m.id]?.previsto ?? "0,00"}
                                onFocus={(e) => e.currentTarget.select()}
                                onChange={(e) => onManualDraftChange(m.id, "previsto", e.target.value)}
                                onBlur={() => commitManualDraft(m.id, "previsto")}
                              />
                            ) : (
                              <span className="mini">—</span>
                            )}
                          </td>

                          <td className="td num">
                            {isLivre ? (
                              <input
                                className="moneyInput"
                                inputMode="decimal"
                                value={manualDraft[m.id]?.variacao ?? "0,00"}
                                onFocus={(e) => e.currentTarget.select()}
                                onChange={(e) => onManualDraftChange(m.id, "variacao", e.target.value)}
                                onBlur={() => commitManualDraft(m.id, "variacao")}
                              />
                            ) : (
                              <span className="mini">—</span>
                            )}
                          </td>

                          <td className="td num">
                            <span className="mini">—</span>
                          </td>

                          <td className="td num">
                            {isFixa ? (
                              <input
                                className="moneyInput"
                                inputMode="decimal"
                                value={manualDraft[m.id]?.total ?? "0,00"}
                                onFocus={(e) => e.currentTarget.select()}
                                onChange={(e) => onManualDraftChange(m.id, "total", e.target.value)}
                                onBlur={() => commitManualDraft(m.id, "total")}
                              />
                            ) : (
                              <div style={{ fontWeight: 1000 }}>{moneyBR(m.total)}</div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>

                  <tfoot>
                    <tr>
                      <td className="td" style={{ fontWeight: 1000, background: "#fafafa" }}>
                        TOTAL MANUAL
                      </td>
                      <td className="td num" style={{ fontWeight: 1000, background: "#fafafa" }}>
                        {moneyBR(totalsPIS.manual.previsto)}
                      </td>
                      <td className="td num" style={{ fontWeight: 1000, background: "#fafafa" }}>
                        {moneyBR(totalsPIS.manual.variacao)}
                      </td>
                      <td className="td num" style={{ fontWeight: 1000, background: "#fafafa" }}>
                        {moneyBR(totalsPIS.manual.descontos)}
                      </td>
                      <td className="td num" style={{ fontWeight: 1000, background: "#fafafa" }}>
                        {moneyBR(totalsPIS.manual.totalRecebido)}
                      </td>
                    </tr>

                    <tr>
                      <td className="td" style={{ fontWeight: 1100, background: "#eef4ff" }}>
                        TOTAL GERAL (Base + Manual)
                      </td>
                      <td className="td num" style={{ fontWeight: 1100, background: "#eef4ff" }}>
                        {moneyBR(totalsPIS.geral.previsto)}
                      </td>
                      <td className="td num" style={{ fontWeight: 1100, background: "#eef4ff" }}>
                        {moneyBR(totalsPIS.geral.variacao)}
                      </td>
                      <td className="td num" style={{ fontWeight: 1100, background: "#eef4ff" }}>
                        {moneyBR(totalsPIS.geral.descontos)}
                      </td>
                      <td className="td num" style={{ fontWeight: 1100, background: "#eef4ff" }}>
                        {moneyBR(totalsPIS.geral.totalRecebido)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="mini" style={{ marginTop: 10 }}>
                Dica: clique no valor e ele seleciona tudo (fica rápido pra digitar).
              </div>
            </section>
          </>
        )}

        {tab === "UNIDADE" && (
          <section style={{ ...card, marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>Relatório por Unidade</h2>
              <div className="mini">Gera Ficha da Unidade ou Informe de Rendimentos e abre o diálogo de impressão (PDF/A4).</div>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button style={primaryBtn} onClick={() => setShowUnModal(true)}>
                Abrir filtros e imprimir
              </button>
              <button style={btn} onClick={() => {
                setFEmp(""); setFObra(""); setFUnid("");
                setDe(`01/01/${String(new Date().getFullYear())}`);
                setAte(`31/12/${String(new Date().getFullYear())}`);
                setUnTipo("FICHA");
                setInfo("Filtros resetados.");
              }}>
                Limpar filtros
              </button>
            </div>

            <div className="mini" style={{ marginTop: 12 }}>
              Regras:
              <ul style={{ margin: "6px 0 0 18px" }}>
                <li>Se não selecionar Empresa/Obra/Unidade, o sistema imprime <b>todas as unidades</b> com recebimento no período.</li>
                <li>Cada unidade sai em <b>uma folha A4</b> (separada).</li>
                <li>Você pode escolher “Salvar em PDF” ou qualquer impressora.</li>
              </ul>
            </div>
          </section>
        )}

        {tab === "PERIODO" && (
          <section style={{ ...card, marginTop: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>Em breve</h2>
            <div className="mini" style={{ marginTop: 8 }}>
              Aqui entraremos com relatórios agregados por período, conforme você for validando os de Unidade.
            </div>
          </section>
        )}
      </div>

      {/* MODAL POR UNIDADE */}
      {showUnModal && (
        <div className="modalOverlay" onMouseDown={() => setShowUnModal(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 1000, fontSize: 16, color: "#333" }}>Relatório por Unidade</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={btn} onClick={() => setShowUnModal(false)}>Cancelar</button>
                <button style={primaryBtn} onClick={gerarRelatorioPorUnidade}>Imprimir / PDF</button>
              </div>
            </div>

            <div className="mini" style={{ marginTop: 8 }}>
              Se deixar Empresa/Obra/Unidade em branco, imprime todas que tiveram recebimento no período.
            </div>

            <div style={{ marginTop: 12 }} className="grid2">
              <div>
                <div className="mini">Tipo de relatório</div>
                <select className="nameInput" value={unTipo} onChange={(e) => setUnTipo(e.target.value as UnidadeReportTipo)}>
                  <option value="FICHA">Ficha da Unidade</option>
                  <option value="INFORME">Informe de Rendimentos</option>
                </select>
              </div>

              <div>
                <div className="mini">Empresa (opcional)</div>
                <select
                  className="nameInput"
                  value={fEmp}
                  onChange={(e) => {
                    setFEmp(pad4(e.target.value));
                    setFObra("");
                    setFUnid("");
                  }}
                >
                  <option value="">(Todas)</option>
                  {empresas.slice().sort((a, b) => a.id.localeCompare(b.id)).map((e) => (
                    <option key={e.id} value={e.id}>{e.id} — {e.razaoSocial}</option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mini">Obra (opcional)</div>
                <select
                  className="nameInput"
                  value={fObra}
                  onChange={(e) => {
                    setFObra(pad4(e.target.value));
                    setFUnid("");
                  }}
                >
                  <option value="">(Todas)</option>
                  {obrasDaEmpresa.map((o) => (
                    <option key={`${o.empresaId}|${o.id}`} value={o.id}>
                      {o.id} — {o.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mini">Unidade (opcional)</div>
                <select className="nameInput" value={fUnid} onChange={(e) => setFUnid(pad4(e.target.value))}>
                  <option value="">(Todas)</option>
                  {unidadesDaSelecao.map((u) => (
                    <option key={`${u.empresaId}|${u.obraId}|${u.id}`} value={u.id}>
                      {u.id} — {u.compradorNome || "—"}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mini">Período — De</div>
                <input
                  className="nameInput"
                  value={dateMask(de)}
                  onChange={(e) => setDe(e.target.value)}
                  onBlur={(e) => setDe(normalizeDateOnBlur(e.target.value))}
                  placeholder="01/01/2026"
                />
              </div>

              <div>
                <div className="mini">Período — Até</div>
                <input
                  className="nameInput"
                  value={dateMask(ate)}
                  onChange={(e) => setAte(e.target.value)}
                  onBlur={(e) => setAte(normalizeDateOnBlur(e.target.value))}
                  placeholder={today}
                />
              </div>
            </div>

            <div className="mini" style={{ marginTop: 10 }}>
              Dica: para Informe de Rendimentos do ano, use <b>01/01</b> até <b>31/12</b>.
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
