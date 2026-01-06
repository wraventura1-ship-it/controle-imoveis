"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Session = {
  username: string;
  role: "MASTER" | "USER";
};

export default function DashboardPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem("ci_session");
    if (!raw) {
      router.replace("/login");
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Session;
      setSession(parsed);
    } catch {
      localStorage.removeItem("ci_session");
      router.replace("/login");
    }
  }, [router]);

  if (!session) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        Carregando...
      </main>
    );
  }

  const btn: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: "8px",
    border: "1px solid #ddd",
    background: "white",
    cursor: "pointer",
    fontWeight: 900,
  };

  const primary: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: "8px",
    border: "none",
    background: "#0b4fd6",
    color: "white",
    cursor: "pointer",
    fontWeight: 900,
  };

  return (
    <main style={{ minHeight: "100vh", backgroundColor: "#f2f2f2", padding: "24px" }}>
      <div
        style={{
          maxWidth: "980px",
          margin: "0 auto",
          backgroundColor: "white",
          borderRadius: "10px",
          padding: "20px",
          boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "22px", color: "#333" }}>Dashboard</h1>
            <p style={{ margin: "6px 0 0", color: "#666" }}>
              Bem-vindo, <b>{session.username}</b> ({session.role})
            </p>
          </div>

          <button
            onClick={() => {
              localStorage.removeItem("ci_session");
              router.replace("/login");
            }}
            style={btn}
          >
            Sair
          </button>
        </div>

        <hr style={{ margin: "18px 0", border: "none", borderTop: "1px solid #eee" }} />

        <p style={{ margin: 0, color: "#444" }}>
          Aqui é o painel principal do <b>Controle de Imóveis</b>.
        </p>

        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => router.push("/custos")} style={primary}>
            Quadro de Custos
          </button>

          <button onClick={() => router.push("/gestao")} style={btn}>
            Gestão (Vendas)
          </button>

          <button onClick={() => router.push("/relatorios")} style={btn}>
            Relatórios
          </button>

          <button onClick={() => router.push("/empresas")} style={btn}>
            Empresas
          </button>

          <button onClick={() => router.push("/obras")} style={btn}>
            Obras
          </button>
        </div>
      </div>
    </main>
  );
}
