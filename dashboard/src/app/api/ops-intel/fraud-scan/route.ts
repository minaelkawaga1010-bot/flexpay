import { NextRequest, NextResponse } from 'next/server';
import { backendFetch, isBackendProxyEnabled } from '@/lib/backend-client';

/**
 * Dashboard → backend proxy for the on-demand fraud scan.
 *
 * Forwards to: POST /api/v1/admin/reports/fraud-scan
 *
 * The backend already runs the same scan on a 15-minute cron, but this
 * endpoint gives the dashboard a "scan now" trigger for ops drills and
 * for the first paint of the page (cron events are not surfaced to the
 * dashboard out-of-band yet).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
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
    const data = await backendFetch('/api/v1/admin/reports/fraud-scan', {
      method: 'POST',
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
