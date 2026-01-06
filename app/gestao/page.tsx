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
  dataVenda?: string; // ✅ agora guardamos em dd/mm/aaaa

  percentualCusto?: number;
  tipoCusto?: string;

  quitadoEm?: string;
  quitado?: boolean;
  status?: string;
  statusPagamento?: string;
  statusVenda?: string;

  valorPago?: number;
  saldoDevedor?: number;
  saldo?: number;

  criadoEm: string;
  atualizadoEm?: string;
};

type QuadroUnidade = {
  unidadeId: string;
  percentual: number;
  tipo?: string;
  cor?: string;
  isEspecial?: boolean;
};

type CustoMensal = { id: string; competencia: string; valor: number; criadoEm: string };

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

type Distrato = {
  id: string;
  empresaId: string;
  obraId: string;
  unidadeId: string;

  compradorNome: string;
  valorVenda: number;
  dataVenda: string;

  dataDistrato: string; // ISO
  criadoEm: string; // ISO
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

type FormaPagamentoItem = {
  id: string;
  tipo: TipoPagamento;
  dataPrimeira: string; // dd/mm/aaaa
  quantidade: string;
  valor: string;
};

const TIPOS: TipoPagamento[] = ["Entrada", "Mensal", "Semestral", "Anual", "Única", "Financiamento", "Outras"];

const STORAGE_EMPRESAS = "ci_empresas";
const STORAGE_OBRAS = "ci_obras";
const STORAGE_UNIDADES = "ci_unidades";
const STORAGE_CUSTOS = "ci_quadro_custos";
const STORAGE_DISTRATOS = "ci_distratos";
const STORAGE_PARCELAS = "ci_parcelas_previstas";

const STORAGE_PROCESSAMENTO_TARGET = "ci_processamento_target";

const PROCESSING_KEYS = [
  "ci_processamento",
  "ci_pagamentos",
  "ci_recebimentos",
  "ci_quitacoes",
  "ci_financeiro",
  "ci_processamento_vendas",
  "ci_vendas_processamento",
  "ci_pagamentos_unidades",
  "ci_pagamentos_parciais",
];

function onlyDigits(v: string | undefined | null) {
  return String(v ?? "").replace(/\D/g, "");
}
function pad4(v: string | undefined | null) {
  const d = onlyDigits(v).slice(0, 4);
  return d.padStart(4, "0");
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
function moneyBR(v: number) {
  const vv = Number(v ?? 0);
  try {
    return vv.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  } catch {
    return `R$ ${vv.toFixed(2)}`;
  }
}
function parseMoneyInput(s: string) {
  const t = String(s ?? "").trim();
  if (!t) return 0;
  const normalized = t.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}
function uuid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

// ✅ ORDEM POR ANDAR e FINAL
function parseFloorFinal(unidadeId: string) {
  const n = Number(onlyDigits(unidadeId) || "0");
  const floor = Math.floor(n / 10);
  const final = n % 10;
  return { n, floor, final };
}
function compareUnidade(a: string, b: string) {
  const A = parseFloorFinal(a);
  const B = parseFloorFinal(b);
  if (A.floor !== B.floor) return A.floor - B.floor;
  if (A.final !== B.final) return A.final - B.final;
  return A.n - B.n;
}
function chaveEO(empresaId: string, obraId: string) {
  return `${pad4(empresaId)}-${pad4(obraId)}`;
}

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
  const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);

  const out = floors.slice();
  let k = 0;
  while (rest > 0 && order.length > 0) {
    out[order[k].i] += 1;
    rest -= 1;
    k = (k + 1) % order.length;
  }
  return out;
}

type Status = "DISPONIVEL" | "VENDIDO" | "QUITADO";

function stringUpper(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

function isQuitadoByFields(u: any): boolean {
  if (u?.quitadoEm) return true;
  if (u?.quitado === true) return true;

  const candidates = [u?.status, u?.statusPagamento, u?.statusVenda, u?.situacao, u?.pagamentoStatus]
    .map(stringUpper)
    .filter(Boolean);

  for (const s of candidates) {
    if (s.includes("QUIT")) return true;
    if (s.includes("PAG")) return true;
    if (s.includes("LIQ")) return true;
  }

  const saldo = Number(u?.saldoDevedor ?? u?.saldo ?? NaN);
  if (Number.isFinite(saldo) && saldo === 0) {
    const vv = Number(u?.valorVenda ?? 0);
    if (vv > 0) return true;
  }

  const pago = Number(u?.valorPago ?? NaN);
  const venda = Number(u?.valorVenda ?? NaN);
  if (Number.isFinite(pago) && Number.isFinite(venda) && venda > 0 && pago >= venda - 0.01) return true;

  return false;
}

function collectQuitadasFromAnyJson(data: any, empresaId: string, obraId: string, out: Set<string>) {
  const emp = pad4(empresaId);
  const ob = pad4(obraId);

  const stack: any[] = [data];
  const seen = new Set<any>();

  const maybeAdd = (obj: any) => {
    const e = obj?.empresaId ?? obj?.empresa ?? obj?.idEmpresa;
    const o = obj?.obraId ?? obj?.obra ?? obj?.idObra;
    const u = obj?.unidadeId ?? obj?.unidade ?? obj?.idUnidade ?? obj?.unidadeNumero ?? obj?.numeroUnidade;

    if (!u) return;

    const eOk = e == null ? true : pad4(e) === emp;
    const oOk = o == null ? true : pad4(o) === ob;
    if (!eOk || !oOk) return;

    const uid = pad4(u);

    const s1 = stringUpper(obj?.status);
    const s2 = stringUpper(obj?.statusPagamento);
    const s3 = stringUpper(obj?.situacao);
    const quitado =
      obj?.quitado === true ||
      !!obj?.quitadoEm ||
      s1.includes("QUIT") ||
      s2.includes("QUIT") ||
      s3.includes("QUIT");

    const saldo = Number(obj?.saldoDevedor ?? obj?.saldo ?? NaN);
    const vv = Number(obj?.valorVenda ?? obj?.valor ?? obj?.total ?? NaN);
    const pago = Number(obj?.valorPago ?? obj?.totalPago ?? obj?.pago ?? NaN);

    const quitadoPorSaldo = Number.isFinite(saldo) && saldo === 0 && (Number.isFinite(vv) ? vv > 0 : true);
    const quitadoPorPago = Number.isFinite(pago) && Number.isFinite(vv) && vv > 0 && pago >= vv - 0.01;

    if (quitado || quitadoPorSaldo || quitadoPorPago) out.add(uid);
  };

  while (stack.length) {
    const cur = stack.pop();
    if (cur == null) continue;
    if (typeof cur !== "object") continue;
    if (seen.has(cur)) continue;
    seen.add(cur);

    maybeAdd(cur);

    if (Array.isArray(cur)) {
      for (const it of cur) stack.push(it);
    } else {
      for (const k of Object.keys(cur)) stack.push(cur[k]);
    }
  }
}

function statusOfRow(
  u: { compradorNome: string; dataVenda: string; valorVenda: number },
  quitadoOverride: boolean
): Status {
  if (quitadoOverride) return "QUITADO";
  const isVendida = !!u.compradorNome || !!u.dataVenda || (u.valorVenda || 0) > 0;
  return isVendida ? "VENDIDO" : "DISPONIVEL";
}

/* ============================
   ✅ CPF/CNPJ: máscara + validação
   ============================ */
type DocTipo = "CPF" | "CNPJ";

function maskCPF(v: string) {
  const d = onlyDigits(v).slice(0, 11);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 9);
  const p4 = d.slice(9, 11);
  let out = "";
  if (p1) out += p1;
  if (p2) out += "." + p2;
  if (p3) out += "." + p3;
  if (p4) out += "-" + p4;
  return out;
}
function maskCNPJ(v: string) {
  const d = onlyDigits(v).slice(0, 14);
  const p1 = d.slice(0, 2);
  const p2 = d.slice(2, 5);
  const p3 = d.slice(5, 8);
  const p4 = d.slice(8, 12);
  const p5 = d.slice(12, 14);
  let out = "";
  if (p1) out += p1;
  if (p2) out += "." + p2;
  if (p3) out += "." + p3;
  if (p4) out += "/" + p4;
  if (p5) out += "-" + p5;
  return out;
}

