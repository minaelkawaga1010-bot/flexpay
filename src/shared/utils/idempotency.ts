import { createHash } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import redisService from '@config/redis';
import logger from './logger';

/**
 * HTTP idempotency for payment-class endpoints (TASK-013).
 *
 * SECURITY MODEL — this middleware must run AFTER authentication (and any
 * applicable authorization), never before. It keys every record to the
 * authenticated principal, so one caller can never read, poison, or
 * collide with another's cached response:
 *
 *   scope = role:userId | tenant(companyId) | METHOD | canonical route | client key
 *   redisKey = idem:v2:sha256(scope)
 *
 * A record also carries a fingerprint of the request (method + route +
 * body). Reusing the same key with a different payload is a deterministic
 * 409 conflict, never a replay of the wrong result.
 *
 * Fail closed (TASK-013 §9/§13/§14):
 *   • no authenticated principal + a key present  → 401 (never touch the store)
 *   • the idempotency store errors (Redis outage) → 503 (never silently bypass)
 * Payment-class endpoints lose their HTTP idempotency guarantee only by
 * refusing the request, never by serving it unprotected. Database-level
 * idempotency (unique idempotencyKey columns) remains the independent
 * second line and is untouched.
 *
 * Atomic reserve → complete:
 *   • SET NX reserves the key (short lease) before the handler runs.
 *   • A concurrent duplicate gets 409 IN_PROGRESS; nothing re-executes.
 *   • Only a successful (2xx) response is cached, at the full TTL; any
 *     non-2xx (auth/validation/business failure) releases the reservation
 *     so a legitimate retry can proceed and failures are never replayed.
 *
 * Nothing here logs the raw key, credentials, tokens, PII, or bodies — a
 * principal fingerprint and the event name only.
 */

const COMPLETED_TTL_SECONDS = 24 * 60 * 60;
/** A reservation with no recorded outcome lapses, freeing a crashed request's key. */
const RESERVATION_LEASE_SECONDS = 120;
const MAX_KEY_LENGTH = 200;
/** Visible ASCII only — no control chars, no structural ':' injection into the stored scope. */
const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

interface ReservedRecord {
  state: 'reserved';
  fingerprint: string;
}
interface CompletedRecord {
  state: 'done';
  status: number;
  body: unknown;
  fingerprint: string;
}
type IdempotencyRecord = ReservedRecord | CompletedRecord;

interface Principal {
  id: string;
  role?: string;
  companyId?: string;
}

const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');

/** Opaque, structure-safe Redis key bound to the principal, tenant, method, route and client key. */
function redisKeyFor(principal: Principal, req: Request, clientKey: string): string {
  const route = `${req.baseUrl}${req.path}`;
  const scope = [
    principal.role ?? 'unknown',
    principal.id,
    principal.companyId ?? '-',
    req.method,
    route,
    clientKey,
  ].join('\u0000');
  return `idem:v2:${sha256(scope)}`;
}

/** Fingerprint of the request content — a different payload under the same key is a conflict. */
function fingerprintFor(req: Request): string {
  const route = `${req.method}\u0000${req.baseUrl}${req.path}`;
  const body = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(JSON.stringify((req.body ?? null) as unknown));
  return sha256(Buffer.concat([Buffer.from(`${route}\u0000`), body]));
}

function send(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

export async function idempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  const clientKey = req.header('idempotency-key');
  if (!clientKey) return next();

  // Must run post-authentication. A key without an authenticated principal
  // is refused outright — it can neither create nor read a record.
  const user = (req as { user?: Principal }).user;
  if (!user?.id) {
    logger.warn('idempotency: refused — no authenticated principal', { method: req.method });
    return send(res, 401, 'IDEMPOTENCY_REQUIRES_AUTH');
  }

  if (!KEY_PATTERN.test(clientKey) || clientKey.length > MAX_KEY_LENGTH) {
    return send(res, 400, 'IDEMPOTENCY_KEY_INVALID');
  }

  const redisKey = redisKeyFor(user, req, clientKey);
  const fingerprint = fingerprintFor(req);
  const principalHash = sha256(`${user.role ?? 'unknown'}:${user.id}`).slice(0, 12);

  // Atomically reserve the key before running the handler. A store error
  // here means we cannot provide the guarantee → fail closed.
  let reserved: boolean;
  try {
    reserved = await redisService.setIfAbsent(
      redisKey,
      JSON.stringify({ state: 'reserved', fingerprint } satisfies ReservedRecord),
      RESERVATION_LEASE_SECONDS,
    );
  } catch (err) {
    logger.error('idempotency: store unavailable on reserve — failing closed', {
      principalHash,
      error: (err as Error).message,
    });
    return send(res, 503, 'IDEMPOTENCY_UNAVAILABLE');
  }

  if (!reserved) {
    // Someone already holds this key. Decide from the existing record.
    let record: IdempotencyRecord | null;
    try {
      const raw = await redisService.get(redisKey);
      record = raw ? (JSON.parse(raw) as IdempotencyRecord) : null;
    } catch (err) {
      logger.error('idempotency: store unavailable on read — failing closed', {
        principalHash,
        error: (err as Error).message,
      });
      return send(res, 503, 'IDEMPOTENCY_UNAVAILABLE');
    }

    if (!record) {
      // Reservation lapsed between the failed NX and this read; treat as
      // in-flight and let the client retry rather than racing a re-reserve.
      return send(res, 409, 'IDEMPOTENCY_IN_PROGRESS');
    }
    if (record.fingerprint !== fingerprint) {
      logger.warn('idempotency: key reused with a different payload', { principalHash });
      return send(res, 409, 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
    }
    if (record.state === 'done') {
      res.status(record.status).json(record.body); // authorized replay — same principal, same payload
      return;
    }
    return send(res, 409, 'IDEMPOTENCY_IN_PROGRESS');
  }

  // We own the reservation. Cache a 2xx outcome at the full TTL; release on
  // anything else so failures are never replayed and retries can proceed.
  let finalized = false;
  const finalize = (status: number, body: unknown): void => {
    if (finalized) return;
    finalized = true;
    const success = status >= 200 && status < 300;
    const op = success
      ? redisService.set(
          redisKey,
          JSON.stringify({ state: 'done', status, body, fingerprint } satisfies CompletedRecord),
          COMPLETED_TTL_SECONDS,
        )
      : redisService.del(redisKey);
    op.catch((err) => logger.warn('idempotency: outcome record failed', { principalHash, error: (err as Error).message }));
  };

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    finalize(res.statusCode, body);
    return originalJson(body);
  };
  // Safety net for responses that never call res.json (res.end, dropped
  // connection): release the reservation so the key is not wedged.
  res.on('finish', () => {
    if (!finalized) redisService.del(redisKey).catch(() => undefined);
  });

  next();
}
