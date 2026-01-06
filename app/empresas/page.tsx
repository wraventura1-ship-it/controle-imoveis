"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Session = {
  username: string;
  role: "MASTER" | "USER";
};

type Empresa = {
  id: string; // 4 dígitos
  cnpjDigits: string; // 14 dígitos (obrigatório)
  grupo?: string; // 4 dígitos (opcional)

  razaoSocial: string; // obrigatório

  // Endereço (padrão Receita) - pode ficar incompleto
  logradouro: string;
  numero: string;
  complemento: string;
  cepDigits: string; // 8 dígitos
  bairro: string;
  municipio: string;
  uf: string; // 2 letras

  // Atividade principal - pode ficar incompleto
  cnaeDigits: string; // 7 dígitos => máscara xx.xx-x-xx
  atividadeDescricao: string;

  // Natureza Jurídica - pode ficar incompleto
  naturezaCodigoDigits: string; // 4 dígitos => máscara xxx-x
  naturezaDescricao: string;

  // Responsável - pode ficar incompleto
  responsavelNome: string;
  responsavelCpfDigits: string; // 11 dígitos

  criadoEm: string;
  atualizadoEm?: string;
};

const STORAGE_EMPRESAS = "ci_empresas";
const STORAGE_OBRAS = "ci_obras";

function onlyDigits(v: string | undefined | null) {
  return String(v ?? "").replace(/\D/g, "");
}

function pad4(v: string | undefined | null) {
  const d = onlyDigits(v).slice(0, 4);
  return d.padStart(4, "0");
}

function maskCnpj(digits14: string | undefined | null) {
  const d = onlyDigits(digits14).slice(0, 14);
  const p1 = d.slice(0, 2);
  const p2 = d.slice(2, 5);
  const p3 = d.slice(5, 8);
  const p4 = d.slice(8, 12);
  const p5 = d.slice(12, 14);

  let out = "";
  if (p1) out += p1;
  if (p2) out += (out.length ? "." : "") + p2;
  if (p3) out += "." + p3;
  if (p4) out += "/" + p4;
  if (p5) out += "-" + p5;
  return out;
}