function isValidCPF(digits: string) {
  const cpf = onlyDigits(digits);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  if (d1 !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  return d2 === Number(cpf[10]);
}

function isValidCNPJ(digits: string) {
  const cnpj = onlyDigits(digits);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const calc = (base: string) => {
    const weights =
      base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += Number(base[i]) * weights[i];
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const d1 = calc(cnpj.slice(0, 12));
  if (d1 !== Number(cnpj[12])) return false;

  const d2 = calc(cnpj.slice(0, 13));
  return d2 === Number(cnpj[13]);
}

function detectDocTipo(digits: string): DocTipo {
  const d = onlyDigits(digits);
  return d.length > 11 ? "CNPJ" : "CPF";
}

/* ============================
   ✅ Datas BR
   ============================ */
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
function isValidDateBR(s: string) {
  const m = String(s ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return false;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const dt = new Date(yyyy, mm - 1, dd);
  return dt.getFullYear() === yyyy && dt.getMonth() === mm - 1 && dt.getDate() === dd;
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
  else if (yyRaw.length === 2) yyyy = "20" + yyRaw; // ✅ 25 -> 2025
  else if (yyRaw.length === 3) yyyy = "2" + yyRaw;
  else if (yyRaw.length >= 4) yyyy = yyRaw.slice(0, 4);

  return `${dd}/${mm}/${yyyy}`;
}
function sortDateBR(a: string, b: string) {
  const da = parseDateBR(a);
  const db = parseDateBR(b);
  if (!da || !db) return a.localeCompare(b);
  return da.getTime() - db.getTime();
}
function addMonthsKeepDay(d: Date, months: number) {
  const day = d.getDate();
  const x = new Date(d.getTime());
  x.setMonth(x.getMonth() + months);
  if (x.getDate() !== day) x.setDate(0);
  return x;
}
function fmtBRDate(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

// ✅ converte YYYY-MM-DD (antigo) para dd/mm/aaaa (novo)
function isoToBR(iso: string) {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}
function normalizeVendaDateAny(raw: string) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isoToBR(s); // legacy
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  // aceita ddmmyy / ddmmyyyy / dd/mm/yy
  return dateNormalizeOnBlur(s);
}

export default function GestaoPage() {
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [obras, setObras] = useState<Obra[]>([]);
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [parcelasPrevistas, setParcelasPrevistas] = useState<ParcelaPrevista[]>([]);

  const [empresaSel, setEmpresaSel] = useState("");
  const [obraSel, setObraSel] = useState("");

  const [quadro, setQuadro] = useState<QuadroCustos | null>(null);

  // modal editar
  const [openEdit, setOpenEdit] = useState(false);
  const [editUnidadeId, setEditUnidadeId] = useState<string>("");

  const [compradorNome, setCompradorNome] = useState("");
  const [docTipo, setDocTipo] = useState<DocTipo>("CPF");
  const [docInput, setDocInput] = useState("");
  const [docErro, setDocErro] = useState<string>("");

  // ✅ agora dd/mm/aaaa
  const [dataVenda, setDataVenda] = useState("");
  const [valorVenda, setValorVenda] = useState("");
  const [quitadoCheck, setQuitadoCheck] = useState(false);

  const [editParcelas, setEditParcelas] = useState<ParcelaPrevista[]>([]);

  const [fpItens, setFpItens] = useState<FormaPagamentoItem[]>([]);
  const [fpTipo, setFpTipo] = useState<TipoPagamento>("Entrada");
  const [fpVenc, setFpVenc] = useState("");
  const [fpQtd, setFpQtd] = useState("");
  const [fpValor, setFpValor] = useState("");

  const [openDistratos, setOpenDistratos] = useState(false);

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
      cpfCnpjDigits: onlyDigits(u?.cpfCnpjDigits ?? u?.cpfCnpj ?? ""),
      valorVenda: Number(u?.valorVenda ?? 0),
      dataVenda: normalizeVendaDateAny(u?.dataVenda ?? ""),
      percentualCusto: typeof u?.percentualCusto === "number" ? Number(u.percentualCusto) : undefined,
      tipoCusto: u?.tipoCusto ?? undefined,

      quitadoEm: u?.quitadoEm ?? undefined,
      quitado: typeof u?.quitado === "boolean" ? u.quitado : undefined,
      status: u?.status ?? undefined,
      statusPagamento: u?.statusPagamento ?? undefined,
      statusVenda: u?.statusVenda ?? undefined,

      valorPago: typeof u?.valorPago === "number" ? Number(u.valorPago) : undefined,
      saldoDevedor: typeof u?.saldoDevedor === "number" ? Number(u.saldoDevedor) : undefined,
      saldo: typeof u?.saldo === "number" ? Number(u.saldo) : undefined,

      criadoEm: u?.criadoEm ?? new Date().toISOString(),
      atualizadoEm: u?.atualizadoEm ?? undefined,
    })) as Unidade[];

    const pars = loadJson<any[]>(STORAGE_PARCELAS, []).map((p) => ({
      ...p,
      id: String(p?.id ?? uuid()),
      empresaId: pad4(p?.empresaId),
      obraId: pad4(p?.obraId),
      unidadeId: pad4(p?.unidadeId),
      tipo: (TIPOS as string[]).includes(String(p?.tipo)) ? (p.tipo as TipoPagamento) : "Outras",
      vencimento: String(p?.vencimento ?? ""),
      valorPrevisto: Number(p?.valorPrevisto ?? 0),
    })) as ParcelaPrevista[];
    saveJson(STORAGE_PARCELAS, pars);

    setEmpresas(emps);
    setObras(obs);
    setUnidades(uns);
    setParcelasPrevistas(pars);
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
      return;
    }
    const all = loadJson<Record<string, QuadroCustos>>(STORAGE_CUSTOS, {});
    const key = chaveEO(empresaSel, obraSel);
    setQuadro(all[key] ?? null);
  }, [empresaSel, obraSel]);

  const unidadesDaObra = useMemo(() => {
    if (!empresaSel || !obraSel) return [];
    const emp = pad4(empresaSel);
    const ob = pad4(obraSel);
    return unidades.filter((u) => u.empresaId === emp && u.obraId === ob);
  }, [unidades, empresaSel, obraSel]);

  const quitadasDoProcessamento = useMemo(() => {
    const set = new Set<string>();
    if (!empresaSel || !obraSel) return set;

    const emp = pad4(empresaSel);
    const ob = pad4(obraSel);

    for (const k of PROCESSING_KEYS) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      try {
        const data = JSON.parse(raw);
        collectQuitadasFromAnyJson(data, emp, ob, set);
      } catch {}
    }

    return set;
  }, [empresaSel, obraSel]);

  const listaBase = useMemo(() => {
    if (!quadro) return [];
    const emp = quadro.empresaId;
    const ob = quadro.obraId;

    const mapU = new Map<string, Unidade>();
    for (const u of unidadesDaObra) mapU.set(pad4(u.id), u);

    return quadro.unidades
      .slice()
      .map((q) => {
        const id = pad4(q.unidadeId);
        const u = mapU.get(id);

        const base: Unidade = u
          ? u
          : {
              id,
              empresaId: emp,
              obraId: ob,
              compradorNome: "",
              cpfCnpjDigits: "",
              valorVenda: 0,
              dataVenda: "",
              percentualCusto: q.percentual,
              tipoCusto: q.tipo,
              criadoEm: new Date().toISOString(),
            };

        const quitadoLocal = isQuitadoByFields(base as any);
        const quitadoProc = quitadasDoProcessamento.has(id);
        const quitadoFinal = quitadoLocal || quitadoProc;

        const st = statusOfRow(
          {
            compradorNome: base.compradorNome || "",
            dataVenda: base.dataVenda || "",
            valorVenda: Number(base.valorVenda || 0),
          },
          quitadoFinal
        );

        return {
          unidadeId: id,
          compradorNome: base.compradorNome || "",
          cpfCnpjDigits: base.cpfCnpjDigits || "",
          dataVenda: base.dataVenda || "",
          valorVenda: Number(base.valorVenda || 0),
          statusCalc: st as Status,
          quitadoFinal,
          peso: Number(q.percentual || 0),
        };
      })
      .sort((a, b) => compareUnidade(a.unidadeId, b.unidadeId));
  }, [quadro, unidadesDaObra, quitadasDoProcessamento]);

  const resumo = useMemo(() => {
    const total = listaBase.length;
    let vendidas = 0;
    let quitadas = 0;
    let totalVendido = 0;

    for (const u of listaBase) {
      if (u.statusCalc === "VENDIDO") vendidas++;
      if (u.statusCalc === "QUITADO") quitadas++;
      totalVendido += Number(u.valorVenda || 0);
    }

    return {
      total,
      vendidas,
      quitadas,
      disponiveis: Math.max(0, total - (vendidas + quitadas)),
      totalVendido,
    };
  }, [listaBase]);

  const custosPorUnidade = useMemo(() => {
    if (!quadro) return new Map<string, { terreno: number; meses: number; total: number }>();

    const unidadesOrdenadas = quadro.unidades.slice().sort((a, b) => compareUnidade(a.unidadeId, b.unidadeId));
    const pesos = unidadesOrdenadas.map((u) => Number(u.percentual || 0));

    const terrenoCents = allocateCents(quadro.valorTerreno, pesos);

    const meses = (quadro.custosMensais || []).slice().sort((a, b) => a.competencia.localeCompare(b.competencia));
    const somaMesesCents = new Array(unidadesOrdenadas.length).fill(0);
    for (const c of meses) {
      const cents = allocateCents(c.valor, pesos);
      for (let i = 0; i < cents.length; i++) somaMesesCents[i] += cents[i];
    }

    const map = new Map<string, { terreno: number; meses: number; total: number }>();
    for (let i = 0; i < unidadesOrdenadas.length; i++) {
      const id = pad4(unidadesOrdenadas[i].unidadeId);
      const terreno = terrenoCents[i] / 100;
      const mesesV = somaMesesCents[i] / 100;
      map.set(id, { terreno, meses: mesesV, total: terreno + mesesV });
    }
    return map;
  }, [quadro]);

  const distratosDaObra = useMemo(() => {
    if (!empresaSel || !obraSel) return [];
    const all = loadJson<Distrato[]>(STORAGE_DISTRATOS, []);
    const emp = pad4(empresaSel);
    const ob = pad4(obraSel);

    return all
      .filter((d) => pad4(d.empresaId) === emp && pad4(d.obraId) === ob)
      .map((d) => ({ ...d, empresaId: pad4(d.empresaId), obraId: pad4(d.obraId), unidadeId: pad4(d.unidadeId) }))
      .sort((a, b) => String(b.dataDistrato).localeCompare(String(a.dataDistrato)));
  }, [empresaSel, obraSel]);

  function revalidateDoc(tipo: DocTipo, digits: string) {
    const d = onlyDigits(digits);
    if (!d) return "";
    if (tipo === "CPF") {
      if (d.length < 11) return "CPF incompleto.";
      return isValidCPF(d) ? "" : "CPF inválido.";
    } else {
      if (d.length < 14) return "CNPJ incompleto.";
      return isValidCNPJ(d) ? "" : "CNPJ inválido.";
    }
  }

  function setDocTipoSafe(t: DocTipo) {
    setDocTipo(t);
    const digits = onlyDigits(docInput);
    const masked = t === "CPF" ? maskCPF(digits) : maskCNPJ(digits);
    setDocInput(masked);
    setDocErro(revalidateDoc(t, masked));
  }

  function onChangeDoc(v: string) {
    const digits = onlyDigits(v);
    const masked = docTipo === "CPF" ? maskCPF(digits) : maskCNPJ(digits);
    setDocInput(masked);
    setDocErro(revalidateDoc(docTipo, masked));
  }

  function parcelasDaUnidadeAtual(empId: string, obId: string, unId: string) {
    const emp = pad4(empId);
    const ob = pad4(obId);
    const un = pad4(unId);
    return parcelasPrevistas
      .filter((p) => p.empresaId === emp && p.obraId === ob && p.unidadeId === un)
      .slice()
      .sort((a, b) => sortDateBR(a.vencimento, b.vencimento));
  }

  function abrirEditar(unidadeId: string) {
    if (!quadro) return;

    const it = listaBase.find((x) => x.unidadeId === pad4(unidadeId));
    if (!it) return;

    const uReal = unidadesDaObra.find((u) => pad4(u.id) === pad4(unidadeId));

    setEditUnidadeId(pad4(unidadeId));
    setCompradorNome(uReal?.compradorNome || it.compradorNome || "");

    const digits = onlyDigits(uReal?.cpfCnpjDigits || it.cpfCnpjDigits || "");
    const tipo = detectDocTipo(digits);
    setDocTipo(tipo);
    const masked = tipo === "CPF" ? maskCPF(digits) : maskCNPJ(digits);
    setDocInput(masked);
    setDocErro(revalidateDoc(tipo, masked));

    // ✅ dataVenda em dd/mm/aaaa
    setDataVenda(normalizeVendaDateAny(uReal?.dataVenda || it.dataVenda || ""));

    setValorVenda(
      (uReal?.valorVenda || it.valorVenda || 0) > 0
        ? Number(uReal?.valorVenda || it.valorVenda || 0).toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : ""
    );

    setQuitadoCheck(!!it.quitadoFinal);

    const pars = parcelasDaUnidadeAtual(quadro.empresaId, quadro.obraId, pad4(unidadeId));
    setEditParcelas(pars);

    setFpItens([]);
    setFpTipo("Entrada");
    setFpVenc("");
    setFpQtd("");
    setFpValor("");

    setOpenEdit(true);
  }

  function persistUnidade(patch: Partial<Unidade>) {
    if (!quadro) return;
    const emp = quadro.empresaId;
    const ob = quadro.obraId;
    const id = pad4(editUnidadeId);
    const now = new Date().toISOString();

    const all = loadJson<any[]>(STORAGE_UNIDADES, []);
    const idx = all.findIndex((u: any) => pad4(u?.id) === id && pad4(u?.empresaId) === emp && pad4(u?.obraId) === ob);

    if (idx >= 0) all[idx] = { ...all[idx], ...patch, atualizadoEm: now };
    else all.push({ id, empresaId: emp, obraId: ob, ...patch, criadoEm: now, atualizadoEm: now });

    saveJson(STORAGE_UNIDADES, all);

    const uns = all.map((u: any) => ({
      ...u,
      id: pad4(u?.id),
      empresaId: pad4(u?.empresaId),
      obraId: pad4(u?.obraId),
      compradorNome: u?.compradorNome ?? "",
      cpfCnpjDigits: onlyDigits(u?.cpfCnpjDigits ?? u?.cpfCnpj ?? ""),
      valorVenda: Number(u?.valorVenda ?? 0),
      dataVenda: normalizeVendaDateAny(u?.dataVenda ?? ""),
      percentualCusto: typeof u?.percentualCusto === "number" ? Number(u.percentualCusto) : undefined,
      tipoCusto: u?.tipoCusto ?? undefined,

      quitadoEm: u?.quitadoEm ?? undefined,
      quitado: typeof u?.quitado === "boolean" ? u.quitado : undefined,
      status: u?.status ?? undefined,
      statusPagamento: u?.statusPagamento ?? undefined,
      statusVenda: u?.statusVenda ?? undefined,

      valorPago: typeof u?.valorPago === "number" ? Number(u.valorPago) : undefined,
      saldoDevedor: typeof u?.saldoDevedor === "number" ? Number(u.saldoDevedor) : undefined,
      saldo: typeof u?.saldo === "number" ? Number(u.saldo) : undefined,

      criadoEm: u?.criadoEm ?? now,
      atualizadoEm: u?.atualizadoEm ?? now,
    })) as Unidade[];

    setUnidades(uns);
  }

  function salvarParcelasPrevistasDaUnidade() {
    if (!isMaster) return alert("Somente Master pode alterar.");
    if (!quadro) return;

    const emp = quadro.empresaId;
    const ob = quadro.obraId;
    const un = pad4(editUnidadeId);

    for (const p of editParcelas) {
      if (!p.tipo) return alert("Existe parcela sem tipo.");
      if (!p.vencimento || !isValidDateBR(p.vencimento)) return alert(`Data inválida na parcela: "${p.vencimento}"`);
      if (!(Number(p.valorPrevisto) > 0)) return alert("Existe parcela com valor previsto inválido (<= 0).");
    }

    const all = loadJson<ParcelaPrevista[]>(STORAGE_PARCELAS, []);
    const filtered = all.filter((p) => !(pad4(p.empresaId) === emp && pad4(p.obraId) === ob && pad4(p.unidadeId) === un));

    const cleaned = editParcelas.map((p) => ({
      id: String(p.id || uuid()),
      empresaId: emp,
      obraId: ob,
      unidadeId: un,
      tipo: p.tipo,
      vencimento: p.vencimento,
      valorPrevisto: Number(p.valorPrevisto),
    }));

    const merged = [...filtered, ...cleaned];
    saveJson(STORAGE_PARCELAS, merged);
    setParcelasPrevistas(merged);

    alert("Forma de pagamento salva! (Parcelas previstas atualizadas)");
  }

  function incluirItemForma() {
    if (!isMaster) return alert("Somente Master pode alterar.");
    if (!quadro) return;

    const venc = dateNormalizeOnBlur(fpVenc);
    const q = Number(onlyDigits(fpQtd)) || 0;
    const val = Number(parseMoneyInput(fpValor).toFixed(2));

    if (!isValidDateBR(venc)) return alert("Informe uma data válida (dd/mm/aaaa). Ex: 01/01/25");
    if (!(q > 0)) return alert("Informe a QUANTIDADE (maior que zero).");
    if (!(val > 0)) return alert("Informe um valor válido.");

    const item: FormaPagamentoItem = {
      id: uuid(),
      tipo: fpTipo,
      dataPrimeira: venc,
      quantidade: String(q),
      valor: fpValor,
    };

    setFpItens((prev) => [...prev, item]);
    setFpVenc("");
    setFpQtd("");
    setFpValor("");
  }

  function removerItemForma(id: string) {
    if (!isMaster) return;
    setFpItens((prev) => prev.filter((x) => x.id !== id));
  }

  const totalFormaParcial = useMemo(() => {
    const total = fpItens.reduce((s, it) => {
      const q = Number(onlyDigits(it.quantidade)) || 0;
      const v = parseMoneyInput(it.valor);
      return s + q * v;
    }, 0);
    return Number(total.toFixed(2));
  }, [fpItens]);

  function processarFormaPagamento() {
    if (!isMaster) return alert("Somente Master pode alterar.");
    if (!quadro) return;

    const venda = Number(parseMoneyInput(valorVenda).toFixed(2));
    if (!(venda > 0)) return alert("Informe primeiro o VALOR DA VENDA (para o sistema validar se bate).");

    if (!fpItens.length) return alert("Inclua pelo menos uma linha na Forma de Pagamento (tipo/data/qtd/valor).");

    const geradas: ParcelaPrevista[] = [];
    const emp = quadro.empresaId;
    const ob = quadro.obraId;
    const un = pad4(editUnidadeId);

    for (const it of fpItens) {
      const q = Number(onlyDigits(it.quantidade)) || 0;
      const v = Number(parseMoneyInput(it.valor).toFixed(2));
      const d0s = dateNormalizeOnBlur(it.dataPrimeira);
      const d0 = parseDateBR(d0s);

      if (!it.tipo) return alert("Existe linha sem tipo.");
      if (!d0 || !isValidDateBR(d0s)) return alert(`Data inválida na forma: "${it.dataPrimeira}"`);
      if (!(q > 0)) return alert("Existe linha com quantidade inválida (<= 0).");
      if (!(v > 0)) return alert("Existe linha com valor inválido (<= 0).");

      const step =
        it.tipo === "Mensal" ? 1 :
        it.tipo === "Semestral" ? 6 :
        it.tipo === "Anual" ? 12 :
        0;

      if (step === 0) {
        for (let i = 0; i < q; i++) {
          geradas.push({
            id: uuid(),
            empresaId: emp,
            obraId: ob,
            unidadeId: un,
            tipo: it.tipo,
            vencimento: fmtBRDate(d0),
            valorPrevisto: v,
          });
        }
      } else {
        let cur = new Date(d0.getTime());
        for (let i = 0; i < q; i++) {
          geradas.push({
            id: uuid(),
            empresaId: emp,
            obraId: ob,
            unidadeId: un,
            tipo: it.tipo,
            vencimento: fmtBRDate(cur),
            valorPrevisto: v,
          });
          cur = addMonthsKeepDay(cur, step);
        }
      }
    }

    geradas.sort((a, b) => sortDateBR(a.vencimento, b.vencimento));

    const totalPrev = Number(geradas.reduce((s, p) => s + Number(p.valorPrevisto || 0), 0).toFixed(2));

    if (Math.abs(totalPrev - venda) > 0.01) {
      return alert(
        `ATENÇÃO: o total previsto (${moneyBR(totalPrev)}) NÃO bate com o valor da venda (${moneyBR(venda)}).\n\n` +
          `Revise quantidades/valores antes de processar.`
      );
    }

    setEditParcelas(geradas);

    alert(
      `Processado! Foram geradas ${geradas.length} parcelas em ordem cronológica. Total: ${moneyBR(totalPrev)}.\n\nAgora clique em "Salvar forma de pagamento".`
    );
  }

  function removerParcela(id: string) {
    if (!isMaster) return;
    setEditParcelas((prev) => prev.filter((p) => p.id !== id));
  }

  function limparVenda() {
    if (!isMaster) return alert("Somente Master pode alterar.");
    persistUnidade({
      compradorNome: "",
      cpfCnpjDigits: "",
      dataVenda: "",
      valorVenda: 0,
      quitadoEm: undefined,
      quitado: false,
      statusPagamento: undefined,
      statusVenda: undefined,
      status: undefined,
      valorPago: undefined,
      saldoDevedor: undefined,
      saldo: undefined,
    });
    setOpenEdit(false);
  }

  function salvarVenda() {
    if (!isMaster) return alert("Somente Master pode alterar.");

    const nome = compradorNome.trim();
    const docDigits = onlyDigits(docInput);

    const dataNorm = normalizeVendaDateAny(dataVenda);
    const valor = Number(parseMoneyInput(valorVenda).toFixed(2));

    if (dataNorm && !isValidDateBR(dataNorm)) return alert("Data da venda inválida. Use dd/mm/aaaa (ex: 01/01/25).");

    if (docDigits) {
      const ok = docTipo === "CPF" ? isValidCPF(docDigits) : isValidCNPJ(docDigits);
      if (!ok) return alert(`${docTipo} inválido. Corrija antes de salvar.`);
    }

    const now = new Date().toISOString();
    const patch: Partial<Unidade> = {
      compradorNome: nome,
      cpfCnpjDigits: docDigits,
      dataVenda: dataNorm, // ✅ dd/mm/aaaa
      valorVenda: valor,
    };

    if (quitadoCheck) {
      patch.quitadoEm = now;
      patch.quitado = true;
      patch.statusPagamento = "QUITADO";
      patch.saldoDevedor = 0;
      patch.saldo = 0;
      patch.valorPago = valor > 0 ? valor : undefined;
    } else {
      patch.quitadoEm = undefined;
      patch.quitado = false;
      patch.statusPagamento = undefined;
    }

    persistUnidade(patch);
    setOpenEdit(false);
  }

  function abrirProcessamentoNaUnidade() {
    if (!quadro) return;
    if (!editUnidadeId) return;

    saveJson(STORAGE_PROCESSAMENTO_TARGET, {
      empresaId: quadro.empresaId,
      obraId: quadro.obraId,
      unidadeId: pad4(editUnidadeId),
      from: "gestao",
      at: new Date().toISOString(),
    });

    router.push("/processamento");
  }

  function registrarDistrato() {
    if (!isMaster) return alert("Somente Master pode distratar.");
    if (!quadro) return;

    const id = pad4(editUnidadeId);

    const nome = compradorNome.trim();
    const dataNorm = normalizeVendaDateAny(dataVenda);
    const valor = Number(parseMoneyInput(valorVenda).toFixed(2));

    const isVendida = !!nome || !!dataNorm || valor > 0;
    if (!isVendida) return alert("Essa unidade está disponível. Não faz sentido distratar.");

    if (!confirm(`Registrar distrato da unidade ${id}?\n\nIsso vai guardar o histórico e limpar a venda (volta a disponível).`)) return;

    const now = new Date().toISOString();
    const d: Distrato = {
      id: uuid(),
      empresaId: quadro.empresaId,
      obraId: quadro.obraId,
      unidadeId: id,
      compradorNome: nome,
      valorVenda: valor,
      dataVenda: dataNorm,
      dataDistrato: now,
      criadoEm: now,
    };

    const all = loadJson<Distrato[]>(STORAGE_DISTRATOS, []);
    all.push(d);
    saveJson(STORAGE_DISTRATOS, all);

    persistUnidade({
      compradorNome: "",
      cpfCnpjDigits: "",
      dataVenda: "",
      valorVenda: 0,
      quitadoEm: undefined,
      quitado: false,
      statusPagamento: undefined,
      statusVenda: undefined,
      status: undefined,
      valorPago: undefined,
      saldoDevedor: undefined,
      saldo: undefined,
    });

    setOpenEdit(false);
    setOpenDistratos(true);
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

  const statusBadge = (st: Status) => {
    const bg = st === "QUITADO" ? "#e7f7ef" : st === "VENDIDO" ? "#e7f2ff" : "#ffffff";
    const border = st === "QUITADO" ? "#bfe6d0" : st === "VENDIDO" ? "#bcd6ff" : "#e5e5e5";
    const label = st === "QUITADO" ? "Quitado" : st === "VENDIDO" ? "Vendido" : "Disponível";
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "3px 10px",
          borderRadius: 999,
          border: `1px solid ${border}`,
          background: bg,
          fontSize: 12,
          fontWeight: 900,
        }}
      >
        {label}
      </span>
    );
  };

  const resumoFormaPagamento = useMemo(() => {
    if (!quadro || !editUnidadeId) return null;

    const list = editParcelas.slice();
    if (!list.length) return { has: false, msg: "Nenhuma parcela prevista cadastrada para esta unidade." } as const;

    const porTipo: Record<string, { qtd: number; total: number }> = {};
    for (const p of list) {
      const k = p.tipo;
      if (!porTipo[k]) porTipo[k] = { qtd: 0, total: 0 };
      porTipo[k].qtd += 1;
      porTipo[k].total += Number(p.valorPrevisto || 0);
    }
    const total = list.reduce((s, p) => s + Number(p.valorPrevisto || 0), 0);
    const prox = list.slice().sort((a, b) => sortDateBR(a.vencimento, b.vencimento))[0]?.vencimento ?? "";

    return { has: true, porTipo, total, prox } as const;
  }, [editParcelas, quadro, editUnidadeId]);

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
        .th{background:#fafafa;text-align:left;padding:10px;font-weight:900;border-bottom:1px solid #eee}
        .td{padding:10px;border-bottom:1px solid #eee}
        .nowrap{white-space:nowrap}
        .modalOverlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:grid;place-items:center;padding:18px;z-index:50}
        .modal{width:min(1100px,98vw);max-height:92vh;overflow:auto;background:white;border-radius:14px;padding:14px;box-shadow:0 20px 60px rgba(0,0,0,.35)}
        .kpi{display:grid;gap:6px;border:1px solid #eee;border-radius:12px;padding:10px;background:#fafafa;min-width:170px}
        .kpi b{font-size:18px;color:#222}
        .cost{font-size:12px;color:#555;font-weight:700}
        .cost strong{color:#222}
        .chip{display:inline-flex;gap:8px;align-items:center;padding:6px 10px;border-radius:999px;border:1px solid #ddd;background:#fff;font-weight:900;font-size:12px}
        .linkBtn{border:1px solid #ddd;background:white;padding:6px 10px;border-radius:10px;cursor:pointer;font-weight:900}
        .input{width:100%;padding:10px;border-radius:10px;border:1px solid #ccc}
      `}</style>

      <div style={{ maxWidth: 1500, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, color: "#333" }}>Controle de Vendas</h1>
            <div className="mini" style={{ marginTop: 6 }}>
              Usuário: <b>{session.username}</b> ({session.role})
            </div>
            <div style={{ color: "#444", marginTop: 6 }}>
              Empresa: <b>{empresaAtual ? `${empresaAtual.id} — ${empresaAtual.razaoSocial}` : "(selecione)"}</b> | Obra:{" "}
              <b>{obraAtual ? `${obraAtual.id} — ${obraAtual.nome}` : "(selecione)"}</b>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button style={btn} onClick={() => router.push("/dashboard")}>Voltar</button>
            <button style={btn} onClick={() => router.push("/custos")}>Quadro de Custos</button>
            <button
              style={!empresaSel || !obraSel ? { ...btn, opacity: 0.55, cursor: "not-allowed" } : btn}
              disabled={!empresaSel || !obraSel}
              onClick={() => setOpenDistratos(true)}
            >
              Distratos
            </button>
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
            <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>Resumo</h2>
            {!quadro ? (
              <div className="mini" style={{ marginTop: 10 }}>
                Processe o <b>Quadro de Custos</b> primeiro para esta obra.
              </div>
            ) : (
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div className="kpi"><div className="mini">Unidades</div><b>{resumo.total}</b></div>
                <div className="kpi"><div className="mini">Vendidas</div><b>{resumo.vendidas}</b></div>
                <div className="kpi"><div className="mini">Quitadas</div><b>{resumo.quitadas}</b></div>
                <div className="kpi"><div className="mini">Disponíveis</div><b>{resumo.disponiveis}</b></div>
                <div className="kpi" style={{ minWidth: 220 }}><div className="mini">Total vendido</div><b>{moneyBR(resumo.totalVendido)}</b></div>
              </div>
            )}
            {quadro && (
              <div className="mini" style={{ marginTop: 10 }}>
                Quitadas (Processamento detectadas): <b>{quitadasDoProcessamento.size}</b>
              </div>
            )}
          </section>
        </div>

        <section style={{ ...card, marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>Unidades (todas)</h2>
            <div className="mini">Cores leves por status: Disponível (branco), Vendido (azul claro), Quitado (verde claro).</div>
          </div>

          {!quadro ? (
            <div className="mini" style={{ marginTop: 10 }}>
              Selecione Empresa/Obra e processe o <b>Quadro de Custos</b>.
            </div>
          ) : (
            <div style={{ marginTop: 12, overflow: "auto", border: "1px solid #eee", borderRadius: 12 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th className="th nowrap">Unidade</th>
                    <th className="th nowrap">Status</th>
                    <th className="th nowrap">Comprador</th>
                    <th className="th nowrap" style={{ textAlign: "right" }}>Valor venda</th>
                    <th className="th nowrap">Data venda</th>

                    <th className="th nowrap" style={{ textAlign: "right" }}>Terr.</th>
                    <th className="th nowrap" style={{ textAlign: "right" }}>Mensal</th>
                    <th className="th nowrap" style={{ textAlign: "right" }}>Total</th>
                    <th className="th nowrap" style={{ textAlign: "right" }}>Res.</th>

                    <th className="th nowrap">Ações</th>
                  </tr>
                </thead>

                <tbody>
                  {listaBase.map((u) => {
                    const custo = custosPorUnidade.get(u.unidadeId) || { terreno: 0, meses: 0, total: 0 };
                    const resultado = (u.valorVenda || 0) - (custo.total || 0);

                    const isQuitado = !!u.quitadoFinal || u.statusCalc === "QUITADO";
                    const isVendido =
                      u.statusCalc === "VENDIDO" || (u.valorVenda || 0) > 0 || !!u.dataVenda || !!u.compradorNome;

                    const rowBg = isQuitado ? "#eefbf3" : isVendido ? "#eef6ff" : "#ffffff";

                    return (
                      <tr key={u.unidadeId} style={{ background: rowBg }}>
                        <td className="td nowrap" style={{ fontWeight: 900 }}>{u.unidadeId}</td>
                        <td className="td nowrap">{statusBadge(u.quitadoFinal ? "QUITADO" : u.statusCalc)}</td>
                        <td className="td nowrap">{u.compradorNome ? <b>{u.compradorNome}</b> : <span className="mini">—</span>}</td>
                        <td className="td nowrap" style={{ textAlign: "right", fontWeight: 900 }}>
                          {u.valorVenda > 0 ? moneyBR(u.valorVenda) : <span className="mini">—</span>}
                        </td>
                        <td className="td nowrap">{u.dataVenda ? <b>{u.dataVenda}</b> : <span className="mini">—</span>}</td>

                        <td className="td nowrap cost" style={{ textAlign: "right" }}><strong>{moneyBR(custo.terreno)}</strong></td>
                        <td className="td nowrap cost" style={{ textAlign: "right" }}><strong>{moneyBR(custo.meses)}</strong></td>
                        <td className="td nowrap cost" style={{ textAlign: "right" }}><strong>{moneyBR(custo.total)}</strong></td>
                        <td className="td nowrap cost" style={{ textAlign: "right" }}>
                          {u.valorVenda > 0 ? <strong>{moneyBR(resultado)}</strong> : <span className="mini">—</span>}
                        </td>

                        <td className="td nowrap">
                          <button
                            style={!isMaster ? { ...btn, opacity: 0.55, cursor: "not-allowed" } : btn}
                            disabled={!isMaster}
                            onClick={() => abrirEditar(u.unidadeId)}
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                <tfoot>
                  <tr style={{ background: "#fafafa", fontWeight: 900 }}>
                    <td className="td nowrap" colSpan={3}>Totais</td>
                    <td className="td nowrap" style={{ textAlign: "right" }}>
                      {moneyBR(listaBase.reduce((s, x) => s + Number(x.valorVenda || 0), 0))}
                    </td>
                    <td className="td nowrap"></td>

                    <td className="td nowrap cost" style={{ textAlign: "right" }}><strong>{moneyBR(quadro.valorTerreno)}</strong></td>
                    <td className="td nowrap cost" style={{ textAlign: "right" }}><strong>{moneyBR((quadro.custosMensais || []).reduce((s, m) => s + Number(m.valor || 0), 0))}</strong></td>
                    <td className="td nowrap cost" style={{ textAlign: "right" }}>
                      <strong>{moneyBR(Number(quadro.valorTerreno || 0) + (quadro.custosMensais || []).reduce((s, m) => s + Number(m.valor || 0), 0))}</strong>
                    </td>
                    <td className="td nowrap cost" style={{ textAlign: "right" }}><span className="mini">—</span></td>

                    <td className="td nowrap"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* MODAL EDITAR */}
      {openEdit && (
        <div className="modalOverlay" onMouseDown={() => setOpenEdit(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 900, fontSize: 16, color: "#333" }}>Editar venda — Unidade {editUnidadeId}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={btn} onClick={() => setOpenEdit(false)}>Fechar</button>
                <button style={dangerBtn} onClick={limparVenda}>Limpar</button>
                <button style={dangerBtn} onClick={registrarDistrato}>Distratar</button>
                <button style={primaryBtn} onClick={salvarVenda}>Salvar</button>
              </div>
            </div>

            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
              <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, background: "#fafafa" }}>
                <div className="mini">Comprador</div>
                <input
                  className="input"
                  value={compradorNome}
                  onChange={(e) => setCompradorNome(e.target.value)}
                  placeholder="Nome do comprador"
                  style={{ marginTop: 6 }}
                />

                <div className="mini" style={{ marginTop: 12 }}>Documento</div>

                <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 900, color: "#333" }}>
                    <input type="radio" checked={docTipo === "CPF"} onChange={() => setDocTipoSafe("CPF")} />
                    CPF
                  </label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 900, color: "#333" }}>
                    <input type="radio" checked={docTipo === "CNPJ"} onChange={() => setDocTipoSafe("CNPJ")} />
                    CNPJ
                  </label>
                </div>

                <input
                  className="input"
                  style={{
                    marginTop: 8,
                    border: docErro ? "1px solid #b00020" : "1px solid #ccc",
                    background: "#fff",
                  }}
                  value={docInput}
                  onChange={(e) => onChangeDoc(e.target.value)}
                  placeholder={docTipo === "CPF" ? "000.000.000-00" : "00.000.000/0000-00"}
                />

                {docErro ? (
                  <div style={{ marginTop: 6, color: "#b00020", fontSize: 13, fontWeight: 900 }}>{docErro}</div>
                ) : (
                  <div className="mini" style={{ marginTop: 6 }}>
                    {onlyDigits(docInput) ? `OK (${docTipo})` : `Digite o ${docTipo} com máscara automática.`}
                  </div>
                )}

                <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div className="mini">Data venda (dd/mm/aaaa)</div>
                    <input
                      className="input"
                      style={{ marginTop: 6 }}
                      value={dateTypingMask(dataVenda)}
                      onChange={(e) => setDataVenda(e.target.value)}
                      onBlur={(e) => setDataVenda(dateNormalizeOnBlur(e.target.value))}
                      placeholder="ex.: 01/01/25"
                    />
                  </div>
                  <div>
                    <div className="mini">Valor venda (R$)</div>
                    <input
                      className="input"
                      style={{ marginTop: 6 }}
                      value={valorVenda}
                      onChange={(e) => setValorVenda(e.target.value)}
                      placeholder="ex.: 350.000,00"
                    />
                  </div>
                </div>

                <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, fontWeight: 900, color: "#333" }}>
                  <input type="checkbox" checked={quitadoCheck} onChange={(e) => setQuitadoCheck(e.target.checked)} />
                  Quitado
                </label>

                <div className="mini" style={{ marginTop: 6 }}>
                  Obs.: mesmo que o quitado venha do Processamento, aqui você pode marcar manualmente se quiser.
                </div>

                {/* ======= Forma de Pagamento (mantida) ======= */}
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e5e5e5" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                    <div style={{ fontWeight: 900, color: "#333" }}>Forma de Pagamento (Processar → Previsão)</div>
                    <button
                      className="linkBtn"
                      onClick={abrirProcessamentoNaUnidade}
                      title="Atalho: abre o Processamento já na unidade"
                    >
                      Ir para Processamento (atalho)
                    </button>
                  </div>

                  <div className="mini" style={{ marginTop: 6 }}>
                    1) Monte as linhas (Tipo + Data + <b>Quantidade</b> + Valor). 2) Clique <b>Processar Forma</b>.
                    3) Se bater com a venda, o quadro de parcelas (abaixo) será gerado. 4) Clique <b>Salvar forma de pagamento</b>.
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span className="chip">Valor da venda: <b>{moneyBR(Number(parseMoneyInput(valorVenda).toFixed(2)))}</b></span>
                    <span className="chip">
                      Parcial previsto (forma):{" "}
                      <b style={{ color: Math.abs(totalFormaParcial - Number(parseMoneyInput(valorVenda).toFixed(2))) > 0.01 ? "#b00020" : "#2b7a3d" }}>
                        {moneyBR(totalFormaParcial)}
                      </b>
                    </span>
                    <span className="chip">
                      Diferença:{" "}
                      <b style={{ color: Math.abs(totalFormaParcial - Number(parseMoneyInput(valorVenda).toFixed(2))) > 0.01 ? "#b00020" : "#2b7a3d" }}>
                        {moneyBR(Number((totalFormaParcial - Number(parseMoneyInput(valorVenda).toFixed(2))).toFixed(2)))}
                      </b>
                    </span>
                  </div>

                  <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 12, padding: 10, background: "#fff" }}>
                    <div style={{ fontWeight: 900, color: "#333" }}>Forma de pagamento (linhas para processar)</div>

                    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 0.7fr 1fr auto", gap: 10 }}>
                      <div>
                        <div className="mini">Tipo</div>
                        <select
                          className="input"
                          value={fpTipo}
                          onChange={(e) => setFpTipo(e.target.value as TipoPagamento)}
                          disabled={!isMaster}
                          style={{ marginTop: 6 }}
                        >
                          {TIPOS.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <div className="mini">Data 1ª parcela (dd/mm/aaaa)</div>
                        <input
                          className="input"
                          value={dateTypingMask(fpVenc)}
                          onChange={(e) => setFpVenc(e.target.value)}
                          onBlur={(e) => setFpVenc(dateNormalizeOnBlur(e.target.value))}
                          placeholder="01/01/25"
                          disabled={!isMaster}
                          style={{ marginTop: 6 }}
                        />
                      </div>

                      <div>
                        <div className="mini">Quantidade</div>
                        <input
                          className="input"
                          value={fpQtd}
                          onChange={(e) => setFpQtd(onlyDigits(e.target.value).slice(0, 4))}
                          placeholder="ex.: 12"
                          disabled={!isMaster}
                          style={{ marginTop: 6, textAlign: "right" }}
                        />
                      </div>

                      <div>
                        <div className="mini">Valor da parcela (R$)</div>
                        <input
                          className="input"
                          value={fpValor}
                          onChange={(e) => setFpValor(e.target.value)}
                          placeholder="ex.: 2.000,00"
                          disabled={!isMaster}
                          style={{ marginTop: 6 }}
                        />
                      </div>

                      <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
                        <button
                          style={isMaster ? primaryBtn : { ...primaryBtn, opacity: 0.55, cursor: "not-allowed" }}
                          disabled={!isMaster}
                          onClick={incluirItemForma}
                        >
                          Adicionar
                        </button>
                      </div>
                    </div>

                    <div style={{ marginTop: 10, overflow: "auto", border: "1px solid #eee", borderRadius: 12 }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th className="th nowrap">Tipo</th>
                            <th className="th nowrap">1ª Data</th>
                            <th className="th nowrap" style={{ textAlign: "right" }}>Qtd</th>
                            <th className="th nowrap" style={{ textAlign: "right" }}>Valor</th>
                            <th className="th nowrap" style={{ textAlign: "right" }}>Total</th>
                            <th className="th nowrap">Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fpItens.length === 0 ? (
                            <tr>
                              <td className="td" colSpan={6}>
                                <span className="mini">Nenhuma linha adicionada ainda.</span>
                              </td>
                            </tr>
                          ) : (
                            fpItens.map((it) => {
                              const q = Number(onlyDigits(it.quantidade)) || 0;
                              const v = parseMoneyInput(it.valor);
                              const tot = Number((q * v).toFixed(2));
                              return (
                                <tr key={it.id}>
                                  <td className="td nowrap"><b>{it.tipo}</b></td>
                                  <td className="td nowrap">{it.dataPrimeira}</td>
                                  <td className="td nowrap" style={{ textAlign: "right" }}>{q}</td>
                                  <td className="td nowrap" style={{ textAlign: "right" }}>{moneyBR(v)}</td>
                                  <td className="td nowrap" style={{ textAlign: "right", fontWeight: 900 }}>{moneyBR(tot)}</td>
                                  <td className="td nowrap">
                                    <button
                                      style={isMaster ? dangerBtn : { ...dangerBtn, opacity: 0.55, cursor: "not-allowed" }}
                                      disabled={!isMaster}
                                      onClick={() => removerItemForma(it.id)}
                                    >
                                      Excluir
                                    </button>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: "#fafafa", fontWeight: 900 }}>
                            <td className="td" colSpan={4}>Total parcial</td>
                            <td className="td" style={{ textAlign: "right" }}>{moneyBR(totalFormaParcial)}</td>
                            <td className="td"></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button
                        style={isMaster ? btn : { ...btn, opacity: 0.55, cursor: "not-allowed" }}
                        disabled={!isMaster}
                        onClick={() => setFpItens([])}
                      >
                        Limpar linhas
                      </button>

                      <button
                        style={isMaster ? primaryBtn : { ...primaryBtn, opacity: 0.55, cursor: "not-allowed" }}
                        disabled={!isMaster}
                        onClick={processarFormaPagamento}
                      >
                        Processar Forma
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {!resumoFormaPagamento ? null : !resumoFormaPagamento.has ? (
                      <span className="chip" style={{ color: "#8a0000", borderColor: "#f0c0c0", background: "#fff5f5" }}>
                        {resumoFormaPagamento.msg}
                      </span>
                    ) : (
                      <>
                        <span className="chip">Próximo venc.: <b>{resumoFormaPagamento.prox || "—"}</b></span>
                        <span className="chip">Total previsto: <b>{moneyBR(resumoFormaPagamento.total)}</b></span>
                        {Object.keys(resumoFormaPagamento.porTipo).map((k) => (
                          <span key={k} className="chip">
                            {k}: <b>{resumoFormaPagamento.porTipo[k].qtd}</b> ({moneyBR(resumoFormaPagamento.porTipo[k].total)})
                          </span>
                        ))}
                      </>
                    )}
                  </div>

                  <div style={{ marginTop: 12, overflow: "auto", border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th className="th nowrap">Vencimento</th>
                          <th className="th nowrap">Tipo</th>
                          <th className="th nowrap" style={{ textAlign: "right" }}>Valor previsto</th>
                          <th className="th nowrap">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editParcelas.length === 0 ? (
                          <tr>
                            <td className="td" colSpan={4}>
                              <span className="mini">Nenhuma parcela prevista cadastrada.</span>
                            </td>
                          </tr>
                        ) : (
                          editParcelas.map((p) => (
                            <tr key={p.id}>
                              <td className="td nowrap" style={{ width: 170 }}>
                                <input
                                  className="input"
                                  value={dateTypingMask(p.vencimento)}
                                  disabled={!isMaster}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setEditParcelas((prev) => prev.map((x) => (x.id === p.id ? { ...x, vencimento: v } : x)));
                                  }}
                                  onBlur={(e) => {
                                    const v = dateNormalizeOnBlur(e.target.value);
                                    setEditParcelas((prev) =>
                                      prev
                                        .map((x) => (x.id === p.id ? { ...x, vencimento: v } : x))
                                        .sort((a, b) => sortDateBR(a.vencimento, b.vencimento))
                                    );
                                  }}
                                />
                              </td>

                              <td className="td nowrap" style={{ width: 220 }}>
                                <select
                                  className="input"
                                  value={p.tipo}
                                  disabled={!isMaster}
                                  onChange={(e) => {
                                    const t = e.target.value as TipoPagamento;
                                    setEditParcelas((prev) => prev.map((x) => (x.id === p.id ? { ...x, tipo: t } : x)));
                                  }}
                                >
                                  {TIPOS.map((t) => (
                                    <option key={t} value={t}>{t}</option>
                                  ))}
                                </select>
                              </td>

                              <td className="td nowrap" style={{ textAlign: "right", width: 200 }}>
                                <input
                                  className="input"
                                  value={Number(p.valorPrevisto || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  disabled={!isMaster}
                                  onChange={(e) => {
                                    const val = parseMoneyInput(e.target.value);
                                    setEditParcelas((prev) => prev.map((x) => (x.id === p.id ? { ...x, valorPrevisto: val } : x)));
                                  }}
                                />
                              </td>

                              <td className="td nowrap" style={{ width: 120 }}>
                                <button
                                  style={isMaster ? dangerBtn : { ...dangerBtn, opacity: 0.55, cursor: "not-allowed" }}
                                  disabled={!isMaster}
                                  onClick={() => removerParcela(p.id)}
                                >
                                  Excluir
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: "#fafafa", fontWeight: 900 }}>
                          <td className="td" colSpan={2}>Total</td>
                          <td className="td" style={{ textAlign: "right" }}>
                            {moneyBR(editParcelas.reduce((s, x) => s + Number(x.valorPrevisto || 0), 0))}
                          </td>
                          <td className="td"></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button
                      style={isMaster ? primaryBtn : { ...primaryBtn, opacity: 0.55, cursor: "not-allowed" }}
                      disabled={!isMaster}
                      onClick={salvarParcelasPrevistasDaUnidade}
                    >
                      Salvar forma de pagamento
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, background: "#fff" }}>
                <div style={{ fontWeight: 900, color: "#333" }}>Custos (discreto)</div>
                {quadro ? (
                  (() => {
                    const c = custosPorUnidade.get(editUnidadeId) || { terreno: 0, meses: 0, total: 0 };
                    const venda = Number(parseMoneyInput(valorVenda).toFixed(2));
                    const res = venda - c.total;

                    return (
                      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10, background: "#fafafa" }}>
                          <div className="mini">Terreno</div><b style={{ fontSize: 18 }}>{moneyBR(c.terreno)}</b>
                        </div>
                        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10, background: "#fafafa" }}>
                          <div className="mini">Mensal</div><b style={{ fontSize: 18 }}>{moneyBR(c.meses)}</b>
                        </div>
                        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10, background: "#fafafa" }}>
                          <div className="mini">Total</div><b style={{ fontSize: 18 }}>{moneyBR(c.total)}</b>
                        </div>
                        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10, background: "#fafafa" }}>
                          <div className="mini">Resultado</div><b style={{ fontSize: 18 }}>{venda > 0 ? moneyBR(res) : "—"}</b>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div className="mini" style={{ marginTop: 10 }}>Sem quadro.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DISTRATOS */}
      {openDistratos && (
        <div className="modalOverlay" onMouseDown={() => setOpenDistratos(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 900, fontSize: 16, color: "#333" }}>
                Distratos — {empresaAtual?.id}/{obraAtual?.id}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={btn} onClick={() => setOpenDistratos(false)}>Fechar</button>
              </div>
            </div>

            <div className="mini" style={{ marginTop: 8 }}>
              Lista das unidades distratadas (histórico).
            </div>

            <div style={{ marginTop: 12, overflow: "auto", border: "1px solid #eee", borderRadius: 12 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th className="th nowrap">Unidade</th>
                    <th className="th nowrap">Comprador</th>
                    <th className="th nowrap" style={{ textAlign: "right" }}>Valor venda</th>
                    <th className="th nowrap">Data venda</th>
                    <th className="th nowrap">Data distrato</th>
                  </tr>
                </thead>
                <tbody>
                  {distratosDaObra.length === 0 ? (
                    <tr>
                      <td className="td" colSpan={5}>
                        <span className="mini">Nenhum distrato registrado nesta obra.</span>
                      </td>
                    </tr>
                  ) : (
                    distratosDaObra
                      .slice()
                      .sort((a, b) => compareUnidade(a.unidadeId, b.unidadeId))
                      .map((d) => (
                        <tr key={d.id} style={{ background: "#fff7e6" }}>
                          <td className="td nowrap" style={{ fontWeight: 900 }}>{d.unidadeId}</td>
                          <td className="td nowrap"><b>{d.compradorNome || "—"}</b></td>
                          <td className="td nowrap" style={{ textAlign: "right", fontWeight: 900 }}>{d.valorVenda > 0 ? moneyBR(d.valorVenda) : "—"}</td>
                          <td className="td nowrap">{d.dataVenda || "—"}</td>
                          <td className="td nowrap">{new Date(d.dataDistrato).toLocaleString("pt-BR")}</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
