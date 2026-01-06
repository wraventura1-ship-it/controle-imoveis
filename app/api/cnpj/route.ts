import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cnpj = (searchParams.get("cnpj") || "").replace(/\D/g, "");

  if (cnpj.length !== 14) {
    return NextResponse.json({ error: "CNPJ inválido (14 dígitos)." }, { status: 400 });
  }

  try {
    const url = `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`;
    const r = await fetch(url, { cache: "no-store" });

    if (!r.ok) {
      const text = await r.text();
      return NextResponse.json(
        { error: "Não foi possível consultar o CNPJ agora.", details: text },
        { status: r.status }
      );
    }

    const data = await r.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json(
      { error: "Erro de rede ao consultar CNPJ.", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
