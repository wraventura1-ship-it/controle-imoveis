"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MASTER_USERNAME = "WILTON";        // login sempre em maiúsculas
const MASTER_PASSWORD = "Almeida123";   // senha com 1 maiúscula, minúsculas e números

function isPasswordValid(pw: string) {
  // mínimo 8 caracteres, 1 letra maiúscula, 1 número
  return pw.length >= 8 && /[A-Z]/.test(pw) && /\d/.test(pw);
}

export default function LoginPage() {
  const router = useRouter();

  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  function entrar() {
    setErro(null);

    const loginUpper = login.trim().toUpperCase();
    const senhaOriginal = senha.trim(); // NÃO converte para maiúscula

    if (!loginUpper || !senhaOriginal) {
      setErro("Preencha Login e Senha.");
      return;
    }

    if (!isPasswordValid(senhaOriginal)) {
      setErro(
        "Senha inválida. Use no mínimo 8 caracteres, 1 letra maiúscula e 1 número."
      );
      return;
    }

    // LOGIN MASTER
    if (
      loginUpper === MASTER_USERNAME &&
      senhaOriginal === MASTER_PASSWORD
    ) {
      localStorage.setItem(
        "ci_session",
        JSON.stringify({
          username: loginUpper,
          role: "MASTER",
        })
      );

      router.replace("/dashboard");
      return;
    }

    setErro("Login ou senha incorretos.");
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#f2f2f2",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          backgroundColor: "white",
          borderRadius: "10px",
          padding: "24px",
          boxShadow: "0 10px 30px rgba(0,0,0,0.10)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "22px", color: "#333" }}>
          Acesso ao Sistema
        </h1>
        <p style={{ marginTop: "8px", color: "#666" }}>
          Controle de Imóveis
        </p>

        {erro && (
          <div
            style={{
              marginTop: "12px",
              backgroundColor: "#ffe6e6",
              border: "1px solid #ffb3b3",
              color: "#8a0000",
              padding: "10px",
              borderRadius: "6px",
              fontSize: "14px",
            }}
          >
            {erro}
          </div>
        )}

        {/* LOGIN */}
        <div style={{ marginTop: "18px" }}>
          <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>
            Login
          </label>
          <input
            value={login}
            onChange={(e) => setLogin(e.target.value.toUpperCase())}
            type="text"
            placeholder="USUÁRIO"
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: "6px",
              border: "1px solid #ccc",
              outline: "none",
              textTransform: "uppercase",
            }}
          />
        </div>

        {/* SENHA */}
        <div style={{ marginTop: "14px" }}>
          <label style={{ display: "block", marginBottom: "6px", color: "#333" }}>
            Senha
          </label>
          <input
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            type="password"
            placeholder="Senha"
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: "6px",
              border: "1px solid #ccc",
              outline: "none",
            }}
          />
          <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#777" }}>
            Mínimo 8 caracteres, 1 letra maiúscula e 1 número.
          </p>
        </div>

        <button
          onClick={entrar}
          style={{
            marginTop: "18px",
            width: "100%",
            padding: "12px",
            borderRadius: "6px",
            border: "none",
            backgroundColor: "#0b4fd6",
            color: "white",
            fontSize: "16px",
            cursor: "pointer",
          }}
        >
          Entrar
        </button>
      </div>
    </main>
  );
}