function maskCpf(digits11: string | undefined | null) {
  const d = onlyDigits(digits11).slice(0, 11);
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

function maskCep(digits8: string | undefined | null) {
  const d = onlyDigits(digits8).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5, 8)}`;
}

// CNAE: xx.xx-x-xx (7 dígitos)
function maskCnae(digits7: string | undefined | null) {
  const d = onlyDigits(digits7).slice(0, 7);
  const p1 = d.slice(0, 2);
  const p2 = d.slice(2, 4);
  const p3 = d.slice(4, 5);
  const p4 = d.slice(5, 7);

  let out = "";
  if (p1) out += p1;
  if (p2) out += "." + p2;
  if (p3) out += "-" + p3;
  if (p4) out += "-" + p4;
  return out;
}

// Natureza Jurídica: xxx-x (4 dígitos)
function maskNatureza(digits4: string | undefined | null) {
  const d = onlyDigits(digits4).slice(0, 4);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 4);
  if (!p2) return p1;
  return `${p1}-${p2}`;
}

/** CPF válido */
function isCpfValid(cpf: string | undefined | null) {
  const d = onlyDigits(cpf);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(d[i]) * (10 - i);
  let dv1 = (sum * 10) % 11;
  if (dv1 === 10) dv1 = 0;
  if (dv1 !== parseInt(d[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(d[i]) * (11 - i);
  let dv2 = (sum * 10) % 11;
  if (dv2 === 10) dv2 = 0;
  if (dv2 !== parseInt(d[10])) return false;

  return true;
}

/** CNPJ válido */
function isCnpjValid(cnpj: string | undefined | null) {
  const d = onlyDigits(cnpj);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const calc = (base: string) => {
    const weights =
      base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += parseInt(base[i]) * weights[i];
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const dv1 = calc(d.slice(0, 12));
  if (dv1 !== parseInt(d[12])) return false;

  const dv2 = calc(d.slice(0, 13));
  if (dv2 !== parseInt(d[13])) return false;

  return true;
}

function loadEmpresas(): Empresa[] {
  const raw = localStorage.getItem(STORAGE_EMPRESAS);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as any[];
    return arr.map((x) => ({
      id: pad4(x?.id),
      cnpjDigits: onlyDigits(x?.cnpjDigits),
      grupo: onlyDigits(x?.grupo) ? pad4(x?.grupo) : undefined,
      razaoSocial: String(x?.razaoSocial ?? ""),

      logradouro: String(x?.logradouro ?? ""),
      numero: String(x?.numero ?? ""),
      complemento: String(x?.complemento ?? ""),
      cepDigits: onlyDigits(x?.cepDigits),
      bairro: String(x?.bairro ?? ""),
      municipio: String(x?.municipio ?? ""),
      uf: String(x?.uf ?? ""),

      cnaeDigits: onlyDigits(x?.cnaeDigits),
      atividadeDescricao: String(x?.atividadeDescricao ?? ""),

      naturezaCodigoDigits: onlyDigits(x?.naturezaCodigoDigits),
      naturezaDescricao: String(x?.naturezaDescricao ?? ""),

      responsavelNome: String(x?.responsavelNome ?? ""),
      responsavelCpfDigits: onlyDigits(x?.responsavelCpfDigits),

      criadoEm: String(x?.criadoEm ?? new Date().toISOString()),
      atualizadoEm: x?.atualizadoEm ? String(x.atualizadoEm) : undefined,
    })) as Empresa[];
  } catch {
    return [];
  }
}

function saveEmpresas(empresas: Empresa[]) {
  localStorage.setItem(STORAGE_EMPRESAS, JSON.stringify(empresas));
}

function empresaTemObras(empresaId4: string): boolean {
  const raw = localStorage.getItem(STORAGE_OBRAS);
  if (!raw) return false;
  try {
    const obras = JSON.parse(raw) as Array<{ empresaId: string }>;
    return obras.some((o) => o.empresaId === empresaId4);
  } catch {
    return false;
  }
}

/** Pendências para marcar como INCOMPLETO (exceto ID, CNPJ e Nome — que são obrigatórios sempre). */
function pendenciasEmpresa(e: Empresa): string[] {
  const p: string[] = [];

  // Endereço completo (opcional, mas se faltar marca pendência)
  if (!e.logradouro?.trim()) p.push("Logradouro");
  if (!e.numero?.trim()) p.push("Número (endereço)");
  if (onlyDigits(e.cepDigits).length !== 8) p.push("CEP");
  if (!e.bairro?.trim()) p.push("Bairro/Distrito");
  if (!e.municipio?.trim()) p.push("Município");
  if (!e.uf?.trim() || e.uf.trim().length !== 2) p.push("UF");

  // Atividade
  if (onlyDigits(e.cnaeDigits).length !== 7) p.push("CNAE");
  if (!e.atividadeDescricao?.trim()) p.push("Descrição CNAE");

  // Natureza
  if (onlyDigits(e.naturezaCodigoDigits).length !== 4) p.push("Natureza Jurídica (código)");
  if (!e.naturezaDescricao?.trim()) p.push("Natureza Jurídica (descrição)");

  // Responsável
  if (!e.responsavelNome?.trim()) p.push("Nome do Responsável");
  if (!isCpfValid(e.responsavelCpfDigits)) p.push("CPF do Responsável");

  return p;
}

export default function EmpresasPage() {
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [modo, setModo] = useState<"LISTA" | "NOVO" | "EDITAR">("LISTA");
  const [editandoId, setEditandoId] = useState<string | null>(null);

  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [carregandoReceita, setCarregandoReceita] = useState(false);

  // Formulário
  const [id, setId] = useState("");
  const [cnpjDigits, setCnpjDigits] = useState("");
  const [grupo, setGrupo] = useState("");
  const [razaoSocial, setRazaoSocial] = useState("");

  const [logradouro, setLogradouro] = useState("");
  const [numero, setNumero] = useState("");
  const [complemento, setComplemento] = useState("");
  const [cepDigits, setCepDigits] = useState("");
  const [bairro, setBairro] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [uf, setUf] = useState("");

  const [cnaeDigits, setCnaeDigits] = useState("");
  const [atividadeDescricao, setAtividadeDescricao] = useState("");

  const [naturezaCodigoDigits, setNaturezaCodigoDigits] = useState("");
  const [naturezaDescricao, setNaturezaDescricao] = useState("");

  const [responsavelNome, setResponsavelNome] = useState("");
  const [responsavelCpfDigits, setResponsavelCpfDigits] = useState("");

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
    setEmpresas(loadEmpresas());
  }, []);

  const isMaster = session?.role === "MASTER";

  const listaOrdenada = useMemo(() => {
    return [...empresas].sort((a, b) => a.id.localeCompare(b.id));
  }, [empresas]);

  function limparFormulario() {
    setId("");
    setCnpjDigits("");
    setGrupo("");
    setRazaoSocial("");

    setLogradouro("");
    setNumero("");
    setComplemento("");
    setCepDigits("");
    setBairro("");
    setMunicipio("");
    setUf("");

    setCnaeDigits("");
    setAtividadeDescricao("");

    setNaturezaCodigoDigits("");
    setNaturezaDescricao("");

    setResponsavelNome("");
    setResponsavelCpfDigits("");
  }

  function abrirNovo() {
    setErro(null);
    setInfo(null);
    setEditandoId(null);
    limparFormulario();
    setModo("NOVO");
  }

  function abrirEditar(e: Empresa) {
    setErro(null);
    setInfo(null);
    setModo("EDITAR");
    setEditandoId(e.id);

    setId(e.id);
    setCnpjDigits(e.cnpjDigits || "");
    setGrupo(e.grupo || "");
    setRazaoSocial(e.razaoSocial || "");

    setLogradouro(e.logradouro || "");
    setNumero(e.numero || "");
    setComplemento(e.complemento || "");
    setCepDigits(e.cepDigits || "");
    setBairro(e.bairro || "");
    setMunicipio(e.municipio || "");
    setUf(e.uf || "");

    setCnaeDigits(e.cnaeDigits || "");
    setAtividadeDescricao(e.atividadeDescricao || "");

    setNaturezaCodigoDigits(e.naturezaCodigoDigits || "");
    setNaturezaDescricao(e.naturezaDescricao || "");

    setResponsavelNome(e.responsavelNome || "");
    setResponsavelCpfDigits(e.responsavelCpfDigits || "");
  }

  function voltarLista() {
    setErro(null);
    setInfo(null);
    setEditandoId(null);
    limparFormulario();
    setModo("LISTA");
  }

  /** Regra: SEMPRE obrigatórios: número, CNPJ válido e nome. */
  function validarParaSalvar(acao: "NOVO" | "EDITAR"): string | null {
    const idFixed = pad4(id);
    if (idFixed.length !== 4) return "Número da Empresa deve ter 4 dígitos.";

    const nome = razaoSocial.trim();
    if (!nome) return "Nome/Razão Social é obrigatório.";

    const cnpj14 = onlyDigits(cnpjDigits);
    if (cnpj14.length !== 14) return "CNPJ é obrigatório (14 dígitos) para salvar.";
    if (!isCnpjValid(cnpj14)) return "CNPJ inválido. Corrija para salvar.";

    // grupo se preenchido, deve ter 4 dígitos
    const grupoD = onlyDigits(grupo);
    if (grupoD.length > 0 && grupoD.length !== 4) return "Grupo Empresarial (se preenchido) deve ter 4 dígitos.";

    // se CEP foi preenchido, deve ter 8 dígitos
    if (onlyDigits(cepDigits).length > 0 && onlyDigits(cepDigits).length !== 8) return "CEP inválido (8 dígitos).";

    // se UF foi preenchida, deve ter 2 letras
    if (uf.trim().length > 0 && uf.trim().length !== 2) return "UF inválida (2 letras).";

    // se CNAE foi preenchido, deve ter 7 dígitos
    if (onlyDigits(cnaeDigits).length > 0 && onlyDigits(cnaeDigits).length !== 7) return "CNAE inválido (7 dígitos).";

    // se Natureza foi preenchida, deve ter 4 dígitos
    if (onlyDigits(naturezaCodigoDigits).length > 0 && onlyDigits(naturezaCodigoDigits).length !== 4) {
      return "Natureza Jurídica inválida (código deve ter 4 dígitos).";
    }

    // se CPF foi preenchido, deve ser válido
    if (onlyDigits(responsavelCpfDigits).length > 0 && !isCpfValid(responsavelCpfDigits)) {
      return "CPF do responsável inválido. Corrija para salvar.";
    }

    // duplicidade de ID no NOVO
    if (acao === "NOVO" && empresas.some((e) => e.id === idFixed)) {
      return `Já existe uma empresa com o número ${idFixed}.`;
    }

    // não troca ID no EDITAR
    if (acao === "EDITAR" && editandoId && idFixed !== editandoId) {
      return "No modo Alterar, o Número da Empresa não pode ser trocado.";
    }

    return null;
  }

  function salvar() {
    setErro(null);
    setInfo(null);

    if (!isMaster) {
      setErro("Somente o usuário Master pode cadastrar/alterar empresas.");
      return;
    }

    const acao = modo === "EDITAR" ? "EDITAR" : "NOVO";
    const msg = validarParaSalvar(acao);
    if (msg) {
      setErro(msg);
      return;
    }

    const idFixed = pad4(id);

    const registro: Empresa = {
      id: idFixed,
      cnpjDigits: onlyDigits(cnpjDigits),
      grupo: onlyDigits(grupo) ? pad4(grupo) : undefined,
      razaoSocial: razaoSocial.trim(),

      logradouro: logradouro.trim(),
      numero: numero.trim(),
      complemento: complemento.trim(),
      cepDigits: onlyDigits(cepDigits),
      bairro: bairro.trim(),
      municipio: municipio.trim(),
      uf: uf.trim().toUpperCase(),

      cnaeDigits: onlyDigits(cnaeDigits),
      atividadeDescricao: atividadeDescricao.trim(),

      naturezaCodigoDigits: onlyDigits(naturezaCodigoDigits),
      naturezaDescricao: naturezaDescricao.trim(),

      responsavelNome: responsavelNome.trim(),
      responsavelCpfDigits: onlyDigits(responsavelCpfDigits),

      criadoEm:
        modo === "EDITAR"
          ? empresas.find((e) => e.id === idFixed)?.criadoEm ?? new Date().toISOString()
          : new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    };

    let novoArray: Empresa[];
    if (modo === "EDITAR") {
      novoArray = empresas.map((e) => (e.id === idFixed ? registro : e));
      setInfo("Empresa alterada com sucesso.");
    } else {
      novoArray = [...empresas, registro];
      setInfo("Empresa salva com sucesso.");
    }

    setEmpresas(novoArray);
    saveEmpresas(novoArray);

    setModo("LISTA");
    setEditandoId(null);
    limparFormulario();
  }

  function excluirEmpresa(idEmpresa: string) {
    setErro(null);
    setInfo(null);

    if (!isMaster) {
      setErro("Somente o usuário Master pode excluir empresas.");
      return;
    }

    if (empresaTemObras(idEmpresa)) {
      alert("Não é possível excluir: existem Obras cadastradas para esta empresa.");
      return;
    }

    const ok = confirm(`Confirma excluir a empresa ${idEmpresa}?`);
    if (!ok) return;

    const novoArray = empresas.filter((e) => e.id !== idEmpresa);
    setEmpresas(novoArray);
    saveEmpresas(novoArray);
    setInfo(`Empresa ${idEmpresa} excluída.`);
  }

  async function buscarNaReceita() {
    setErro(null);
    setInfo(null);

    const cnpj14 = onlyDigits(cnpjDigits);
    if (cnpj14.length === 0) {
      alert("Digite um CNPJ antes de consultar.");
      return;
    }
    if (!isCnpjValid(cnpj14)) {
      alert("CNPJ digitado está errado. Confira e digite novamente.");
      setCnpjDigits("");
      return;
    }

    setCarregandoReceita(true);
    try {
      const r = await fetch(`/api/cnpj?cnpj=${cnpj14}`, { cache: "no-store" });
      const data = await r.json();

      if (!r.ok) {
        setErro(data?.error || "Falha ao consultar CNPJ.");
        return;
      }

      setRazaoSocial(String(data?.razao_social ?? razaoSocial));
      setLogradouro(String(data?.logradouro ?? logradouro));
      setNumero(String(data?.numero ?? numero));
      setComplemento(String(data?.complemento ?? complemento));
      setCepDigits(onlyDigits(data?.cep ?? cepDigits));
      setBairro(String(data?.bairro ?? bairro));
      setMunicipio(String(data?.municipio ?? municipio));
      setUf(String(data?.uf ?? uf).toUpperCase());

      if (data?.cnae_fiscal) setCnaeDigits(onlyDigits(String(data.cnae_fiscal)));
      if (data?.cnae_fiscal_descricao) setAtividadeDescricao(String(data.cnae_fiscal_descricao));

      if (data?.codigo_natureza_juridica) setNaturezaCodigoDigits(onlyDigits(String(data.codigo_natureza_juridica)));
      if (data?.natureza_juridica) setNaturezaDescricao(String(data.natureza_juridica));

      setInfo("Dados carregados. Complete o que faltar e clique em Salvar.");
    } catch {
      setErro("Erro ao consultar a Receita. Tente novamente.");
    } finally {
      setCarregandoReceita(false);
    }
  }

  if (!session) {
    return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>Carregando...</main>;
  }

  const boxStyle: React.CSSProperties = {
    background: "white",
    borderRadius: "10px",
    padding: "18px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
  };

  return (
    <main style={{ minHeight: "100vh", backgroundColor: "#f2f2f2", padding: "24px" }}>
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "22px", color: "#333" }}>Cadastro de Empresas</h1>
            <p style={{ margin: "6px 0 0", color: "#666" }}>
              Usuário: <b>{session.username}</b> ({session.role})
            </p>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={() => router.push("/dashboard")}
              style={{ padding: "10px 14px", borderRadius: "6px", border: "1px solid #ddd", background: "white", cursor: "pointer" }}
            >
              Voltar
            </button>

            {isMaster && modo === "LISTA" && (
              <button
                onClick={abrirNovo}
                style={{ padding: "10px 14px", borderRadius: "6px", border: "none", background: "#0b4fd6", color: "white", cursor: "pointer" }}
              >
                Nova Empresa
              </button>
            )}
          </div>
        </div>

        {erro && (
          <div style={{ marginTop: "14px", backgroundColor: "#ffe6e6", border: "1px solid #ffb3b3", color: "#8a0000", padding: "10px", borderRadius: "6px", fontSize: "14px" }}>
            {erro}
          </div>
        )}
        {info && (
          <div style={{ marginTop: "14px", backgroundColor: "#e9f2ff", border: "1px solid #b7d2ff", color: "#0b2a66", padding: "10px", borderRadius: "6px", fontSize: "14px" }}>
            {info}
          </div>
        )}

        {modo === "LISTA" && (
          <div style={{ marginTop: "18px", ...boxStyle }}>
            <h2 style={{ marginTop: 0, fontSize: "18px", color: "#333" }}>Empresas cadastradas</h2>

            {listaOrdenada.length === 0 ? (
              <p style={{ color: "#666" }}>Nenhuma empresa cadastrada ainda.</p>
            ) : (
              <div style={{ display: "grid", gap: "10px" }}>
                {listaOrdenada.map((e, idx) => {
                  const pend = pendenciasEmpresa(e);
                  const incompleta = pend.length > 0;

                  return (
                    <div
                      key={e.id}
                      title={incompleta ? `Cadastro incompleto. Pendências: ${pend.join(", ")}` : ""}
                      style={{
                        padding: "12px",
                        borderRadius: "8px",
                        border: incompleta ? "2px solid #b00020" : "1px solid #eee",
                        background: incompleta ? "#fff5f6" : idx % 2 === 0 ? "#fafafa" : "white",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, color: "#333", display: "flex", alignItems: "center", gap: "10px" }}>
                          {e.id} — {e.razaoSocial}
                          {incompleta && (
                            <span style={{ fontSize: "12px", padding: "3px 8px", borderRadius: "999px", background: "#b00020", color: "white" }}>
                              INCOMPLETO
                            </span>
                          )}
                        </div>
                        <div style={{ color: "#666", fontSize: "14px", marginTop: "4px" }}>
                          CNPJ: {maskCnpj(e.cnpjDigits)} {e.grupo ? ` | Grupo: ${e.grupo}` : ""}
                        </div>
                        {incompleta && (
                          <div style={{ marginTop: "6px", color: "#8a0000", fontSize: "13px" }}>
                            Pendências: {pend.slice(0, 4).join(", ")}
                            {pend.length > 4 ? "..." : ""}
                          </div>
                        )}
                      </div>

                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <button
                          onClick={() =>
                            alert(
                              `Dados da Empresa\n\n` +
                                `Número: ${e.id}\n` +
                                `Nome/Razão Social: ${e.razaoSocial}\n` +
                                `CNPJ: ${maskCnpj(e.cnpjDigits)}\n` +
                                `Grupo: ${e.grupo ?? "(sem grupo)"}\n\n` +
                                `Status: ${incompleta ? "INCOMPLETO" : "COMPLETO"}\n` +
                                (incompleta ? `Pendências: ${pend.join(", ")}\n\n` : "\n") +
                                `Endereço:\n` +
                                `Logradouro: ${e.logradouro}\n` +
                                `Número: ${e.numero}\n` +
                                `Complemento: ${e.complemento}\n` +
                                `CEP: ${e.cepDigits ? maskCep(e.cepDigits) : ""}\n` +
                                `Bairro: ${e.bairro}\n` +
                                `Município: ${e.municipio}\n` +
                                `UF: ${e.uf}\n\n` +
                                `Atividade principal:\n` +
                                `CNAE: ${e.cnaeDigits ? maskCnae(e.cnaeDigits) : ""}\n` +
                                `Descrição: ${e.atividadeDescricao}\n\n` +
                                `Natureza Jurídica:\n` +
                                `Código: ${e.naturezaCodigoDigits ? maskNatureza(e.naturezaCodigoDigits) : ""}\n` +
                                `Descrição: ${e.naturezaDescricao}\n\n` +
                                `Responsável: ${e.responsavelNome}\n` +
                                `CPF Responsável: ${e.responsavelCpfDigits ? maskCpf(e.responsavelCpfDigits) : ""}`
                            )
                          }
                          style={{ padding: "10px 12px", borderRadius: "6px", border: "1px solid #ddd", background: "white", cursor: "pointer" }}
                        >
                          Dados
                        </button>

                        {isMaster && (
                          <>
                            <button onClick={() => abrirEditar(e)} style={{ padding: "10px 12px", borderRadius: "6px", border: "none", background: "#0b4fd6", color: "white", cursor: "pointer" }}>
                              Alterar
                            </button>
                            <button onClick={() => excluirEmpresa(e.id)} style={{ padding: "10px 12px", borderRadius: "6px", border: "none", background: "#b00020", color: "white", cursor: "pointer" }}>
                              Excluir
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {(modo === "NOVO" || modo === "EDITAR") && (
          <div style={{ marginTop: "18px", ...boxStyle }}>
            <h2 style={{ marginTop: 0, fontSize: "18px", color: "#333" }}>
              {modo === "NOVO" ? "Nova Empresa" : `Alterar Empresa ${editandoId}`}
            </h2>

            <div style={{ marginTop: "10px", color: "#666", fontSize: "14px" }}>
              Obrigatórios para salvar: <b>Número da Empresa</b>, <b>CNPJ</b> e <b>Nome/Razão Social</b>. O restante pode ser preenchido depois (e ficará como <b>INCOMPLETO</b> na lista).
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "14px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Número da Empresa (4 dígitos) *</label>
                <input
                  value={id}
                  onChange={(e) => setId(onlyDigits(e.target.value).slice(0, 4))}
                  onBlur={() => setId(pad4(id))}
                  placeholder="0000"
                  disabled={modo === "EDITAR"}
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc", background: modo === "EDITAR" ? "#f5f5f5" : "white" }}
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Grupo Empresarial (opcional, 4 dígitos)</label>
                <input
                  value={grupo}
                  onChange={(e) => setGrupo(onlyDigits(e.target.value).slice(0, 4))}
                  onBlur={() => (onlyDigits(grupo).length ? setGrupo(pad4(grupo)) : null)}
                  placeholder="0000"
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }}
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>CNPJ *</label>
                <div style={{ display: "flex", gap: "10px" }}>
                  <input
                    value={maskCnpj(cnpjDigits)}
                    onChange={(e) => setCnpjDigits(onlyDigits(e.target.value).slice(0, 14))}
                    onBlur={(e) => {
                      const v = onlyDigits(e.target.value);
                      if (v.length === 0) return;
                      if (!isCnpjValid(v)) {
                        alert("CNPJ digitado está errado. Confira e digite novamente.");
                        setCnpjDigits("");
                        setTimeout(() => e.currentTarget.focus(), 0);
                      }
                    }}
                    placeholder="00.000.000/0000-00"
                    style={{ flex: 1, padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }}
                  />
                  <button
                    onClick={buscarNaReceita}
                    disabled={carregandoReceita}
                    style={{ padding: "10px 14px", borderRadius: "6px", border: "none", background: carregandoReceita ? "#999" : "#1e8e3e", color: "white", cursor: carregandoReceita ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
                  >
                    {carregandoReceita ? "Buscando..." : "Buscar Receita"}
                  </button>
                </div>
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Nome/Razão Social *</label>
                <input value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} placeholder="Nome completo da empresa" style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }} />
              </div>
            </div>

            <h3 style={{ margin: "18px 0 8px", fontSize: "16px", color: "#333" }}>Demais dados (podem ser preenchidos depois)</h3>

            {/* Endereço */}
            <h4 style={{ margin: "10px 0 6px", fontSize: "14px", color: "#333" }}>Endereço</h4>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "12px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Logradouro</label>
                <input value={logradouro} onChange={(e) => setLogradouro(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Número</label>
                <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="123 ou S/N" style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Complemento</label>
                <input value={complemento} onChange={(e) => setComplemento(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }} />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>CEP</label>
                <input value={maskCep(cepDigits)} onChange={(e) => setCepDigits(onlyDigits(e.target.value).slice(0, 8))} placeholder="00000-000" style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Bairro/Distrito</label>
                <input value={bairro} onChange={(e) => setBairro(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Município</label>
                <input value={municipio} onChange={(e) => setMunicipio(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>UF</label>
                <input value={uf} onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))} placeholder="SP" style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc", textTransform: "uppercase" }} />
              </div>
            </div>

            {/* Atividade */}
            <h4 style={{ margin: "16px 0 6px", fontSize: "14px", color: "#333" }}>Atividade principal</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>CNAE (xx.xx-x-xx)</label>
                <input value={maskCnae(cnaeDigits)} onChange={(e) => setCnaeDigits(onlyDigits(e.target.value).slice(0, 7))} placeholder="00.00-0-00" style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Descrição</label>
                <input value={atividadeDescricao} onChange={(e) => setAtividadeDescricao(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }} />
              </div>
            </div>

            {/* Natureza */}
            <h4 style={{ margin: "16px 0 6px", fontSize: "14px", color: "#333" }}>Natureza Jurídica</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Código (xxx-x)</label>
                <input value={maskNatureza(naturezaCodigoDigits)} onChange={(e) => setNaturezaCodigoDigits(onlyDigits(e.target.value).slice(0, 4))} placeholder="000-0" style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Descrição</label>
                <input value={naturezaDescricao} onChange={(e) => setNaturezaDescricao(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }} />
              </div>
            </div>

            {/* Responsável */}
            <h4 style={{ margin: "16px 0 6px", fontSize: "14px", color: "#333" }}>Responsável</h4>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Nome</label>
                <input value={responsavelNome} onChange={(e) => setResponsavelNome(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>CPF</label>
                <input
                  value={maskCpf(responsavelCpfDigits)}
                  onChange={(e) => setResponsavelCpfDigits(onlyDigits(e.target.value).slice(0, 11))}
                  onBlur={(e) => {
                    const v = onlyDigits(e.target.value);
                    if (v.length === 0) return;
                    if (!isCpfValid(v)) {
                      alert("CPF digitado está errado. Confira e digite novamente.");
                      setResponsavelCpfDigits("");
                      setTimeout(() => e.currentTarget.focus(), 0);
                    }
                  }}
                  placeholder="000.000.000-00"
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "18px" }}>
              <button onClick={salvar} style={{ padding: "10px 14px", borderRadius: "6px", border: "none", background: "#0b4fd6", color: "white", cursor: "pointer" }}>
                Salvar
              </button>
              <button onClick={voltarLista} style={{ padding: "10px 14px", borderRadius: "6px", border: "1px solid #ddd", background: "white", cursor: "pointer" }}>
                Não Salvar
              </button>
            </div>

            {!isMaster && <p style={{ marginTop: "14px", color: "#b00000" }}>Usuário comum não pode cadastrar/alterar empresas.</p>}
          </div>
        )}
      </div>
    </main>
  );
}
