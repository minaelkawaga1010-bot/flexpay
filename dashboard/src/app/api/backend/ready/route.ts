import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("http://localhost:4001/health/ready", {
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { status: "not_ready", checks: { postgresql: "unreachable", redis: "unreachable" }, error: "Backend unreachable" },
      { status: 503 }
    );
  }
}
