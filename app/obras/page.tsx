"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Session = {
  username: string;
  role: "MASTER" | "USER";
};

type Empresa = {
  id: string; // 4 dígitos
  razaoSocial: string;
};

type Obra = {
  id: string; // 4 dígitos (número da obra)
  empresaId: string; // 4 dígitos (empresa)
  nome: string;

  // Endereço completo (obrigatório)
  logradouro: string;
  numero: string;
  complemento: string;
  cepDigits: string; // 8 dígitos
  bairro: string;
  municipio: string;
  uf: string; // 2 letras

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

function maskCep(digits8: string | undefined | null) {
  const d = onlyDigits(digits8).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5, 8)}`;
}

function loadEmpresas(): Empresa[] {
  const raw = localStorage.getItem(STORAGE_EMPRESAS);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as any[];
    return arr
      .map((x) => ({
        id: pad4(x?.id),
        razaoSocial: String(x?.razaoSocial ?? ""),
      }))
      .filter((e) => e.id && e.razaoSocial);
  } catch {
    return [];
  }
}

function loadObras(): Obra[] {
  const raw = localStorage.getItem(STORAGE_OBRAS);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as any[];
    return arr.map((x) => ({
      id: pad4(x?.id),
      empresaId: pad4(x?.empresaId),

      nome: String(x?.nome ?? ""),

      logradouro: String(x?.logradouro ?? ""),
      numero: String(x?.numero ?? ""),
      complemento: String(x?.complemento ?? ""),
      cepDigits: onlyDigits(x?.cepDigits),
      bairro: String(x?.bairro ?? ""),
      municipio: String(x?.municipio ?? ""),
      uf: String(x?.uf ?? ""),

      criadoEm: String(x?.criadoEm ?? new Date().toISOString()),
      atualizadoEm: x?.atualizadoEm ? String(x.atualizadoEm) : undefined,
    })) as Obra[];
  } catch {
    return [];
  }
}

function saveObras(obras: Obra[]) {
  localStorage.setItem(STORAGE_OBRAS, JSON.stringify(obras));
}

export default function ObrasPage() {
  const router = useRouter();
  const search = useSearchParams();

  const [session, setSession] = useState<Session | null>(null);

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [obras, setObras] = useState<Obra[]>([]);

  // empresa escolhida (via querystring ?empresa=0001 ou seleção manual)
  const [empresaId, setEmpresaId] = useState<string>("");

  const [modo, setModo] = useState<"LISTA" | "NOVO" | "EDITAR">("LISTA");
  const [editandoKey, setEditandoKey] = useState<string | null>(null); // empresaId:id

  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Form
  const [obraId, setObraId] = useState("");
  const [nome, setNome] = useState("");

  const [logradouro, setLogradouro] = useState("");
  const [numero, setNumero] = useState("");
  const [complemento, setComplemento] = useState("");
  const [cepDigits, setCepDigits] = useState("");
  const [bairro, setBairro] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [uf, setUf] = useState("");

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
    setObras(loadObras());

    const e = search.get("empresa");
    if (e) setEmpresaId(pad4(e));
  }, [search]);

  const isMaster = session?.role === "MASTER";

  const empresaAtual = useMemo(() => {
    const id = pad4(empresaId);
    return empresas.find((x) => x.id === id) || null;
  }, [empresas, empresaId]);

  const obrasDaEmpresa = useMemo(() => {
    const id = pad4(empresaId);
    return obras
      .filter((o) => o.empresaId === id)
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [obras, empresaId]);

  function limparForm() {
    setObraId("");
    setNome("");
    setLogradouro("");
    setNumero("");
    setComplemento("");
    setCepDigits("");
    setBairro("");
    setMunicipio("");
    setUf("");
  }

  function abrirNovo() {
    setErro(null);
    setInfo(null);
    setModo("NOVO");
    setEditandoKey(null);
    limparForm();
  }

  function abrirEditar(o: Obra) {
    setErro(null);
    setInfo(null);
    setModo("EDITAR");
    setEditandoKey(`${o.empresaId}:${o.id}`);

    setObraId(o.id);
    setNome(o.nome);

    setLogradouro(o.logradouro);
    setNumero(o.numero);
    setComplemento(o.complemento);
    setCepDigits(o.cepDigits);
    setBairro(o.bairro);
    setMunicipio(o.municipio);
    setUf(o.uf);
  }

  function voltarLista() {
    setErro(null);
    setInfo(null);
    setModo("LISTA");
    setEditandoKey(null);
    limparForm();
  }

  function validarParaSalvar(acao: "NOVO" | "EDITAR"): string | null {
    const emp = pad4(empresaId);
    if (!emp || emp.length !== 4) return "Selecione uma Empresa antes de cadastrar Obras.";

    const id4 = pad4(obraId);
    if (!id4 || id4.length !== 4) return "Número da Obra deve ter 4 dígitos.";
    if (!nome.trim()) return "Nome da Obra é obrigatório.";

    // Endereço completo obrigatório
    if (!logradouro.trim()) return "Logradouro é obrigatório.";
    if (!numero.trim()) return "Número do endereço é obrigatório (use 'S/N' se não houver).";
    if (onlyDigits(cepDigits).length !== 8) return "CEP inválido (8 dígitos).";
    if (!bairro.trim()) return "Bairro/Distrito é obrigatório.";
    if (!municipio.trim()) return "Município é obrigatório.";
    if (!uf.trim() || uf.trim().length !== 2) return "UF inválida (2 letras).";

    // Unicidade: mesma empresa não pode ter obra com mesmo número
    if (acao === "NOVO") {
      const existe = obras.some((o) => o.empresaId === emp && o.id === id4);
      if (existe) return `Já existe uma Obra ${id4} cadastrada para a Empresa ${emp}.`;
    }

    // No editar, não deixar trocar o número
    if (acao === "EDITAR" && editandoKey) {
      const [, oldId] = editandoKey.split(":");
      if (pad4(oldId) !== id4) return "No modo Alterar, o Número da Obra não pode ser trocado.";
    }

    return null;
  }

  function salvar() {
    setErro(null);
    setInfo(null);

    if (!isMaster) {
      setErro("Somente o usuário Master pode cadastrar/alterar Obras.");
      return;
    }

    const acao = modo === "EDITAR" ? "EDITAR" : "NOVO";
    const msg = validarParaSalvar(acao);
    if (msg) {
      setErro(msg);
      return;
    }

    const emp = pad4(empresaId);
    const id4 = pad4(obraId);

    const registro: Obra = {
      id: id4,
      empresaId: emp,
      nome: nome.trim(),

      logradouro: logradouro.trim(),
      numero: numero.trim(),
      complemento: complemento.trim(),
      cepDigits: onlyDigits(cepDigits),
      bairro: bairro.trim(),
      municipio: municipio.trim(),
      uf: uf.trim().toUpperCase(),

      criadoEm:
        modo === "EDITAR"
          ? obras.find((o) => o.empresaId === emp && o.id === id4)?.criadoEm ?? new Date().toISOString()
          : new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    };

    let novo: Obra[];
    if (modo === "EDITAR") {
      novo = obras.map((o) => (o.empresaId === emp && o.id === id4 ? registro : o));
      setInfo("Obra alterada com sucesso.");
    } else {
      novo = [...obras, registro];
      setInfo("Obra salva com sucesso.");
    }

    setObras(novo);
    saveObras(novo);
    voltarLista();
  }

  function excluirObra(o: Obra) {
    setErro(null);
    setInfo(null);

    if (!isMaster) {
      setErro("Somente o usuário Master pode excluir Obras.");
      return;
    }

    const ok = confirm(`Confirma excluir a Obra ${o.id} (${o.nome})?`);
    if (!ok) return;

    const novo = obras.filter((x) => !(x.empresaId === o.empresaId && x.id === o.id));
    setObras(novo);
    saveObras(novo);
    setInfo(`Obra ${o.id} excluída.`);
  }

  function mostrarDados(o: Obra) {
    alert(
      `Empresa: ${o.empresaId} — ${empresaAtual?.razaoSocial ?? ""}\n` +
        `Obra: ${o.id} — ${o.nome}\n\n` +
        `Endereço:\n` +
        `Logradouro: ${o.logradouro}\n` +
        `Número: ${o.numero}\n` +
        `Complemento: ${o.complemento}\n` +
        `CEP: ${maskCep(o.cepDigits)}\n` +
        `Bairro: ${o.bairro}\n` +
        `Município: ${o.municipio}\n` +
        `UF: ${o.uf}`
    );
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
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "22px", color: "#333" }}>Cadastro de Obras</h1>
            <p style={{ margin: "6px 0 0", color: "#666" }}>
              Usuário: <b>{session.username}</b> ({session.role})
            </p>
            <p style={{ margin: "6px 0 0", color: "#444" }}>
              Empresa selecionada:{" "}
              <b>
                {empresaAtual ? `${empresaAtual.id} — ${empresaAtual.razaoSocial}` : empresaId ? empresaId : "(nenhuma)"}
              </b>
            </p>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={() => router.push("/dashboard")}
              style={{ padding: "10px 14px", borderRadius: "6px", border: "1px solid #ddd", background: "white", cursor: "pointer" }}
            >
              Voltar
            </button>

            <button
              onClick={() => router.push("/empresas")}
              style={{ padding: "10px 14px", borderRadius: "6px", border: "1px solid #ddd", background: "white", cursor: "pointer" }}
            >
              Empresas
            </button>

            {isMaster && modo === "LISTA" && (
              <button
                onClick={abrirNovo}
                style={{ padding: "10px 14px", borderRadius: "6px", border: "none", background: "#0b4fd6", color: "white", cursor: "pointer" }}
              >
                Nova Obra
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

        {/* Seleção de empresa, se não veio pela URL */}
        {!empresaAtual && (
          <div style={{ marginTop: "18px", ...boxStyle }}>
            <h2 style={{ marginTop: 0, fontSize: "18px", color: "#333" }}>Selecione a Empresa</h2>
            {empresas.length === 0 ? (
              <p style={{ color: "#666" }}>Cadastre ao menos 1 empresa primeiro.</p>
            ) : (
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                {empresas.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setEmpresaId(e.id)}
                    style={{ padding: "10px 12px", borderRadius: "6px", border: "1px solid #ddd", background: "white", cursor: "pointer" }}
                  >
                    {e.id} — {e.razaoSocial}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* LISTA */}
        {modo === "LISTA" && empresaAtual && (
          <div style={{ marginTop: "18px", ...boxStyle }}>
            <h2 style={{ marginTop: 0, fontSize: "18px", color: "#333" }}>Obras da Empresa {empresaAtual.id}</h2>

            {obrasDaEmpresa.length === 0 ? (
              <p style={{ color: "#666" }}>Nenhuma obra cadastrada ainda.</p>
            ) : (
              <div style={{ display: "grid", gap: "10px" }}>
                {obrasDaEmpresa.map((o, idx) => (
                  <div
                    key={`${o.empresaId}:${o.id}`}
                    style={{
                      padding: "12px",
                      borderRadius: "8px",
                      border: "1px solid #eee",
                      background: idx % 2 === 0 ? "#fafafa" : "white",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "12px",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, color: "#333" }}>
                        {o.id} — {o.nome}
                      </div>
                      <div style={{ color: "#666", fontSize: "14px", marginTop: "4px" }}>
                        {o.logradouro}, {o.numero} {o.complemento ? `— ${o.complemento}` : ""} | CEP: {maskCep(o.cepDigits)} | {o.municipio}/{o.uf}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button
                        onClick={() => mostrarDados(o)}
                        style={{ padding: "10px 12px", borderRadius: "6px", border: "1px solid #ddd", background: "white", cursor: "pointer" }}
                      >
                        Dados
                      </button>

                      {isMaster && (
                        <>
                          <button
                            onClick={() => abrirEditar(o)}
                            style={{ padding: "10px 12px", borderRadius: "6px", border: "none", background: "#0b4fd6", color: "white", cursor: "pointer" }}
                          >
                            Alterar
                          </button>
                          <button
                            onClick={() => excluirObra(o)}
                            style={{ padding: "10px 12px", borderRadius: "6px", border: "none", background: "#b00020", color: "white", cursor: "pointer" }}
                          >
                            Excluir
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* FORM */}
        {(modo === "NOVO" || modo === "EDITAR") && empresaAtual && (
          <div style={{ marginTop: "18px", ...boxStyle }}>
            <h2 style={{ marginTop: 0, fontSize: "18px", color: "#333" }}>
              {modo === "NOVO" ? "Nova Obra" : `Alterar Obra ${editandoKey?.split(":")[1]}`}
            </h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px", marginTop: "14px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Número da Obra (4 dígitos) *</label>
                <input
                  value={obraId}
                  onChange={(e) => setObraId(onlyDigits(e.target.value).slice(0, 4))}
                  onBlur={() => setObraId(pad4(obraId))}
                  placeholder="0000"
                  disabled={modo === "EDITAR"}
                  style={{
                    width: "100%",
                    padding: "10px",
                    borderRadius: "6px",
                    border: "1px solid #ccc",
                    background: modo === "EDITAR" ? "#f5f5f5" : "white",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Nome da Obra *</label>
                <input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex: Residencial Alameda"
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }}
                />
              </div>
            </div>

            <h3 style={{ margin: "18px 0 8px", fontSize: "16px", color: "#333" }}>Endereço da Obra (obrigatório)</h3>

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "12px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Logradouro *</label>
                <input value={logradouro} onChange={(e) => setLogradouro(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Número *</label>
                <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="123 ou S/N" style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Complemento</label>
                <input value={complemento} onChange={(e) => setComplemento(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }} />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>CEP *</label>
                <input value={maskCep(cepDigits)} onChange={(e) => setCepDigits(onlyDigits(e.target.value).slice(0, 8))} placeholder="00000-000" style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Bairro/Distrito *</label>
                <input value={bairro} onChange={(e) => setBairro(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>Município *</label>
                <input value={municipio} onChange={(e) => setMunicipio(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>UF *</label>
                <input value={uf} onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))} placeholder="SP" style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ccc", textTransform: "uppercase" }} />
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

            {!isMaster && <p style={{ marginTop: "14px", color: "#b00000" }}>Usuário comum não pode cadastrar/alterar obras.</p>}
          </div>
        )}
      </div>
    </main>
  );
}
