import { NextRequest, NextResponse } from 'next/server';
import { backendFetch, isBackendProxyEnabled } from '@/lib/backend-client';

/**
 * Dashboard → backend proxy for the 7/15/30-day liquidity runway.
 *
 * Forwards to: GET /api/v1/admin/reports/liquidity
 *
 * The backend computes the runway via three parallel `$queryRaw`
 * aggregates (outstanding totals, outstanding-by-bucket,
 * corporate-inbounds-by-bucket) — we simply hand the resulting payload
 * to the dashboard React layer for rendering.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!isBackendProxyEnabled()) {
    return NextResponse.json(
      { error: 'BACKEND_API_URL not configured', code: 'PROXY_DISABLED' },
      { status: 503 },
    );
  }

  const bearer =
    req.cookies.get('admin_access_token')?.value ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null;

  try {
    const data = await backendFetch('/api/v1/admin/reports/liquidity', {
      method: 'GET',
      bearerToken: bearer,
    });
    return NextResponse.json(data);
  } catch (err) {
    const e = err as Error & { status?: number; code?: string };
    return NextResponse.json(
      { error: e.message, code: e.code ?? 'BACKEND_ERROR' },
      { status: e.status ?? 502 },
    );
  }
}
