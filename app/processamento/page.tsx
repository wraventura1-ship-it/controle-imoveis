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
  compradorNome: string;
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

type PagamentoKind = "PAGAMENTO" | "DESCONTO"; // DESCONTO quita, mas NÃO conta como recebido
type PagamentoParcial = {
  id: string;
  parcelaId: string;
  valor: number;
  data: string; // dd/mm/aaaa
  criadoEm: string; // ISO
  loteId?: string;
  kind?: PagamentoKind; // antigos: assume PAGAMENTO
};

type PagamentosPorParcela = Record<string, PagamentoParcial[]>;

const STORAGE_EMPRESAS = "ci_empresas";
const STORAGE_OBRAS = "ci_obras";
const STORAGE_UNIDADES = "ci_unidades";
const STORAGE_PARCELAS = "ci_parcelas_previstas";
const STORAGE_PAGAMENTOS = "ci_pagamentos_parciais";

// ✅ alvo vindo do Gestão (para abrir a unidade certa)
const STORAGE_PROCESSAMENTO_TARGET = "ci_processamento_target";

// ✅ relatório PIS/COFINS (novo formato)
const STORAGE_PISCOFINS_V2 = "ci_relatorio_piscofins_v2";
const STORAGE_PISCOFINS_V2_EXTRAS = "ci_relatorio_piscofins_v2_extras";

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
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  } catch {
    return `R$ ${v.toFixed(2)}`;
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
  if (!da || !db) return a.localeCompare(b);
  return da.getTime() - db.getTime();
}
function todayBR() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}
function ymOfDateBR(s: string) {
  const d = parseDateBR(s);
  if (!d) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${mm}/${yyyy}`;
}
function parseMoneyInput(s: string) {
  const t = String(s ?? "").trim();
  if (!t) return 0;
  const normalized = t.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}
function dateTypingMask(raw: string) {
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
function dateNormalizeOnBlur(raw: string) {
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
  const m = String(s ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return false;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const dt = new Date(yyyy, mm - 1, dd);
  return dt.getFullYear() === yyyy && dt.getMonth() === mm - 1 && dt.getDate() === dd;
}
function uuid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

// ===== cores estáveis por lote (pastel) =====
function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function pastelFromId(id: string) {
  const h = hashStr(id || "x");
  const hue = h % 360;
  return `hsl(${hue} 70% 92%)`;
}
function borderFromId(id: string) {
  const h = hashStr(id || "x");
  const hue = h % 360;
  return `hsl(${hue} 70% 45%)`;
}

/* ===========================
   ✅ Relatório PIS/COFINS V2
   =========================== */

type RelUnitRow = {
  kind: "UNIT";
  obraId: string;
  obraNome: string;
  unidadeId: string;
  unidadeNome: string;

  previsto: number;
  variacao: number;
  desconto: number; // sempre negativo (ou 0)
  recebido: number; // PAGAMENTO do mês
};

type RelSubtotalRow = {
  kind: "SUBTOTAL";
  obraId: string;
  obraNome: string;
  previsto: number;
  variacao: number;
  desconto: number;
  recebido: number;
};

type RelGrandTotalRow = {
  kind: "TOTAL";
  previsto: number;
  variacao: number;
  desconto: number;
  recebido: number;
};

type RelRow = RelUnitRow | RelSubtotalRow | RelGrandTotalRow;

type ExtraRow = {
  id: string;
  fixed: boolean;
  nome: string;

  previsto: number;
  variacao: number;
  desconto: number;
  recebido: number;
};

function defaultExtras(): ExtraRow[] {
  const fixedNames = ["Aluguéis", "Condomínios", "IPTU", "Rendas Eventuais", "Receita Financeira"];
  const fixed = fixedNames.map((n) => ({
    id: "FX-" + n,
    fixed: true,
    nome: n,
    previsto: 0,
    variacao: 0,
    desconto: 0,
    recebido: 0,
  }));
  const free = Array.from({ length: 5 }).map((_, i) => ({
    id: "FR-" + i,
    fixed: false,
    nome: "",
    previsto: 0,
    variacao: 0,
    desconto: 0,
    recebido: 0,
  }));
  return [...fixed, ...free];
}

function extrasKey(empId: string, mesAno: string) {
  return `${STORAGE_PISCOFINS_V2_EXTRAS}::${pad4(empId)}::${mesAno}`;
}

export default function ProcessamentoPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [obras, setObras] = useState<Obra[]>([]);
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [parcelas, setParcelas] = useState<ParcelaPrevista[]>([]);
  const [pagamentos, setPagamentos] = useState<PagamentosPorParcela>({});

  const [empresaSel, setEmpresaSel] = useState("");
  const [obraSel, setObraSel] = useState("");
  const [unidadeSel, setUnidadeSel] = useState("");

  const [procMes, setProcMes] = useState(String(new Date().getMonth() + 1).padStart(2, "0"));
  const [procAno, setProcAno] = useState(String(new Date().getFullYear()));

  const [pagasAgoraIds, setPagasAgoraIds] = useState<Set<string>>(new Set());

  // modal pagamento individual
  const [showPagar, setShowPagar] = useState(false);
  const [parcelaPagarId, setParcelaPagarId] = useState("");
  const [pagarValor, setPagarValor] = useState("");
  const [pagarData, setPagarData] = useState(todayBR());
  const [pagarDesconto, setPagarDesconto] = useState(false);

  // modal lote
  const [showLote, setShowLote] = useState(false);
  const [loteTipo, setLoteTipo] = useState<TipoPagamento>("Mensal");
  const [loteValor, setLoteValor] = useState("");
  const [loteData, setLoteData] = useState(todayBR());
  const [loteDesconto, setLoteDesconto] = useState(false);
  const [loteQtd, setLoteQtd] = useState("");
  const [loteFixado, setLoteFixado] = useState(false);

  // modal quitar unidade
  const [showQuitar, setShowQuitar] = useState(false);
  const [quitarValor, setQuitarValor] = useState("");
  const [quitarData, setQuitarData] = useState(todayBR());
  const [showSimDetalhe, setShowSimDetalhe] = useState(false);

  // ✅ modal histórico (PARCIAL / LOTE / PARCELA)  <<<<<< ALTERADO
  const [showParcial, setShowParcial] = useState(false);
  const [historicoModo, setHistoricoModo] = useState<"PARCIAL" | "PARCELA" | "LOTE">("PARCIAL");
  const [parcialParcelaId, setParcialParcelaId] = useState("");
  const [parcialMode, setParcialMode] = useState<"PARCIAL" | "PARCELA" | "LOTE">("PARCIAL");
  const [historicoLoteId, setHistoricoLoteId] = useState("");

  const [info, setInfo] = useState<string | null>(null);

  // ✅ Relatório PIS/COFINS V2 state
  const [relRows, setRelRows] = useState<RelRow[]>([]);
  const [relExtras, setRelExtras] = useState<ExtraRow[]>(defaultExtras());

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
    setObras(loadJson<Obra[]>(STORAGE_OBRAS, []).map((o) => ({ ...o, id: pad4(o.id), empresaId: pad4(o.empresaId) })));
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

    const rawPays = loadJson<PagamentosPorParcela>(STORAGE_PAGAMENTOS, {});
    const migrated: PagamentosPorParcela = {};
    for (const k of Object.keys(rawPays)) {
      migrated[k] = (rawPays[k] ?? []).map((x) => ({
        ...x,
        kind: (x.kind as any) ?? "PAGAMENTO",
      }));
    }
    setPagamentos(migrated);
    saveJson(STORAGE_PAGAMENTOS, migrated);

    const saved = loadJson<{ mesAno: string; empresaId: string; rows: RelRow[] }>(STORAGE_PISCOFINS_V2, {
      mesAno: "",
      empresaId: "",
      rows: [],
    });
    setRelRows(saved.rows ?? []);
  }, []);

  const procYM = `${procMes}/${procAno}`;

  // ✅ aplica alvo vindo do Gestão (ci_processamento_target)
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_PROCESSAMENTO_TARGET);
    if (!raw) return;

    try {
      const t = JSON.parse(raw) as { empresaId?: string; obraId?: string; unidadeId?: string; from?: string; at?: string };
      const emp = pad4(t.empresaId);
      const ob = pad4(t.obraId);
      const un = pad4(t.unidadeId);

      if (emp && ob && un) {
        setEmpresaSel(emp);
        setObraSel(ob);
        setUnidadeSel(un);
        setPagasAgoraIds(new Set());

        setTimeout(() => {
          document.getElementById(`unit_${un}`)?.scrollIntoView({ block: "nearest" });
        }, 0);
      }

      localStorage.removeItem(STORAGE_PROCESSAMENTO_TARGET);
    } catch {
      localStorage.removeItem(STORAGE_PROCESSAMENTO_TARGET);
    }
  }, [unidades, obras, empresas]);

  const isMaster = session?.role === "MASTER";

  const empresaAtual = useMemo(() => empresas.find((e) => e.id === pad4(empresaSel)) || null, [empresas, empresaSel]);
  const obraAtual = useMemo(
    () => obras.find((o) => o.empresaId === pad4(empresaSel) && o.id === pad4(obraSel)) || null,
    [obras, empresaSel, obraSel]
  );
  // ✅ critério: só aparece unidade que "foi gerada no Custos" => tem parcelas
  const unidadesComParcelasSet = useMemo(() => {
    const set = new Set<string>();
    const emp = pad4(empresaSel);
    const ob = pad4(obraSel);
    if (!emp || !ob) return set;
    for (const p of parcelas) {
      if (pad4(p.empresaId) === emp && pad4(p.obraId) === ob) {
        set.add(pad4(p.unidadeId));
      }
    }
    return set;
  }, [parcelas, empresaSel, obraSel]);

  const unidadeAtual = useMemo(() => {
    const emp = pad4(empresaSel);
    const ob = pad4(obraSel);
    const un = pad4(unidadeSel);
    return unidades.find((u) => u.empresaId === emp && u.obraId === ob && u.id === un) || null;
  }, [unidades, empresaSel, obraSel, unidadeSel]);

  const obrasDaEmpresa = useMemo(() => {
    const emp = pad4(empresaSel);
    return obras.filter((o) => o.empresaId === emp).sort((a, b) => a.id.localeCompare(b.id));
  }, [obras, empresaSel]);

  const unidadesDaObra = useMemo(() => {
    const emp = pad4(empresaSel);
    const ob = pad4(obraSel);

    const base = unidades
      .filter((u) => u.empresaId === emp && u.obraId === ob)
      .filter((u) => unidadesComParcelasSet.has(pad4(u.id))) // ✅ só unidades com parcelas
      .sort((a, b) => a.id.localeCompare(b.id));

    return base;
  }, [unidades, empresaSel, obraSel, unidadesComParcelasSet]);

  // ✅ se unidadeSel não existir na lista filtrada, limpa / ajusta
  useEffect(() => {
    if (!empresaSel || !obraSel) return;
    if (!unidadesDaObra.length) {
      if (unidadeSel) setUnidadeSel("");
      return;
    }
    const sel = pad4(unidadeSel);
    if (!sel) return;
    const exists = unidadesDaObra.some((u) => u.id === sel);
    if (!exists) {
      setUnidadeSel("");
      setPagasAgoraIds(new Set());
    }
  }, [empresaSel, obraSel, unidadesDaObra, unidadeSel]);

  const parcelasDaUnidade = useMemo(() => {
    if (!empresaSel || !obraSel || !unidadeSel) return [];
    const emp = pad4(empresaSel);
    const ob = pad4(obraSel);
    const un = pad4(unidadeSel);
    return parcelas
      .filter((p) => p.empresaId === emp && p.obraId === ob && p.unidadeId === un)
      .sort((a, b) => sortDateBR(a.vencimento, b.vencimento));
  }, [parcelas, empresaSel, obraSel, unidadeSel]);

  function pagamentosDaParcela(parcelaId: string) {
    return (pagamentos[parcelaId] ?? []).slice();
  }

  function somaRecebido(parcelaId: string) {
    return fmt2(
      pagamentosDaParcela(parcelaId)
        .filter((p) => (p.kind ?? "PAGAMENTO") === "PAGAMENTO")
        .reduce((s, p) => s + (p.valor || 0), 0)
    );
  }
  function somaDesconto(parcelaId: string) {
    return fmt2(
      pagamentosDaParcela(parcelaId)
        .filter((p) => (p.kind ?? "PAGAMENTO") === "DESCONTO")
        .reduce((s, p) => s + (p.valor || 0), 0)
    );
  }
  function somaQuitacao(parcelaId: string) {
    return fmt2(somaRecebido(parcelaId) + somaDesconto(parcelaId));
  }

  function ultimaDataPagamento(parcelaId: string) {
    const lista = pagamentosDaParcela(parcelaId)
      .slice()
      .sort((a, b) => (a.criadoEm || "").localeCompare(b.criadoEm || ""));
    if (!lista.length) return "";
    return lista[lista.length - 1].data || "";
  }

  function ultimoLoteId(parcelaId: string) {
    const lista = pagamentosDaParcela(parcelaId)
      .slice()
      .sort((a, b) => (a.criadoEm || "").localeCompare(b.criadoEm || ""));
    if (!lista.length) return "";
    const last = lista[lista.length - 1];
    return last?.loteId ?? "";
  }

  function statusParcela(p: ParcelaPrevista) {
    const quit = somaQuitacao(p.id);
    if (quit >= fmt2(p.valorPrevisto) && fmt2(p.valorPrevisto) > 0) return "QUITADA";
    if (quit > 0 && quit < fmt2(p.valorPrevisto)) return "PARCIAL";
    return "ABERTA";
  }

  function variacaoParcela(p: ParcelaPrevista) {
    const st = statusParcela(p);
    if (st !== "QUITADA") return 0;
    const rec = somaRecebido(p.id);
    return fmt2(rec - fmt2(p.valorPrevisto));
  }

  const parcelasPreferidas = useMemo(() => {
    if (!parcelasDaUnidade.length) return [];
    const abertasOuParcial = parcelasDaUnidade.filter((p) => {
      const st = statusParcela(p);
      return st === "ABERTA" || st === "PARCIAL";
    });
    const doMes = abertasOuParcial.filter((p) => ymOfDateBR(p.vencimento) === procYM);
    const atrasadas = abertasOuParcial.filter((p) => {
      const ym = ymOfDateBR(p.vencimento);
      const d = parseDateBR(`01/${ym}`);
      const dp = parseDateBR(`01/${procYM}`);
      if (!d || !dp) return false;
      return d.getTime() < dp.getTime();
    });
    const ids = new Set<string>();
    const out: ParcelaPrevista[] = [];
    for (const p of [...doMes, ...atrasadas]) {
      if (!ids.has(p.id)) {
        ids.add(p.id);
        out.push(p);
      }
    }
    return out;
  }, [parcelasDaUnidade, pagamentos, procYM]);

  const btn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #ddd",
    background: "white",
    cursor: "pointer",
  };
  const primaryBtn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 8,
    border: "none",
    background: "#0b4fd6",
    color: "white",
    cursor: "pointer",
    fontWeight: 900,
  };
  const dangerBtn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 8,
    border: "none",
    background: "#b00020",
    color: "white",
    cursor: "pointer",
    fontWeight: 900,
  };
  const card: React.CSSProperties = {
    background: "white",
    borderRadius: 12,
    padding: 12,
    boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
  };

  // =========================
  // ✅ ALTERAÇÃO PRINCIPAL:
  // Agora o modal de histórico tem 3 modos:
  // - PARCIAL: mostra só PAGAMENTOS (sem descontos) daquela parcela
  // - PARCELA: mostra tudo da parcela (pagamentos + descontos)
  // - LOTE: mostra todas as linhas do lote (de várias parcelas), inclusive descontos
  // =========================

  function openParcialModal(parcelaId: string, mode: "PARCIAL" | "PARCELA" | "LOTE" = "PARCIAL") {
    setHistoricoModo("PARCIAL");
    setParcialParcelaId(parcelaId);
    setHistoricoLoteId("");
    setParcialMode(mode);
    setShowParcial(true);
  }

  function openHistoricoParcelaModal(parcelaId: string) {
    setHistoricoModo("PARCELA");
    setParcialParcelaId(parcelaId);
    setHistoricoLoteId("");
    setShowParcial(true);
  }

  function openLoteModal(loteId: string, parcelaIdFallback?: string) {
    setHistoricoModo("LOTE");
    setHistoricoLoteId(loteId || "");
    setParcialParcelaId(parcelaIdFallback ?? "");
    setShowParcial(true);
  }

  // ✅ cor diferente para PARCIAL na visualização (pedido)
  function estiloLinhaFicha(p: ParcelaPrevista) {
    const st = statusParcela(p);
    const pagaAgora = pagasAgoraIds.has(p.id);

    const loteId = st === "QUITADA" ? ultimoLoteId(p.id) : "";
    const isLote = !!loteId;

    if (pagaAgora) return { background: "#eaf3ff" };

    // ✅ PARCIAL com cor destacada (amarelo + borda azul)
    if (st === "PARCIAL") return { background: "#fff3c4", borderLeft: "5px solid #0b4fd6" };

    if (st === "QUITADA") {
      if (isLote) {
        return { background: pastelFromId(loteId), borderLeft: `4px solid ${borderFromId(loteId)}` };
      }
      return { background: "#e9fff0" };
    }
    return { background: "white" };
  }

  function normalizeProcAnoOnBlur() {
    const d = onlyDigits(procAno).slice(0, 4);
    if (!d) return setProcAno(String(new Date().getFullYear()));
    if (d.length === 1) return setProcAno("200" + d);
    if (d.length === 2) return setProcAno("20" + d);
    if (d.length === 3) return setProcAno("2" + d);
    setProcAno(d);
  }

  function registrarLancamento(parcelaId: string, valor: number, data: string, kind: PagamentoKind, loteId?: string) {
    if (!(valor > 0)) return;
    const novo: PagamentoParcial = {
      id: uuid(),
      parcelaId,
      valor: fmt2(valor),
      data,
      criadoEm: new Date().toISOString(),
      loteId,
      kind,
    };

    const atual = loadJson<PagamentosPorParcela>(STORAGE_PAGAMENTOS, {});
    const atualFix: PagamentosPorParcela = {};
    for (const k of Object.keys(atual)) {
      atualFix[k] = (atual[k] ?? []).map((x) => ({ ...x, kind: (x.kind as any) ?? "PAGAMENTO" }));
    }

    const lista = (atualFix[parcelaId] ?? []).slice();
    lista.push(novo);
    atualFix[parcelaId] = lista;

    saveJson(STORAGE_PAGAMENTOS, atualFix);
    setPagamentos(atualFix);
  }

  function openPagarParcela(parcelaId: string) {
    if (!isMaster) return;
    const p = parcelasDaUnidade.find((x) => x.id === parcelaId);
    if (!p) return;

    if (statusParcela(p) === "QUITADA") {
      const ok = confirm("Parcela já quitada! Confirma que deseja alterar?");
      if (!ok) return;
    }

    setParcelaPagarId(parcelaId);
    setPagarValor(String(p.valorPrevisto).replace(".", ","));
    setPagarData(todayBR());
    setPagarDesconto(false);
    setShowPagar(true);
    setInfo(null);
    setTimeout(() => document.getElementById("pagar_valor")?.focus(), 80);
  }

  function openLoteFromParcela() {
    if (!isMaster) return;
    const p = parcelasDaUnidade.find((x) => x.id === parcelaPagarId);
    if (!p) return;

    setShowPagar(false);

    setLoteTipo(p.tipo);
    setLoteFixado(true);
    setLoteValor("");
    setLoteData(todayBR());
    setLoteDesconto(false);
    setLoteQtd("");
    setShowLote(true);
    setTimeout(() => document.getElementById("lote_valor")?.focus(), 80);
  }

  function salvarPagamentoIndividual() {
    if (!isMaster) return;
    const p = parcelasDaUnidade.find((x) => x.id === parcelaPagarId);
    if (!p) return;

    const v = parseMoneyInput(pagarValor);
    const data = dateNormalizeOnBlur(pagarData);

    if (!(v > 0)) return alert("Informe um valor válido.");
    if (!isValidDateBR(data)) return alert("Data inválida.");

    if (statusParcela(p) === "QUITADA") {
      const ok = confirm("Parcela já quitada. Confirma a alteração (novo lançamento)?");
      if (!ok) return;
    }

    registrarLancamento(p.id, v, data, "PAGAMENTO");

    if (pagarDesconto) {
      const recAntes = somaRecebido(p.id);
      const descAntes = somaDesconto(p.id);

      const recDepois = fmt2(recAntes + v);
      const quitDepois = fmt2(recDepois + descAntes);

      const falta = fmt2(fmt2(p.valorPrevisto) - quitDepois);
      if (falta > 0) registrarLancamento(p.id, falta, data, "DESCONTO");
    }

    if (ymOfDateBR(p.vencimento) === procYM) {
      setPagasAgoraIds((prev) => new Set(prev).add(p.id));
    }

    setShowPagar(false);
    setInfo(pagarDesconto ? "Pagamento com DESCONTO lançado (quitada com variação negativa)." : "Pagamento lançado.");

    const idx = parcelasDaUnidade.findIndex((x) => x.id === p.id);
    for (let i = idx + 1; i < parcelasDaUnidade.length; i++) {
      const next = parcelasDaUnidade[i];
      const st = statusParcela(next);
      if (st === "ABERTA" || st === "PARCIAL") {
        openPagarParcela(next.id);
        break;
      }
    }
  }

  const TIPOS: TipoPagamento[] = ["Entrada", "Mensal", "Semestral", "Anual", "Única", "Financiamento", "Outras"];

  function openLote() {
    if (!isMaster) return;
    if (!unidadeAtual) return alert("Selecione uma unidade.");

    setLoteFixado(false);
    setLoteTipo("Mensal");
    setLoteValor("");
    setLoteData(todayBR());
    setLoteDesconto(false);
    setLoteQtd("");
    setShowLote(true);
    setInfo(null);
    setTimeout(() => document.getElementById("lote_valor")?.focus(), 80);
  }
  const loteResumo = useMemo(() => {
    if (!unidadeAtual) return null;

    const totalPago = fmt2(parseMoneyInput(loteValor));
    const candidatasBase = parcelasDaUnidade
      .filter((p) => p.tipo === loteTipo)
      .filter((p) => {
        const st = statusParcela(p);
        return st === "ABERTA" || st === "PARCIAL";
      })
      .sort((a, b) => sortDateBR(a.vencimento, b.vencimento));

    if (!candidatasBase.length) {
      return { ok: false, msg: "Não há parcelas em aberto/parcial desse tipo para esta unidade." } as const;
    }

    if (loteDesconto) {
      const q = Number(onlyDigits(loteQtd));
      if (!Number.isFinite(q) || q <= 0) {
        return { ok: false, msg: "Informe a QUANTIDADE (obrigatório quando Desconto = SIM)." } as const;
      }
      if (candidatasBase.length < q) {
        return { ok: false, msg: `Não existem ${q} parcelas em aberto/parcial desse tipo.` } as const;
      }

      const candidatas = candidatasBase.slice(0, q);
      let previstoAQuit = 0;

      for (const p of candidatas) {
        const falta = fmt2(fmt2(p.valorPrevisto) - somaQuitacao(p.id));
        if (falta > 0) previstoAQuit = fmt2(previstoAQuit + falta);
      }

      const desconto = Math.max(0, fmt2(previstoAQuit - totalPago));
      const sobra = Math.max(0, fmt2(totalPago - previstoAQuit));

      return { ok: true, modo: "DESCONTO_QTD", qtd: q, previstoAQuit, recebido: totalPago, desconto, sobra } as const;
    }

    let restante = totalPago;
    let quitadas = 0;
    let previstoQuitado = 0;

    for (const p of candidatasBase) {
      const falta = fmt2(fmt2(p.valorPrevisto) - somaQuitacao(p.id));
      if (falta <= 0) continue;
      if (restante >= falta) {
        restante = fmt2(restante - falta);
        previstoQuitado = fmt2(previstoQuitado + falta);
        quitadas += 1;
      } else break;
    }

    if (quitadas === 0) {
      return { ok: false, msg: "No lote normal, o valor não quita nenhuma parcela inteira." } as const;
    }

    return {
      ok: true,
      modo: "NORMAL",
      qtd: quitadas,
      previstoAQuit: previstoQuitado,
      recebido: totalPago,
      desconto: 0,
      sobra: Math.max(0, restante),
    } as const;
  }, [unidadeAtual, loteValor, loteTipo, loteDesconto, loteQtd, parcelasDaUnidade, pagamentos]);

  function aplicarLote() {
    if (!isMaster) return;
    if (!unidadeAtual) return;

    const totalPago = parseMoneyInput(loteValor);
    const data = dateNormalizeOnBlur(loteData);

    if (!(totalPago > 0)) return alert("Informe o valor total do lote.");
    if (!isValidDateBR(data)) return alert("Data inválida.");

    const candidatasBase = parcelasDaUnidade
      .filter((p) => p.tipo === loteTipo)
      .filter((p) => {
        const st = statusParcela(p);
        return st === "ABERTA" || st === "PARCIAL";
      })
      .sort((a, b) => sortDateBR(a.vencimento, b.vencimento));

    if (!candidatasBase.length) return alert(`Não há parcelas em aberto/parcial do tipo "${loteTipo}" para esta unidade.`);

    const loteId = "LOTE-" + uuid();

    if (loteDesconto) {
      const q = Number(onlyDigits(loteQtd));
      if (!Number.isFinite(q) || q <= 0) return alert("No lote com DESCONTO, informe a QUANTIDADE de parcelas.");
      const candidatas = candidatasBase.slice(0, q);
      if (candidatas.length !== q) return alert(`Não existem ${q} parcelas em aberto/parcial desse tipo para esta unidade.`);

      let restante = fmt2(totalPago);
      const quitadasNoLote: ParcelaPrevista[] = [];

      for (const p of candidatas) {
        const falta = fmt2(fmt2(p.valorPrevisto) - somaQuitacao(p.id));
        if (falta <= 0) {
          quitadasNoLote.push(p);
          continue;
        }

        const pago = Math.min(restante, falta);
        if (pago > 0) {
          registrarLancamento(p.id, pago, data, "PAGAMENTO", loteId);
          restante = fmt2(restante - pago);
        }

        const descNecessario = fmt2(falta - pago);
        if (descNecessario > 0) registrarLancamento(p.id, descNecessario, data, "DESCONTO", loteId);

        quitadasNoLote.push(p);
      }

      // sobra vira variação + na última quitada
      if (restante > 0 && quitadasNoLote.length) {
        const ultima = quitadasNoLote[quitadasNoLote.length - 1];
        registrarLancamento(ultima.id, restante, data, "PAGAMENTO", loteId);
      }

      setPagasAgoraIds((prev) => {
        const next = new Set(prev);
        for (const p of quitadasNoLote) {
          if (ymOfDateBR(p.vencimento) === procYM) next.add(p.id);
        }
        return next;
      });

      setShowLote(false);
      setInfo("Lote com DESCONTO aplicado: quitou exatamente a quantidade informada (inclusive podendo ter parcela 100% desconto).");
      return;
    }

    // lote normal: quita parcelas inteiras até acabar o valor
    let restante = fmt2(totalPago);
    const quitadasNoLote: ParcelaPrevista[] = [];

    for (const p of candidatasBase) {
      if (restante <= 0) break;

      const falta = fmt2(fmt2(p.valorPrevisto) - somaQuitacao(p.id));
      if (falta <= 0) {
        quitadasNoLote.push(p);
        continue;
      }

      if (restante >= falta) {
        registrarLancamento(p.id, falta, data, "PAGAMENTO", loteId);
        restante = fmt2(restante - falta);
        quitadasNoLote.push(p);
      } else {
        break;
      }
    }

    if (!quitadasNoLote.length) return alert("O valor não foi suficiente para quitar nenhuma parcela inteira (lote normal).");

    if (restante > 0) {
      const ultima = quitadasNoLote[quitadasNoLote.length - 1];
      registrarLancamento(ultima.id, restante, data, "PAGAMENTO", loteId);
    }

    setPagasAgoraIds((prev) => {
      const next = new Set(prev);
      for (const p of quitadasNoLote) {
        if (ymOfDateBR(p.vencimento) === procYM) next.add(p.id);
      }
      return next;
    });

    setShowLote(false);
    setInfo("Lote aplicado. (Sobra foi para variação da última parcela quitada.)");
  }

  // =========================
  // ✅ QUITAR UNIDADE (aproximação visual do botão você ajusta no layout depois)
  // =========================
  function openQuitarUnidade() {
    if (!isMaster) return;
    if (!unidadeAtual) return alert("Selecione uma unidade.");
    setQuitarValor("");
    setQuitarData(todayBR());
    setShowSimDetalhe(false);
    setShowQuitar(true);
    setTimeout(() => document.getElementById("quitar_valor")?.focus(), 80);
  }

  const quitarResumo = useMemo(() => {
    if (!unidadeAtual) return null;

    const totalPago = fmt2(parseMoneyInput(quitarValor));
    const candidatas = parcelasDaUnidade
      .filter((p) => {
        const st = statusParcela(p);
        return st === "ABERTA" || st === "PARCIAL";
      })
      .sort((a, b) => sortDateBR(a.vencimento, b.vencimento));

    if (!candidatas.length) return { ok: false, msg: "Não há parcelas em aberto/parcial nesta unidade." } as const;
    if (!(totalPago > 0)) return { ok: false, msg: "Informe o valor recebido para quitar." } as const;

    let previstoAQuit = 0;
    for (const p of candidatas) {
      const falta = fmt2(fmt2(p.valorPrevisto) - somaQuitacao(p.id));
      if (falta > 0) previstoAQuit = fmt2(previstoAQuit + falta);
    }

    const desconto = Math.max(0, fmt2(previstoAQuit - totalPago));
    const sobra = Math.max(0, fmt2(totalPago - previstoAQuit));

    return { ok: true, qtd: candidatas.length, previstoAQuit, recebido: totalPago, desconto, sobra } as const;
  }, [unidadeAtual, quitarValor, parcelasDaUnidade, pagamentos]);

  const quitarSimulacao = useMemo(() => {
    if (!unidadeAtual) return null;

    const totalPago = fmt2(parseMoneyInput(quitarValor));
    if (!(totalPago > 0)) return null;

    const candidatas = parcelasDaUnidade
      .filter((p) => {
        const st = statusParcela(p);
        return st === "ABERTA" || st === "PARCIAL";
      })
      .sort((a, b) => sortDateBR(a.vencimento, b.vencimento));

    if (!candidatas.length) return null;

    let restante = fmt2(totalPago);
    const itens: Array<{
      parcelaId: string;
      vencimento: string;
      tipo: TipoPagamento;
      previsto: number;
      faltaAntes: number;
      pagar: number;
      desconto: number;
    }> = [];

    let ultimaParcelaId: string | null = null;

    for (const p of candidatas) {
      const falta = fmt2(fmt2(p.valorPrevisto) - somaQuitacao(p.id));
      if (falta <= 0) continue;

      const pago = Math.min(restante, falta);
      restante = fmt2(restante - pago);

      const desc = fmt2(falta - pago);

      itens.push({
        parcelaId: p.id,
        vencimento: p.vencimento,
        tipo: p.tipo,
        previsto: fmt2(p.valorPrevisto),
        faltaAntes: falta,
        pagar: fmt2(pago),
        desconto: fmt2(desc),
      });

      ultimaParcelaId = p.id;
    }

    let sobra = 0;
    if (restante > 0) {
      sobra = restante;
      if (ultimaParcelaId && itens.length) {
        itens[itens.length - 1] = {
          ...itens[itens.length - 1],
          pagar: fmt2(itens[itens.length - 1].pagar + restante),
        };
      }
      restante = 0;
    }

    const totalDesconto = fmt2(itens.reduce((s, x) => s + x.desconto, 0));
    const totalPagoAplicado = fmt2(itens.reduce((s, x) => s + x.pagar, 0));

    return { itens, totalDesconto, totalPagoAplicado, sobra } as const;
  }, [unidadeAtual, parcelasDaUnidade, pagamentos, quitarValor]);

  function aplicarQuitarUnidade() {
    if (!isMaster) return;
    if (!unidadeAtual) return;

    const totalPago = fmt2(parseMoneyInput(quitarValor));
    const data = dateNormalizeOnBlur(quitarData);

    if (!(totalPago > 0)) return alert("Informe o valor recebido para quitar a unidade.");
    if (!isValidDateBR(data)) return alert("Data inválida.");

    const candidatas = parcelasDaUnidade
      .filter((p) => {
        const st = statusParcela(p);
        return st === "ABERTA" || st === "PARCIAL";
      })
      .sort((a, b) => sortDateBR(a.vencimento, b.vencimento));

    if (!candidatas.length) return alert("Não há parcelas em aberto/parcial nesta unidade.");

    const loteId = "QUITAR-" + uuid();
    let restante = fmt2(totalPago);
    let ultimaUsada: ParcelaPrevista | null = null;

    for (const p of candidatas) {
      const falta = fmt2(fmt2(p.valorPrevisto) - somaQuitacao(p.id));
      if (falta <= 0) continue;

      const pago = Math.min(restante, falta);
      if (pago > 0) {
        registrarLancamento(p.id, pago, data, "PAGAMENTO", loteId);
        restante = fmt2(restante - pago);
      }

      const descNec = fmt2(falta - pago);
      if (descNec > 0) {
        registrarLancamento(p.id, descNec, data, "DESCONTO", loteId);
      }

      ultimaUsada = p;
    }

    if (restante > 0) {
      const alvo = ultimaUsada ?? candidatas[candidatas.length - 1];
      registrarLancamento(alvo.id, restante, data, "PAGAMENTO", loteId);
    }

    setPagasAgoraIds((prev) => {
      const next = new Set(prev);
      for (const p of candidatas) {
        if (ymOfDateBR(p.vencimento) === procYM) next.add(p.id);
      }
      return next;
    });

    setShowQuitar(false);
    setInfo("Unidade quitada: todas as parcelas foram quitadas usando descontos quando necessário (valor recebido total preservado).");
  }

  function aplicarQuitarUnidadeComConfirmacao() {
    if (!isMaster) return;

    const ok1 = confirm(
      "ATENÇÃO: Você está prestes a QUITAR A UNIDADE inteira.\n\n" +
        "Isso pode lançar DESCONTOS (variação negativa) para completar o previsto.\n\n" +
        "Confirma que deseja continuar?"
    );
    if (!ok1) return;

    const ok2 = confirm("CONFIRMA novamente? Esta ação vai registrar lançamentos e quitar parcelas.");
    if (!ok2) return;

    aplicarQuitarUnidade();
  }

  function requireMasterOrWarn(): boolean {
    if (isMaster) return true;
    alert("Usuário não Master: apenas consulta.");
    return false;
  }

  // ✅ mapa de unidade quitada (para ficar verde na lista)
  const unidadeQuitadaMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    if (!empresaSel || !obraSel) return map;

    const emp = pad4(empresaSel);
    const ob = pad4(obraSel);

    const parcelasDaObra = parcelas.filter((p) => p.empresaId === emp && p.obraId === ob);
    const porUnidade: Record<string, ParcelaPrevista[]> = {};
    for (const p of parcelasDaObra) {
      (porUnidade[p.unidadeId] ??= []).push(p);
    }

    for (const unId of Object.keys(porUnidade)) {
      const list = porUnidade[unId] ?? [];
      if (!list.length) {
        map[unId] = false;
        continue;
      }
      map[unId] = list.every((pp) => statusParcela(pp) === "QUITADA");
    }
    return map;
  }, [parcelas, pagamentos, empresaSel, obraSel]);

  // navegação por setas (↑ ↓)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (!empresaSel || !obraSel) return;
      if (!unidadesDaObra.length) return;

      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      e.preventDefault();

      const ids = unidadesDaObra.map((u) => u.id);
      const idx = Math.max(0, ids.indexOf(pad4(unidadeSel)));
      const nextIdx = e.key === "ArrowUp" ? Math.max(0, idx - 1) : Math.min(ids.length - 1, idx + 1);
      const nextId = ids[nextIdx];

      if (nextId && nextId !== unidadeSel) {
        setUnidadeSel(nextId);
        setPagasAgoraIds(new Set());
        setTimeout(() => {
          document.getElementById(`unit_${nextId}`)?.scrollIntoView({ block: "nearest" });
        }, 0);
      }
    }

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown as any);
  }, [empresaSel, obraSel, unidadeSel, unidadesDaObra]);

  /* ===========================
     ✅ Relatório PIS/COFINS V2
     (igual ao seu, sem mudar regra)
     =========================== */

  useEffect(() => {
    if (!empresaSel) return;
    const k = extrasKey(empresaSel, procYM);
    const saved = loadJson<ExtraRow[] | null>(k, null);
    if (saved && Array.isArray(saved) && saved.length === 10) {
      setRelExtras(
        saved.map((x) => ({
          ...x,
          previsto: fmt2(Number(x.previsto || 0)),
          variacao: fmt2(Number(x.variacao || 0)),
          desconto: fmt2(Number(x.desconto || 0)),
          recebido: fmt2(Number(x.recebido || 0)),
        }))
      );
    } else {
      setRelExtras(defaultExtras());
    }
  }, [empresaSel, procYM]);

  function salvarExtras(next: ExtraRow[]) {
    setRelExtras(next);
    if (!empresaSel) return;
    saveJson(extrasKey(empresaSel, procYM), next);
  }

  function processarPisCofinsV2Empresa() {
    if (!isMaster) return alert("Somente Master pode processar.");
    if (!empresaSel) return alert("Selecione a empresa.");

    const empId = pad4(empresaSel);

    const emp = empresas.find((e) => pad4(e.id) === empId);
    const empNome = emp?.razaoSocial ?? "";

    const inicioMes = new Date(Number(procAno), Number(procMes) - 1, 1);

    const parcelaById = new Map<string, ParcelaPrevista>();
    for (const p of parcelas) parcelaById.set(p.id, p);

    const obraById = new Map<string, Obra>();
    for (const o of obras) {
      if (pad4(o.empresaId) === empId) obraById.set(pad4(o.id), o);
    }

    const unidadeByKey = new Map<string, Unidade>();
    for (const u of unidades) {
      if (pad4(u.empresaId) !== empId) continue;
      unidadeByKey.set(`${pad4(u.obraId)}|${pad4(u.id)}`, u);
    }

    const parcelaSums = new Map<string, { pagoMes: number; descMes: number; quitAntes: number }>();

    for (const parcelaId of Object.keys(pagamentos)) {
      const par = parcelaById.get(parcelaId);
      if (!par) continue;
      if (pad4(par.empresaId) !== empId) continue;

      const list = pagamentos[parcelaId] ?? [];

      let pagoMes = 0;
      let descMes = 0;
      let quitAntes = 0;

      for (const lanc of list) {
        const d = parseDateBR(lanc.data);
        if (!d) continue;

        const kind = (lanc.kind ?? "PAGAMENTO") as PagamentoKind;
        const v = fmt2(lanc.valor || 0);

        if (d.getTime() < inicioMes.getTime()) {
          quitAntes = fmt2(quitAntes + v);
          continue;
        }

        const ym = ymOfDateBR(lanc.data);
        if (ym !== procYM) continue;

        if (kind === "PAGAMENTO") pagoMes = fmt2(pagoMes + v);
        else if (kind === "DESCONTO") descMes = fmt2(descMes + v);
      }

      if (pagoMes !== 0 || descMes !== 0) {
        parcelaSums.set(parcelaId, { pagoMes, descMes, quitAntes });
      }
    }

    const aggByUnit = new Map<
      string,
      {
        obraId: string;
        unidadeId: string;
        previsto: number;
        variacao: number;
        desconto: number;
        recebido: number;
      }
    >();

    for (const [parcelaId, sums] of parcelaSums.entries()) {
      const par = parcelaById.get(parcelaId);
      if (!par) continue;

      const obraId = pad4(par.obraId);
      const unidadeId = pad4(par.unidadeId);
      const key = `${obraId}|${unidadeId}`;

      const valorPrevistoParcela = fmt2(par.valorPrevisto || 0);
      const faltaAntes = Math.max(0, fmt2(valorPrevistoParcela - fmt2(sums.quitAntes)));
      const quitMes = fmt2(fmt2(sums.pagoMes) + fmt2(sums.descMes));
      const previstoMes = fmt2(Math.min(faltaAntes, quitMes));

      const descontoCol = fmt2(-Math.abs(sums.descMes || 0));
      const recebidoMes = fmt2(sums.pagoMes || 0);
      const variacaoMes = fmt2(recebidoMes - previstoMes - descontoCol);

      const cur =
        aggByUnit.get(key) ?? {
          obraId,
          unidadeId,
          previsto: 0,
          variacao: 0,
          desconto: 0,
          recebido: 0,
        };

      cur.previsto = fmt2(cur.previsto + previstoMes);
      cur.desconto = fmt2(cur.desconto + descontoCol);
      cur.variacao = fmt2(cur.variacao + variacaoMes);
      cur.recebido = fmt2(cur.recebido + recebidoMes);

      aggByUnit.set(key, cur);
    }

    const obraIds = Array.from(new Set(Array.from(aggByUnit.values()).map((x) => x.obraId))).sort((a, b) => a.localeCompare(b));

    const out: RelRow[] = [];

    for (const obId of obraIds) {
      const ob = obraById.get(obId);
      const obraNome = ob?.nome ?? "";

      const units = Array.from(aggByUnit.values())
        .filter((x) => x.obraId === obId)
        .sort((a, b) => a.unidadeId.localeCompare(b.unidadeId));

      let subPrev = 0;
      let subVar = 0;
      let subDesc = 0;
      let subRec = 0;

      for (const u of units) {
        const unit = unidadeByKey.get(`${obId}|${u.unidadeId}`);
        const nome = unit?.compradorNome ?? "";

        out.push({
          kind: "UNIT",
          obraId: obId,
          obraNome,
          unidadeId: u.unidadeId,
          unidadeNome: nome,
          previsto: fmt2(u.previsto),
          variacao: fmt2(u.variacao),
          desconto: fmt2(u.desconto),
          recebido: fmt2(u.recebido),
        });

        subPrev = fmt2(subPrev + u.previsto);
        subVar = fmt2(subVar + u.variacao);
        subDesc = fmt2(subDesc + u.desconto);
        subRec = fmt2(subRec + u.recebido);
      }

      out.push({
        kind: "SUBTOTAL",
        obraId: obId,
        obraNome,
        previsto: fmt2(subPrev),
        variacao: fmt2(subVar),
        desconto: fmt2(subDesc),
        recebido: fmt2(subRec),
      });
    }

    const totPrev = fmt2(out.filter((r) => r.kind === "UNIT").reduce((s, r) => s + (r as RelUnitRow).previsto, 0));
    const totVar = fmt2(out.filter((r) => r.kind === "UNIT").reduce((s, r) => s + (r as RelUnitRow).variacao, 0));
    const totDesc = fmt2(out.filter((r) => r.kind === "UNIT").reduce((s, r) => s + (r as RelUnitRow).desconto, 0));
    const totRec = fmt2(out.filter((r) => r.kind === "UNIT").reduce((s, r) => s + (r as RelUnitRow).recebido, 0));

    out.push({ kind: "TOTAL", previsto: totPrev, variacao: totVar, desconto: totDesc, recebido: totRec });

    setRelRows(out);
    saveJson(STORAGE_PISCOFINS_V2, { mesAno: procYM, empresaId: empId, empresaNome: empNome, rows: out });
    setInfo(`Relatório PIS/COFINS processado para a empresa ${empId} na competência ${procYM}.`);
  }

  function limparPisCofinsV2() {
    if (!isMaster) return alert("Somente Master pode limpar.");
    setRelRows([]);
    saveJson(STORAGE_PISCOFINS_V2, { mesAno: "", empresaId: "", rows: [] });
    if (empresaSel) {
      saveJson(extrasKey(empresaSel, procYM), defaultExtras());
      setRelExtras(defaultExtras());
    }
    setInfo("Relatório PIS/COFINS limpo (e extras zerados nesta competência).");
  }

  const extrasComputed = useMemo(() => {
    const fixed = relExtras.filter((x) => x.fixed);
    const free = relExtras.filter((x) => !x.fixed);

    const fixedNorm = fixed.map((x) => ({
      ...x,
      previsto: 0,
      variacao: 0,
      desconto: 0,
      recebido: fmt2(x.recebido || 0),
    }));

    const freeNorm = free.map((x) => {
      const previsto = fmt2(x.previsto || 0);
      const variacao = fmt2(x.variacao || 0);
      const desconto = fmt2(x.desconto || 0);
      const recebido = fmt2(previsto + variacao + desconto);
      return { ...x, previsto, variacao, desconto, recebido };
    });

    const all = [...fixedNorm, ...freeNorm];

    const tot = {
      previsto: fmt2(all.reduce((s, x) => s + (x.previsto || 0), 0)),
      variacao: fmt2(all.reduce((s, x) => s + (x.variacao || 0), 0)),
      desconto: fmt2(all.reduce((s, x) => s + (x.desconto || 0), 0)),
      recebido: fmt2(all.reduce((s, x) => s + (x.recebido || 0), 0)),
    };

    return { rows: all, totals: tot };
  }, [relExtras]);

  const totalsMain = useMemo(() => {
    const unitRows = relRows.filter((r) => r.kind === "UNIT") as RelUnitRow[];
    return {
      previsto: fmt2(unitRows.reduce((s, r) => s + r.previsto, 0)),
      variacao: fmt2(unitRows.reduce((s, r) => s + r.variacao, 0)),
      desconto: fmt2(unitRows.reduce((s, r) => s + r.desconto, 0)),
      recebido: fmt2(unitRows.reduce((s, r) => s + r.recebido, 0)),
    };
  }, [relRows]);

  const totalsGeralComExtras = useMemo(() => {
    return {
      previsto: fmt2(totalsMain.previsto + extrasComputed.totals.previsto),
      variacao: fmt2(totalsMain.variacao + extrasComputed.totals.variacao),
      desconto: fmt2(totalsMain.desconto + extrasComputed.totals.desconto),
      recebido: fmt2(totalsMain.recebido + extrasComputed.totals.recebido),
    };
  }, [totalsMain, extrasComputed]);
  if (!session) return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>Carregando...</main>;

  return (
    <main style={{ minHeight: "100vh", background: "#f2f2f2", padding: 16 }}>
      <style>{`
        .mini { font-size: 13px; color: #666; }
        .gridTop { display:grid; grid-template-columns: 1.1fr 1.1fr 2.2fr; gap: 12px; }
        @media (max-width: 1100px) { .gridTop { grid-template-columns: 1fr; } }
        .table { width: 100%; border-collapse: collapse; }
        .th { background: #f7f7f7; text-align: left; padding: 10px; font-weight: 900; border-bottom: 1px solid #eee; }
        .td { padding: 10px; border-bottom: 1px solid #eee; }
        .nowrap { white-space: nowrap; }
        .badge { font-size: 12px; font-weight: 900; padding: 4px 8px; border-radius: 999px; }
        .modalOverlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: grid; place-items: center; padding: 18px; z-index: 50; }
        .modal { width: min(1100px, 98vw); max-height: 92vh; overflow: auto; background: white; border-radius: 14px; padding: 14px; box-shadow: 0 20px 60px rgba(0,0,0,0.35); }
        .grid2 { display:grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        @media (max-width: 900px) { .grid2 { grid-template-columns: 1fr; } }
        .clickRow:hover { filter: brightness(0.985); }
        .unitItem { border: 1px solid #eee; border-radius: 10px; padding: 8px 10px; background: white; cursor: pointer; }
        .unitItemAlt { background: #fbfbfb; }
        .unitItemSel { border-color: #0b4fd6; background: #eef4ff; }
        .unitQuitada { background: #e9fff0 !important; border-color: #3aa357 !important; }

        /* ✅ cores para PARCIAL (mais evidente) */
        .rowParcial { background: #fff1c7 !important; border-left: 4px solid #f0a500; }
        .rowQuitada { background: #e9fff0 !important; }
        .rowPagaAgora { background: #eaf3ff !important; }

        .linkBtn { border: 1px solid #ddd; background: white; padding: 6px 10px; border-radius: 10px; cursor: pointer; font-weight: 900; }
        .input { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #ccc; }

        .pill { font-size: 12px; font-weight: 900; padding: 4px 10px; border-radius: 999px; border: 1px solid #ddd; background: #fff; }
      `}</style>

      <div style={{ maxWidth: 1500, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, color: "#333" }}>Controle de Imóveis — Processamento</h1>
            <div className="mini" style={{ marginTop: 6 }}>
              Usuário: <b>{session.username}</b> ({session.role})
            </div>
            <div style={{ color: "#444", marginTop: 6 }}>
              Empresa: <b>{empresaAtual ? `${empresaAtual.id} — ${empresaAtual.razaoSocial}` : "(selecione)"}</b>{" "}
              | Obra: <b>{obraAtual ? `${obraAtual.id} — ${obraAtual.nome}` : "(selecione)"}</b>{" "}
              | Unidade: <b>{unidadeAtual ? `${unidadeAtual.id} — ${unidadeAtual.compradorNome}` : "(selecione)"}</b>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button style={btn} onClick={() => router.push("/dashboard")}>Voltar</button>
            <button style={btn} onClick={() => router.push("/gestao")}>Gestão</button>
            <button style={btn} onClick={() => router.push("/obras")}>Cadastro de Obras</button>
          </div>
        </div>

        {info && (
          <div
            style={{
              marginTop: 12,
              background: "#e9f2ff",
              border: "1px solid #b7d2ff",
              color: "#0b2a66",
              padding: 10,
              borderRadius: 8,
            }}
          >
            {info}
          </div>
        )}

        {/* ✅ topo de processamento + botão quitar mais perto */}
        <div style={{ ...card, marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 900, color: "#333" }}>Mês/Ano do processamento:</div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div className="mini">Mês</div>
              <input
                style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc", width: 90 }}
                value={procMes}
                onChange={(e) => setProcMes(onlyDigits(e.target.value).slice(0, 2).padStart(2, "0"))}
                placeholder="MM"
              />
            </div>
            <div>
              <div className="mini">Ano</div>
              <input
                style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc", width: 120 }}
                value={procAno}
                onChange={(e) => setProcAno(onlyDigits(e.target.value).slice(0, 4))}
                onBlur={normalizeProcAnoOnBlur}
                placeholder="AAAA"
              />
            </div>

            <div style={{ padding: "10px 12px", borderRadius: 10, background: "#f7f7f7", border: "1px solid #e6e6e6", fontWeight: 900, color: "#333" }}>
              Processando: {procMes}/{procAno}
            </div>

            <button
              style={primaryBtn}
              onClick={() => {
                setPagasAgoraIds(new Set());
                setInfo("Ok! Destaques 'pagas agora' foram zerados para nova conferência.");
              }}
            >
              Zerar destaque “pagas agora”
            </button>

            <button
              style={isMaster && unidadeAtual ? dangerBtn : { ...dangerBtn, opacity: 0.55, cursor: "not-allowed" }}
              disabled={!isMaster || !unidadeAtual}
              onClick={() => (requireMasterOrWarn() ? openQuitarUnidade() : null)}
              title="Quita TODAS as parcelas da unidade com um valor recebido (aplica descontos se faltar)"
            >
              Quitar Unidade
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12 }} className="gridTop">
          <section style={card}>
            <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>Empresa</h2>
            <div style={{ marginTop: 10 }}>
              <select
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
                value={empresaSel}
                onChange={(e) => {
                  setEmpresaSel(pad4(e.target.value));
                  setObraSel("");
                  setUnidadeSel("");
                  setPagasAgoraIds(new Set());
                }}
              >
                <option value="">Selecione...</option>
                {empresas
                  .slice()
                  .sort((a, b) => a.id.localeCompare(b.id))
                  .map((e) => (
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
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
                value={obraSel}
                onChange={(e) => {
                  setObraSel(pad4(e.target.value));
                  setUnidadeSel("");
                  setPagasAgoraIds(new Set());
                }}
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>Unidades (visíveis) — ↑ ↓</h2>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  style={isMaster && unidadeAtual ? primaryBtn : { ...primaryBtn, opacity: 0.55, cursor: "not-allowed" }}
                  onClick={() => (requireMasterOrWarn() ? openLote() : null)}
                  disabled={!isMaster || !unidadeAtual}
                >
                  Pagamento em Lote
                </button>
              </div>
            </div>

            <div className="mini" style={{ marginTop: 8 }}>
              Critério: aparecem somente unidades do Gestão que já foram geradas no Custos (têm parcelas).
            </div>

            <div style={{ marginTop: 10 }}>
              <select
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
                value={unidadeSel}
                onChange={(e) => {
                  const id = pad4(e.target.value);
                  setUnidadeSel(id);
                  setPagasAgoraIds(new Set());
                  setTimeout(() => {
                    document.getElementById(`unit_${id}`)?.scrollIntoView({ block: "nearest" });
                  }, 0);
                }}
                disabled={!empresaSel || !obraSel}
              >
                <option value="">{obraSel ? "Selecione..." : "Selecione empresa e obra"}</option>
                {unidadesDaObra.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.id} — {u.compradorNome}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginTop: 10, border: "1px solid #eee", borderRadius: 12, maxHeight: 260, overflow: "auto", padding: 8, background: "#fff" }}>
              {unidadesDaObra.length === 0 ? (
                <div className="mini">Nenhuma unidade nesta obra (com parcelas).</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {unidadesDaObra.map((u, idx) => {
                    const selected = unidadeSel === u.id;

                    const quitada = !!unidadeQuitadaMap[u.id];
                    const clsBase = selected ? "unitItem unitItemSel" : idx % 2 === 0 ? "unitItem" : "unitItem unitItemAlt";
                    const cls = quitada && !selected ? `${clsBase} unitQuitada` : clsBase;

                    return (
                      <div
                        id={`unit_${u.id}`}
                        key={u.id}
                        className={cls}
                        onClick={() => {
                          setUnidadeSel(u.id);
                          setPagasAgoraIds(new Set());
                        }}
                        title={quitada ? "Unidade quitada" : ""}
                      >
                        <div style={{ fontWeight: 900, color: "#333", fontSize: 14 }}>
                          {u.id} — {u.compradorNome}
                          {quitada ? <span style={{ marginLeft: 8, color: "#2b7a3d" }}>✓ QUITADA</span> : null}
                        </div>
                        <div className="mini" style={{ marginTop: 4 }}>
                          Venda: <b>{moneyBR(u.valorVenda)}</b>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* ✅ RELATÓRIO PIS/COFINS V2 */}
        <section style={{ ...card, marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>Relatório PIS/COFINS — {procYM}</h2>
            <div className="mini">
              Base: parcelas com movimento no mês (PAGAMENTO e/ou DESCONTO) pela <b>data do recebimento</b>. Mostra por <b>unidade</b>, subtotal por <b>obra</b> e total geral.
            </div>
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
            <button
              style={isMaster && empresaSel ? primaryBtn : { ...primaryBtn, opacity: 0.55, cursor: "not-allowed" }}
              disabled={!isMaster || !empresaSel}
              onClick={processarPisCofinsV2Empresa}
              title="Gera o relatório por unidade (todas as obras da empresa), na competência selecionada"
            >
              Processar Relatório (Empresa)
            </button>

            <button
              style={isMaster ? btn : { ...btn, opacity: 0.55, cursor: "not-allowed" }}
              disabled={!isMaster}
              onClick={limparPisCofinsV2}
              title="Limpa o relatório e zera extras da competência"
            >
              Limpar relatório
            </button>

            <div style={{ padding: "10px 12px", borderRadius: 10, background: "#f7f7f7", border: "1px solid #e6e6e6", fontWeight: 900, color: "#333" }}>
              Competência: {procYM}
            </div>
          </div>

          {relRows.length === 0 ? (
            <div className="mini" style={{ marginTop: 10 }}>
              Nenhuma linha gerada ainda. Selecione a empresa e clique em <b>Processar Relatório (Empresa)</b>.
            </div>
          ) : (
            <>
              <div style={{ marginTop: 12, overflow: "auto", border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th className="th nowrap">Obra</th>
                      <th className="th nowrap">Unidade</th>
                      <th className="th nowrap" style={{ textAlign: "right" }}>Valor Previsto</th>
                      <th className="th nowrap" style={{ textAlign: "right" }}>Variação Monetária</th>
                      <th className="th nowrap" style={{ textAlign: "right" }}>Descontos</th>
                      <th className="th nowrap" style={{ textAlign: "right" }}>Valor Recebido</th>
                    </tr>
                  </thead>

                  <tbody>
                    {relRows
                      .filter((r) => r.kind !== "TOTAL")
                      .map((r, idx) => {
                        if (r.kind === "UNIT") {
                          return (
                            <tr key={`u-${r.obraId}-${r.unidadeId}-${idx}`}>
                              <td className="td nowrap">
                                <b>{r.obraId}</b> — {r.obraNome}
                              </td>
                              <td className="td nowrap">
                                <b>{r.unidadeId}</b> — {r.unidadeNome || "—"}
                              </td>
                              <td className="td nowrap" style={{ textAlign: "right", fontWeight: 900 }}>{moneyBR(r.previsto)}</td>
                              <td className="td nowrap" style={{ textAlign: "right" }}>{moneyBR(r.variacao)}</td>
                              <td className="td nowrap" style={{ textAlign: "right", color: r.desconto < 0 ? "#b00020" : "#333" }}>
                                {r.desconto < 0 ? `- ${moneyBR(Math.abs(r.desconto))}` : moneyBR(r.desconto)}
                              </td>
                              <td className="td nowrap" style={{ textAlign: "right", fontWeight: 900 }}>{moneyBR(r.recebido)}</td>
                            </tr>
                          );
                        }

                        return (
                          <tr key={`s-${r.obraId}-${idx}`} style={{ background: "#fafafa", fontWeight: 900 }}>
                            <td className="td nowrap" colSpan={2}>
                              Subtotal Obra <b>{r.obraId}</b> — {r.obraNome}
                            </td>
                            <td className="td nowrap" style={{ textAlign: "right" }}>{moneyBR(r.previsto)}</td>
                            <td className="td nowrap" style={{ textAlign: "right" }}>{moneyBR(r.variacao)}</td>
                            <td className="td nowrap" style={{ textAlign: "right", color: r.desconto < 0 ? "#b00020" : "#333" }}>
                              {r.desconto < 0 ? `- ${moneyBR(Math.abs(r.desconto))}` : moneyBR(r.desconto)}
                            </td>
                            <td className="td nowrap" style={{ textAlign: "right" }}>{moneyBR(r.recebido)}</td>
                          </tr>
                        );
                      })}

                    <tr>
                      <td className="td" colSpan={6} style={{ background: "#fff", paddingTop: 18, paddingBottom: 10 }}>
                        <div style={{ fontWeight: 900, color: "#333" }}>Lançamentos extras (10 linhas)</div>
                        <div className="mini" style={{ marginTop: 4 }}>
                          5 linhas fixas: editável somente <b>Valor Recebido</b>. <br />
                          5 linhas livres: nome + Previsto/Variação/Desconto editáveis; <b>Valor Recebido</b> é automático (soma das 3 colunas).
                        </div>
                      </td>
                    </tr>

                    {extrasComputed.rows.map((x) => (
                      <tr key={x.id}>
                        <td className="td nowrap" colSpan={2}>
                          {x.fixed ? (
                            <b>{x.nome}</b>
                          ) : (
                            <input
                              className="input"
                              value={x.nome}
                              placeholder="(nome livre)"
                              onChange={(e) => {
                                const next = relExtras.slice();
                                const ix = next.findIndex((z) => z.id === x.id);
                                if (ix >= 0) {
                                  next[ix] = { ...next[ix], nome: e.target.value };
                                  salvarExtras(next);
                                }
                              }}
                            />
                          )}
                        </td>

                        <td className="td nowrap" style={{ textAlign: "right" }}>
                          {x.fixed ? (
                            moneyBR(0)
                          ) : (
                            <input
                              className="input"
                              style={{ textAlign: "right" }}
                              value={String(relExtras.find((z) => z.id === x.id)?.previsto ?? 0).replace(".", ",")}
                              onChange={(e) => {
                                const v = parseMoneyInput(e.target.value);
                                const next = relExtras.slice();
                                const ix = next.findIndex((z) => z.id === x.id);
                                if (ix >= 0) {
                                  next[ix] = { ...next[ix], previsto: fmt2(v) };
                                  salvarExtras(next);
                                }
                              }}
                            />
                          )}
                        </td>

                        <td className="td nowrap" style={{ textAlign: "right" }}>
                          {x.fixed ? (
                            moneyBR(0)
                          ) : (
                            <input
                              className="input"
                              style={{ textAlign: "right" }}
                              value={String(relExtras.find((z) => z.id === x.id)?.variacao ?? 0).replace(".", ",")}
                              onChange={(e) => {
                                const v = parseMoneyInput(e.target.value);
                                const next = relExtras.slice();
                                const ix = next.findIndex((z) => z.id === x.id);
                                if (ix >= 0) {
                                  next[ix] = { ...next[ix], variacao: fmt2(v) };
                                  salvarExtras(next);
                                }
                              }}
                            />
                          )}
                        </td>

                        <td className="td nowrap" style={{ textAlign: "right" }}>
                          {x.fixed ? (
                            moneyBR(0)
                          ) : (
                            <input
                              className="input"
                              style={{ textAlign: "right" }}
                              value={String(relExtras.find((z) => z.id === x.id)?.desconto ?? 0).replace(".", ",")}
                              onChange={(e) => {
                                const v = parseMoneyInput(e.target.value);
                                const next = relExtras.slice();
                                const ix = next.findIndex((z) => z.id === x.id);
                                if (ix >= 0) {
                                  next[ix] = { ...next[ix], desconto: fmt2(v) };
                                  salvarExtras(next);
                                }
                              }}
                            />
                          )}
                        </td>

                        <td className="td nowrap" style={{ textAlign: "right", fontWeight: 900 }}>
                          {x.fixed ? (
                            <input
                              className="input"
                              style={{ textAlign: "right", fontWeight: 900 }}
                              value={String(relExtras.find((z) => z.id === x.id)?.recebido ?? 0).replace(".", ",")}
                              onChange={(e) => {
                                const v = parseMoneyInput(e.target.value);
                                const next = relExtras.slice();
                                const ix = next.findIndex((z) => z.id === x.id);
                                if (ix >= 0) {
                                  next[ix] = { ...next[ix], recebido: fmt2(v) };
                                  salvarExtras(next);
                                }
                              }}
                            />
                          ) : (
                            moneyBR(x.recebido)
                          )}
                        </td>
                      </tr>
                    ))}

                    <tr style={{ background: "#f0f7ff", fontWeight: 900 }}>
                      <td className="td nowrap" colSpan={2}>TOTAL GERAL (com extras)</td>
                      <td className="td nowrap" style={{ textAlign: "right" }}>{moneyBR(totalsGeralComExtras.previsto)}</td>
                      <td className="td nowrap" style={{ textAlign: "right" }}>{moneyBR(totalsGeralComExtras.variacao)}</td>
                      <td className="td nowrap" style={{ textAlign: "right", color: totalsGeralComExtras.desconto < 0 ? "#b00020" : "#333" }}>
                        {totalsGeralComExtras.desconto < 0 ? `- ${moneyBR(Math.abs(totalsGeralComExtras.desconto))}` : moneyBR(totalsGeralComExtras.desconto)}
                      </td>
                      <td className="td nowrap" style={{ textAlign: "right" }}>{moneyBR(totalsGeralComExtras.recebido)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mini" style={{ marginTop: 8 }}>
                Regra: <b>Previsto + Variação + Descontos = Valor Recebido</b>.
              </div>
            </>
          )}
        </section>

        {/* Parcelas preferidas */}
        <section style={{ ...card, marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>Parcelas do mês / Atrasadas em aberto</h2>
            <div className="mini">Clique na linha para lançar. Se for PARCIAL, tem “Ver parcial”.</div>
          </div>

          {!unidadeAtual ? (
            <div className="mini" style={{ marginTop: 10 }}>Selecione uma unidade.</div>
          ) : parcelasPreferidas.length === 0 ? (
            <div className="mini" style={{ marginTop: 10 }}>Não há parcelas em aberto/parcial (do mês ou atrasadas).</div>
          ) : (
            <div style={{ marginTop: 10, overflow: "auto", border: "1px solid #eee", borderRadius: 12, maxHeight: "40vh" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th className="th nowrap">Vencimento</th>
                    <th className="th nowrap">Tipo</th>
                    <th className="th nowrap" style={{ textAlign: "right" }}>Previsto</th>
                    <th className="th nowrap" style={{ textAlign: "right" }}>Recebido</th>
                    <th className="th nowrap">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parcelasPreferidas.map((p) => {
                    const st = statusParcela(p);
                    const recebido = somaRecebido(p.id);

                    const cls =
                      pagasAgoraIds.has(p.id) ? "rowPagaAgora" : st === "PARCIAL" ? "rowParcial" : st === "QUITADA" ? "rowQuitada" : "";

                    const badge =
                      st === "QUITADA"
                        ? { text: "QUITADA", bg: "#e9fff0" }
                        : st === "PARCIAL"
                        ? { text: "PARCIAL", bg: "#fff6db" }
                        : { text: "ABERTA", bg: "#f3f3f3" };

                    return (
                      <tr
                        key={p.id}
                        className={`clickRow ${cls}`}
                        style={{ cursor: isMaster ? "pointer" : "default" }}
                        onClick={() => (isMaster ? openPagarParcela(p.id) : null)}
                      >
                        <td className="td nowrap">{p.vencimento}</td>
                        <td className="td nowrap">{p.tipo}</td>
                        <td className="td nowrap" style={{ textAlign: "right" }}>{moneyBR(p.valorPrevisto)}</td>
                        <td className="td nowrap" style={{ textAlign: "right" }}>{recebido > 0 ? moneyBR(recebido) : "—"}</td>
                        <td className="td nowrap" onClick={(e) => e.stopPropagation()}>
                          <span className="badge" style={{ background: badge.bg }}>{badge.text}</span>
                          {st === "PARCIAL" && (
                            <span style={{ marginLeft: 10 }}>
                              <button className="linkBtn" onClick={() => openParcialModal(p.id, "PARCIAL")}>Ver parcial</button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Ficha completa */}
        <section style={{ ...card, marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>Ficha completa da unidade</h2>
            <div className="mini">Ordem: Previsto → Variação → Recebido → Data → Status</div>
          </div>

          {!unidadeAtual ? (
            <div className="mini" style={{ marginTop: 10 }}>Selecione uma unidade.</div>
          ) : parcelasDaUnidade.length === 0 ? (
            <div className="mini" style={{ marginTop: 10 }}>Não há parcelas processadas para esta unidade.</div>
          ) : (
            <div style={{ marginTop: 10, overflow: "auto", border: "1px solid #eee", borderRadius: 12, maxHeight: "65vh" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th className="th nowrap">Vencimento</th>
                    <th className="th nowrap">Tipo</th>
                    <th className="th nowrap" style={{ textAlign: "right" }}>Previsto</th>
                    <th className="th nowrap" style={{ textAlign: "right" }}>Variação</th>
                    <th className="th nowrap" style={{ textAlign: "right" }}>Recebido</th>
                    <th className="th nowrap">Data</th>
                    <th className="th nowrap">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parcelasDaUnidade.map((p) => {
                    const st = statusParcela(p);
                    const recebido = somaRecebido(p.id);
                    const varM = variacaoParcela(p);
                    const data = ultimaDataPagamento(p.id);
                    const cls =
                      pagasAgoraIds.has(p.id) ? "rowPagaAgora" : st === "PARCIAL" ? "rowParcial" : st === "QUITADA" ? "rowQuitada" : "";

                    const badge =
                      st === "QUITADA"
                        ? { text: "QUITADA", bg: "#e9fff0" }
                        : st === "PARCIAL"
                        ? { text: "PARCIAL", bg: "#fff6db" }
                        : { text: "ABERTA", bg: "#f3f3f3" };

                    return (
                      <tr
                        key={p.id}
                        className={cls}
                        style={{ cursor: isMaster ? "pointer" : "default" }}
                        onClick={() => (isMaster ? openPagarParcela(p.id) : null)}
                      >
                        <td className="td nowrap">{p.vencimento}</td>
                        <td className="td nowrap">{p.tipo}</td>
                        <td className="td nowrap" style={{ textAlign: "right" }}>{moneyBR(p.valorPrevisto)}</td>

                        <td
                          className="td nowrap"
                          style={{
                            textAlign: "right",
                            color: varM < 0 ? "#b00020" : "#333",
                            fontWeight: st === "QUITADA" && varM !== 0 ? 900 : 400,
                          }}
                        >
                          {st === "QUITADA"
                            ? varM === 0
                              ? moneyBR(0)
                              : varM < 0
                              ? `- ${moneyBR(Math.abs(varM))}`
                              : moneyBR(varM)
                            : "—"}
                        </td>

                        <td className="td nowrap" style={{ textAlign: "right" }}>{recebido > 0 ? moneyBR(recebido) : "—"}</td>
                        <td className="td nowrap">{data || "—"}</td>

                        <td className="td nowrap" onClick={(e) => e.stopPropagation()}>
                          <span className="badge" style={{ background: badge.bg }}>{badge.text}</span>

                          {st === "PARCIAL" && (
                            <span style={{ marginLeft: 10 }}>
                              <button className="linkBtn" onClick={() => openParcialModal(p.id, "PARCIAL")}>Ver parcial</button>
                            </span>
                          )}

                          {st === "QUITADA" && ultimoLoteId(p.id) && (
                            <span style={{ marginLeft: 10 }}>
                              <button className="linkBtn" onClick={() => openParcialModal(p.id, "LOTE")} title="Ver histórico do lote">
                                Ver lote
                              </button>
                            </span>
                          )}

                          {st === "QUITADA" && !ultimoLoteId(p.id) && (
                            <span style={{ marginLeft: 10 }}>
                              <button className="linkBtn" onClick={() => openParcialModal(p.id, "PARCELA")} title="Ver histórico desta parcela">
                                Ver histórico
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* =========================
          ✅ MODAL HISTÓRICO (PARCIAL / PARCELA / LOTE)
         ========================= */}
      {showParcial && (
        <div className="modalOverlay" onMouseDown={() => setShowParcial(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 900, fontSize: 16, color: "#333" }}>
                Histórico —{" "}
                {parcialMode === "PARCIAL" ? "Pagamentos parciais (somente PAGAMENTO)" : parcialMode === "LOTE" ? "Lote (todas as linhas)" : "Parcela (todas as linhas)"}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="pill">Modo: {parcialMode}</span>
                <button style={btn} onClick={() => setShowParcial(false)}>Fechar</button>
              </div>
            </div>

            {(() => {
              const base = pagamentosDaParcela(parcialParcelaId)
                .slice()
                .sort((a, b) => (a.criadoEm || "").localeCompare(b.criadoEm || ""));

              if (!base.length) {
                return (
                  <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 12, background: "#fafafa" }}>
                    <div style={{ fontWeight: 900, color: "#b00020" }}>Nenhum lançamento encontrado para esta parcela.</div>
                  </div>
                );
              }

              const loteIdRef = ultimoLoteId(parcialParcelaId);

              // ✅ regra:
              // - PARCIAL: mostrar apenas PAGAMENTO (sem desconto) e sempre todas as linhas (1,2,3...)
              // - PARCELA: mostrar tudo daquela parcela
              // - LOTE: mostrar todas as linhas do MESMO loteId, varrendo TODAS as parcelas da unidade
              let list: PagamentoParcial[] = [];

              if (parcialMode === "PARCIAL") {
                list = base.filter((x) => ((x.kind ?? "PAGAMENTO") as PagamentoKind) === "PAGAMENTO");
              } else if (parcialMode === "PARCELA") {
                list = base;
              } else {
                const loteId = loteIdRef;
                if (!loteId) {
                  list = base; // fallback
                } else {
                  const allParcelaIdsDaUnidade = parcelasDaUnidade.map((p) => p.id);
                  const all: PagamentoParcial[] = [];
                  for (const pid of allParcelaIdsDaUnidade) {
                    const arr = pagamentosDaParcela(pid);
                    for (const x of arr) {
                      if ((x.loteId ?? "") === loteId) all.push(x);
                    }
                  }
                  list = all.sort((a, b) => (a.criadoEm || "").localeCompare(b.criadoEm || ""));
                }
              }

              if (!list.length) {
                return (
                  <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 12, background: "#fafafa" }}>
                    <div style={{ fontWeight: 900, color: "#b00020" }}>Nenhuma linha encontrada para este modo.</div>
                  </div>
                );
              }

              let acum = 0;
              return (
                <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 12, overflow: "auto" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        {parcialMode === "LOTE" && <th className="th nowrap">Parcela</th>}
                        <th className="th nowrap">Data</th>
                        <th className="th nowrap">Tipo</th>
                        <th className="th nowrap" style={{ textAlign: "right" }}>Valor</th>
                        <th className="th nowrap">Lote</th>
                        <th className="th nowrap" style={{ textAlign: "right" }}>Acumulado (quitação)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((x) => {
                        const kind = (x.kind ?? "PAGAMENTO") as PagamentoKind;
                        const isDesc = kind === "DESCONTO";
                        acum = fmt2(acum + (x.valor || 0));
                        const lote = x.loteId ?? "";
                        return (
                          <tr key={`${x.id}-${x.criadoEm}`} style={lote ? { background: pastelFromId(lote) } : undefined}>
                            {parcialMode === "LOTE" && (
                              <td className="td nowrap" style={{ fontWeight: 900 }}>{x.parcelaId}</td>
                            )}
                            <td className="td nowrap">{x.data || "—"}</td>
                            <td className="td nowrap" style={{ fontWeight: 900, color: isDesc ? "#b00020" : "#333" }}>
                              {isDesc ? "DESCONTO" : "PAGAMENTO"}
                            </td>
                            <td className="td nowrap" style={{ textAlign: "right", fontWeight: 900, color: isDesc ? "#b00020" : "#333" }}>
                              {isDesc ? `- ${moneyBR(Math.abs(x.valor))}` : moneyBR(x.valor)}
                            </td>
                            <td className="td nowrap">{lote || "—"}</td>
                            <td className="td nowrap" style={{ textAlign: "right", fontWeight: 900 }}>{moneyBR(acum)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* =========================
          ✅ MODAL PAGAR INDIVIDUAL
         ========================= */}
      {showPagar && (
        <div className="modalOverlay" onMouseDown={() => setShowPagar(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 900, fontSize: 16, color: "#333" }}>Lançar pagamento</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={btn} onClick={openLoteFromParcela} title="Abre lote já com o mesmo tipo desta parcela">
                  Pagamento em Lote deste tipo
                </button>
                <button style={btn} onClick={() => setShowPagar(false)}>Cancelar</button>
                <button style={primaryBtn} onClick={salvarPagamentoIndividual}>Salvar</button>
              </div>
            </div>

            <div className="mini" style={{ marginTop: 6 }}>
              Se marcar <b>Desconto</b>, o sistema quita a parcela e coloca a diferença como <b>Variação Monetária negativa</b>.
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontWeight: 900,
                  ...(pagarDesconto
                    ? { background: "#0b4fd6", color: "white", border: "none" }
                    : { background: "white", color: "#0b4fd6", border: "1px solid #0b4fd6" }),
                }}
                onClick={() => setPagarDesconto((v) => !v)}
              >
                Desconto: {pagarDesconto ? "SIM" : "NÃO"}
              </button>

              <button
                className="linkBtn"
                onClick={() => {
                  setShowPagar(false);
                  openParcialModal(parcelaPagarId, "PARCELA");
                }}
                title="Ver histórico desta parcela"
              >
                Ver histórico desta parcela
              </button>

              {/* ✅ se já tiver parcial, mostra botão de parcial também */}
              <button
                className="linkBtn"
                onClick={() => {
                  setShowPagar(false);
                  openParcialModal(parcelaPagarId, "PARCIAL");
                }}
                title="Ver somente pagamentos parciais (sem descontos)"
              >
                Ver parcial
              </button>
            </div>

            <div style={{ marginTop: 12 }} className="grid2">
              <div>
                <div className="mini">Valor pago</div>
                <input
                  id="pagar_valor"
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
                  value={pagarValor}
                  onChange={(e) => setPagarValor(e.target.value)}
                  placeholder="ex.: 1.234,56"
                />
              </div>
              <div>
                <div className="mini">Data do recebimento</div>
                <input
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
                  value={dateTypingMask(pagarData)}
                  onChange={(e) => setPagarData(e.target.value)}
                  onBlur={(e) => setPagarData(dateNormalizeOnBlur(e.target.value))}
                  placeholder="01/01/2026"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================
          ✅ MODAL LOTE
         ========================= */}
      {showLote && (
        <div className="modalOverlay" onMouseDown={() => setShowLote(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 900, fontSize: 16, color: "#333" }}>Pagamento em lote (por tipo)</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={btn} onClick={() => setShowLote(false)}>Cancelar</button>
                <button style={primaryBtn} onClick={aplicarLote}>Aplicar lote</button>
              </div>
            </div>

            <div style={{ marginTop: 10, background: "#f7f7f7", border: "1px solid #e6e6e6", borderRadius: 12, padding: 10 }}>
              <div style={{ fontWeight: 900, color: "#333" }}>Resumo (antes de aplicar)</div>
              {!loteResumo ? (
                <div className="mini">Selecione unidade e preencha os campos.</div>
              ) : !loteResumo.ok ? (
                <div className="mini" style={{ color: "#8a0000", fontWeight: 900 }}>{loteResumo.msg}</div>
              ) : (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
                  <div className="mini">Quantidade: <b>{loteResumo.qtd}</b></div>
                  <div className="mini">Previsto a quitar: <b>{moneyBR(loteResumo.previstoAQuit)}</b></div>
                  <div className="mini">Recebido: <b>{moneyBR(loteResumo.recebido)}</b></div>
                  <div className="mini">
                    Desconto:{" "}
                    <b style={{ color: loteResumo.desconto > 0 ? "#b00020" : "#333" }}>
                      {loteResumo.desconto > 0 ? `- ${moneyBR(loteResumo.desconto)}` : moneyBR(0)}
                    </b>
                  </div>
                  <div className="mini">Sobra (variação +): <b>{moneyBR(loteResumo.sobra)}</b></div>
                </div>
              )}
            </div>

            <div className="mini" style={{ marginTop: 10 }}>
              ✅ No lote com <b>Desconto</b> + <b>Quantidade</b>, o sistema quita exatamente a quantidade (podendo haver parcela 100% desconto).
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontWeight: 900,
                  ...(loteDesconto
                    ? { background: "#0b4fd6", color: "white", border: "none" }
                    : { background: "white", color: "#0b4fd6", border: "1px solid #0b4fd6" }),
                }}
                onClick={() => setLoteDesconto((v) => !v)}
              >
                Desconto: {loteDesconto ? "SIM" : "NÃO"}
              </button>

              {loteDesconto && (
                <div style={{ minWidth: 240 }}>
                  <div className="mini">Quantidade de parcelas (obrigatório)</div>
                  <input
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
                    value={loteQtd}
                    onChange={(e) => setLoteQtd(onlyDigits(e.target.value).slice(0, 3))}
                    placeholder="ex.: 2"
                  />
                </div>
              )}
            </div>

            <div style={{ marginTop: 12 }} className="grid2">
              <div>
                <div className="mini">Tipo de parcela</div>
                <select
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
                  value={loteTipo}
                  onChange={(e) => setLoteTipo(e.target.value as TipoPagamento)}
                  disabled={loteFixado}
                  title={loteFixado ? "Tipo travado (aberto a partir de uma parcela)" : "Selecione o tipo"}
                >
                  {TIPOS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mini">Valor total pago (lote)</div>
                <input
                  id="lote_valor"
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
                  value={loteValor}
                  onChange={(e) => setLoteValor(e.target.value)}
                  placeholder="ex.: 990,00"
                />
              </div>

              <div>
                <div className="mini">Data do recebimento</div>
                <input
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
                  value={dateTypingMask(loteData)}
                  onChange={(e) => setLoteData(e.target.value)}
                  onBlur={(e) => setLoteData(dateNormalizeOnBlur(e.target.value))}
                  placeholder="01/01/2026"
                />
              </div>
            </div>

            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
              <button style={dangerBtn} onClick={() => setShowLote(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* =========================
          ✅ MODAL QUITAR UNIDADE
         ========================= */}
      {showQuitar && (
        <div className="modalOverlay" onMouseDown={() => setShowQuitar(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 900, fontSize: 16, color: "#333" }}>Quitar Unidade</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={btn} onClick={() => setShowQuitar(false)}>Cancelar</button>
                <button
                  style={btn}
                  onClick={() => setShowSimDetalhe((v) => !v)}
                  title="Mostra a simulação por parcela (sem gravar nada)"
                >
                  Simular quitação (sem gravar)
                </button>
                <button style={dangerBtn} onClick={aplicarQuitarUnidadeComConfirmacao}>
                  Quitar agora
                </button>
              </div>
            </div>

            <div className="mini" style={{ marginTop: 6 }}>
              Vai quitar todas as parcelas em aberto/parcial. Se faltar, completa com DESCONTO. Se sobrar, vira variação positiva na última parcela.
            </div>

            <div style={{ marginTop: 12 }} className="grid2">
              <div>
                <div className="mini">Valor recebido (total)</div>
                <input
                  id="quitar_valor"
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
                  value={quitarValor}
                  onChange={(e) => setQuitarValor(e.target.value)}
                  placeholder="ex.: 50.000,00"
                />
              </div>
              <div>
                <div className="mini">Data do recebimento</div>
                <input
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
                  value={dateTypingMask(quitarData)}
                  onChange={(e) => setQuitarData(e.target.value)}
                  onBlur={(e) => setQuitarData(dateNormalizeOnBlur(e.target.value))}
                  placeholder="01/01/2026"
                />
              </div>
            </div>

            <div style={{ marginTop: 12, background: "#f7f7f7", border: "1px solid #e6e6e6", borderRadius: 12, padding: 10 }}>
              <div style={{ fontWeight: 900, color: "#333" }}>Resumo (antes de quitar)</div>

              {!quitarResumo ? (
                <div className="mini">Selecione unidade e preencha o valor.</div>
              ) : !quitarResumo.ok ? (
                <div className="mini" style={{ color: "#8a0000", fontWeight: 900 }}>{quitarResumo.msg}</div>
              ) : (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
                  <div className="mini">Parcelas em aberto/parcial: <b>{quitarResumo.qtd}</b></div>
                  <div className="mini">Previsto a quitar: <b>{moneyBR(quitarResumo.previstoAQuit)}</b></div>
                  <div className="mini">Recebido: <b>{moneyBR(quitarResumo.recebido)}</b></div>
                  <div className="mini">
                    Desconto:{" "}
                    <b style={{ color: quitarResumo.desconto > 0 ? "#b00020" : "#333" }}>
                      {quitarResumo.desconto > 0 ? `- ${moneyBR(quitarResumo.desconto)}` : moneyBR(0)}
                    </b>
                  </div>
                  <div className="mini">Sobra (variação +): <b>{moneyBR(quitarResumo.sobra)}</b></div>
                </div>
              )}
            </div>

            {showSimDetalhe && (
              <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 12, overflow: "auto" }}>
                <div style={{ padding: 10, fontWeight: 900, color: "#333", background: "#fff" }}>
                  Simulação detalhada (sem gravar)
                </div>

                {!quitarSimulacao ? (
                  <div className="mini" style={{ padding: 10 }}>
                    Informe um valor válido e tenha parcelas em aberto/parcial.
                  </div>
                ) : (
                  <>
                    <div className="mini" style={{ padding: "0 10px 10px 10px" }}>
                      Total pago aplicado: <b>{moneyBR(quitarSimulacao.totalPagoAplicado)}</b> | Desconto total:{" "}
                      <b style={{ color: quitarSimulacao.totalDesconto > 0 ? "#b00020" : "#333" }}>
                        {quitarSimulacao.totalDesconto > 0 ? `- ${moneyBR(quitarSimulacao.totalDesconto)}` : moneyBR(0)}
                      </b>{" "}
                      | Sobra (variação +): <b>{moneyBR(quitarSimulacao.sobra)}</b>
                    </div>

                    <table className="table">
                      <thead>
                        <tr>
                          <th className="th nowrap">Vencimento</th>
                          <th className="th nowrap">Tipo</th>
                          <th className="th nowrap" style={{ textAlign: "right" }}>Falta (antes)</th>
                          <th className="th nowrap" style={{ textAlign: "right" }}>Pagamento</th>
                          <th className="th nowrap" style={{ textAlign: "right" }}>Desconto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quitarSimulacao.itens.map((it) => (
                          <tr key={it.parcelaId}>
                            <td className="td nowrap">{it.vencimento}</td>
                            <td className="td nowrap">{it.tipo}</td>
                            <td className="td nowrap" style={{ textAlign: "right" }}>{moneyBR(it.faltaAntes)}</td>
                            <td className="td nowrap" style={{ textAlign: "right" }}>{it.pagar > 0 ? moneyBR(it.pagar) : "—"}</td>
                            <td
                              className="td nowrap"
                              style={{ textAlign: "right", color: it.desconto > 0 ? "#b00020" : "#333", fontWeight: it.desconto > 0 ? 900 : 400 }}
                            >
                              {it.desconto > 0 ? `- ${moneyBR(it.desconto)}` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
