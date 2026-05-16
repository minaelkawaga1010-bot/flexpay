/**
 * Typed fetch wrapper for the Express backend at the repo root.
 *
 * The dashboard ships with its own Prisma schema for prototyping — but
 * once `BACKEND_API_URL` is set, the API routes that overlap with the
 * Express backend's surface (auth, wallet, cards, payroll, transactions)
 * can be re-pointed through this client to keep a single source of truth.
 *
 * Routes that don't overlap (aml, hafiza, loyalty, voice, board-deck,
 * cicd, sre, architecture, metrics, infrastructure) continue talking to
 * the local Prisma client and are unaffected.
 */

export const BACKEND_API_URL = process.env.BACKEND_API_URL?.replace(/\/$/, '') ?? '';

export const isBackendProxyEnabled = (): boolean => BACKEND_API_URL.length > 0;

export interface BackendFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Forwarded to the Express backend if present — preserves caller's auth. */
  bearerToken?: string | null;
  /** Forwarded for service-level idempotency on POST/PUT/PATCH. */
  idempotencyKey?: string | null;
}

export interface BackendError extends Error {
  status: number;
  code?: string;
  details?: unknown;
}

function makeError(message: string, status: number, body?: unknown): BackendError {
  const err = new Error(message) as BackendError;
  err.status = status;
  if (body && typeof body === 'object') {
    const data = body as { error?: string; code?: string; details?: unknown };
    err.code = data.code ?? data.error;
    err.details = data.details;
  }
  return err;
}

export async function backendFetch<T = unknown>(
  path: string,
  opts: BackendFetchOptions = {},
): Promise<T> {
  if (!isBackendProxyEnabled()) {
    throw makeError(
      'BACKEND_API_URL is not configured — backend proxy is disabled.',
      503,
    );
  }

  const url = `${BACKEND_API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = new Headers(opts.headers);
  headers.set('content-type', 'application/json');
  if (opts.bearerToken) headers.set('authorization', `Bearer ${opts.bearerToken}`);
  if (opts.idempotencyKey) headers.set('idempotency-key', opts.idempotencyKey);

  const res = await fetch(url, {
    ...opts,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    let parsed: unknown = undefined;
    try {
      parsed = await res.json();
    } catch {
      /* non-JSON error body; leave undefined */
    }
    throw makeError(`Backend ${opts.method ?? 'GET'} ${path} → ${res.status}`, res.status, parsed);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
