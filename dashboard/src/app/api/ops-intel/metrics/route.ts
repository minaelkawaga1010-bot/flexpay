import { NextRequest, NextResponse } from 'next/server';
import { backendFetch, isBackendProxyEnabled } from '@/lib/backend-client';

/**
 * Dashboard → backend proxy for the board-deck KPI compile.
 *
 * Forwards to the live Express backend at:
 *   GET /api/v1/admin/reports/metrics?windowDays=<n>
 *
 * The backend's authenticate('admin') gate is satisfied by forwarding
 * the admin JWT from the dashboard's auth cookie. We deliberately do
 * NOT re-implement metric compilation here — the backend is the single
 * source of truth, and the dashboard's Prisma instance is a separate
 * prototype DB.
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

  const windowDays = req.nextUrl.searchParams.get('windowDays') ?? '30';
  const bearer =
    req.cookies.get('admin_access_token')?.value ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null;

  try {
    const data = await backendFetch(
      `/api/v1/admin/reports/metrics?windowDays=${encodeURIComponent(windowDays)}`,
      { method: 'GET', bearerToken: bearer },
    );
    return NextResponse.json(data);
  } catch (err) {
    const e = err as Error & { status?: number; code?: string };
    return NextResponse.json(
      { error: e.message, code: e.code ?? 'BACKEND_ERROR' },
      { status: e.status ?? 502 },
    );
  }
}
