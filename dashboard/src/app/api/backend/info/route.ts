import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("http://localhost:4001/", {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Backend is not running" },
      { status: 503 }
    );
  }
}
