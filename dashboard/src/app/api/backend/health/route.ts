import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("http://localhost:4001/health", {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { status: "unhealthy", error: "Backend unreachable", timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
