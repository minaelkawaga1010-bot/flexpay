/**
 * TASK-AUTH-R7B — independent, ISOLATED coverage of the GLOBAL API rate limiter
 * (`apiRateLimiter`, mounted on every /api/v1/* route in app.ts) at its
 * PRODUCTION-EQUIVALENT default limit of 100 per REDIS_RATE_LIMIT_TTL.
 *
 * Why this test exists: the E2E harness lifts the cap (tests/e2e/setup.ts sets
 * RATE_LIMIT_MAX_REQUESTS high) so the serial, single-IP E2E suite is not
 * throttled by this shared per-IP counter. That override is process-local to
 * the E2E runner; it is NOT present in this unit process, so env here carries
 * the genuine default (100). We exercise the REAL middleware with the Redis
 * counter simulated in-memory PER KEY — no real or shared Redis is touched and
 * no FLUSHALL/FLUSHDB is ever issued.
 *
 * Scope note (observation only, intentionally NOT remediated in R7B): the
 * global limiter runs BEFORE authentication, so unauthenticated callers sharing
 * one source IP are aggregated under a single `api:ip:<ip>` counter. The last
 * test documents this; it does not change the behaviour.
 *
 * This test changes NO production code or config, does NOT disable rate
 * limiting, and leaves the per-phone authRateLimiter (max 5) and otpRateLimiter
 * (max 3) policies and tests untouched.
 */
import type { Request, Response } from 'express';

// Simulate the fixed-window Redis counter (INCR, EXPIRE-on-first) in memory,
// keyed exactly as the middleware keys it, so we can drive the limit boundary.
const counters = new Map<string, number>();
jest.mock('@config/redis', () => ({
  __esModule: true,
  default: {
    incrementRateLimit: jest.fn(async (key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    }),
    getRateLimitTtl: jest.fn(async () => 3600),
  },
}));

import { apiRateLimiter } from '@shared/middleware/rate-limit';
import { env } from '@config/env';
import redisService from '@config/redis';

const incr = (redisService as unknown as { incrementRateLimit: jest.Mock }).incrementRateLimit;

interface Ctx {
  req: Request;
  res: Response;
  next: jest.Mock;
  status: jest.Mock;
  json: jest.Mock;
}
function mkCtx(opts: { ip?: string; userId?: string } = {}): Ctx {
  const req = {
    ip: opts.ip ?? '203.0.113.7',
    ...(opts.userId ? { user: { id: opts.userId } } : {}),
  } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const res = { status, json } as unknown as Response;
  const next = jest.fn();
  return { req, res, next, status, json };
}

beforeEach(() => {
  counters.clear();
  jest.clearAllMocks();
});

describe('TASK-AUTH-R7B — global apiRateLimiter at the production default (100)', () => {
  it('uses the production-equivalent default limit of 100 in this (non-E2E) process', () => {
    expect(env.RATE_LIMIT_MAX_REQUESTS).toBe(100);
  });

  it('allows every request WITHIN the limit (counts 1..100) → next(), never 429', async () => {
    const ip = '198.51.100.5';
    for (let i = 1; i <= 100; i++) {
      const { req, res, next, status } = mkCtx({ ip });
      await apiRateLimiter(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(status).not.toHaveBeenCalled();
    }
    expect(counters.get(`api:ip:${ip}`)).toBe(100);
  });

  it('REJECTS the first request that EXCEEDS the limit (count 101) → 429 RATE_LIMIT_EXCEEDED, next NOT called', async () => {
    const ip = '198.51.100.6';
    for (let i = 1; i <= 100; i++) {
      const c = mkCtx({ ip });
      await apiRateLimiter(c.req, c.res, c.next);
    }
    const { req, res, next, status, json } = mkCtx({ ip });
    await apiRateLimiter(req, res, next); // the 101st request

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'RATE_LIMIT_EXCEEDED', retryAfter: expect.any(Number) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('keys per authenticated user separately from per-IP — exhausting one key does not throttle another', async () => {
    // Exhaust an authenticated user's bucket (api:user:<id>).
    for (let i = 1; i <= 101; i++) {
      const c = mkCtx({ userId: 'user-A' });
      await apiRateLimiter(c.req, c.res, c.next);
    }
    // A different, unauthenticated principal (api:ip:<ip>) is unaffected.
    const { req, res, next, status } = mkCtx({ ip: '198.51.100.9' });
    await apiRateLimiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
    expect(counters.get('api:user:user-A')).toBe(101);
    expect(counters.get('api:ip:198.51.100.9')).toBe(1);
  });

  it('fails OPEN when the limiter backend errors (incrementRateLimit throws) → next(), no 429', async () => {
    // winston is quiet under NODE_ENV=test; the middleware swallows the error
    // and calls next() so a limiter outage never blocks legitimate traffic.
    incr.mockRejectedValueOnce(new Error('redis down'));

    const { req, res, next, status } = mkCtx({ ip: '198.51.100.10' });
    await apiRateLimiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('OBSERVATION ONLY (not remediated in R7B): pre-auth per-IP keying aggregates distinct unauthenticated callers on one IP', async () => {
    // Two DIFFERENT unauthenticated requests from the SAME source IP share a
    // single `api:ip:<ip>` counter because the limiter runs before auth. This
    // is documented per the R7B scope and intentionally left UNCHANGED.
    const ip = '198.51.100.20';
    const a = mkCtx({ ip });
    await apiRateLimiter(a.req, a.res, a.next);
    const b = mkCtx({ ip });
    await apiRateLimiter(b.req, b.res, b.next);

    expect(counters.get(`api:ip:${ip}`)).toBe(2); // aggregated under one IP key
  });
});
