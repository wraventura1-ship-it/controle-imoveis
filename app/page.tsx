"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#f2f2f2",
        textAlign: "center",
        padding: "24px",
      }}
    >
      {/* Logomarca */}
      <div style={{ marginBottom: "24px" }}>
        <Image
          src="/logo-almeida.jpg"
          alt="Organização Contábil Almeida"
          width={420}
          height={160}
          style={{ objectFit: "contain" }}
          priority
        />
      </div>

      {/* Nome do sistema */}
      <h2 style={{ fontSize: "26px", marginBottom: "30px", color: "#333" }}>
        Controle de Imóveis
      </h2>

      {/* Botão Entrar */}
      <button
        onClick={() => router.push("/login")}
        style={{
          padding: "12px 36px",
          fontSize: "18px",
          cursor: "pointer",
          borderRadius: "6px",
          border: "none",
          backgroundColor: "#0b4fd6",
          color: "white",
        }}
      >
        Entrar
      </button>
    </main>
  );
}
