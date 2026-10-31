/**
 * TASK-013 — HTTP idempotency middleware security (unit).
 *
 * Exercises src/shared/utils/idempotency.ts in isolation with a fake
 * req/res/next and the real redisService (its in-memory store under test).
 * Asserts the security invariants, not just happy-path caching:
 *   • a key with no authenticated principal is refused (never touches the store);
 *   • records are scoped to principal + tenant + method + route, so no
 *     cross-user / cross-tenant / cross-route / unauth replay can occur;
 *   • same key + different payload is a deterministic 409, never a wrong replay;
 *   • atomic reserve → 409 in-progress for a concurrent duplicate;
 *   • only 2xx is cached; failures release the reservation;
 *   • a store outage fails closed (503), never a silent bypass;
 *   • raw keys are never logged.
 */

import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import redisService from '@config/redis';
import logger from '@shared/utils/logger';
import { idempotency } from '@shared/utils/idempotency';

interface FakeRes extends EventEmitter {
  statusCode: number;
  status: (c: number) => FakeRes;
  json: (b: unknown) => FakeRes;
  jsonBody?: unknown;
  finish: () => void;
}

function makeRes(): FakeRes {
  const res = new EventEmitter() as FakeRes;
  res.statusCode = 200;
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b: unknown) => {
    res.jsonBody = b;
    return res;
  };
  res.finish = () => res.emit('finish');
  return res;
}

function makeReq(opts: {
  key?: string;
  user?: { id: string; role?: string; companyId?: string };
  method?: string;
  baseUrl?: string;
  path?: string;
  body?: unknown;
}): Request {
  const headers: Record<string, string> = {};
  if (opts.key !== undefined) headers['idempotency-key'] = opts.key;
  return {
    method: opts.method ?? 'POST',
    baseUrl: opts.baseUrl ?? '/api/v1/wallet',
    path: opts.path ?? '/transfer',
    body: opts.body ?? { amount: 100, to: 'x' },
    user: opts.user,
    header: (n: string) => headers[n.toLowerCase()],
  } as unknown as Request;
}

/** Run the middleware; returns whether next() was called and the response. */
async function run(req: Request): Promise<{ nexted: boolean; res: FakeRes }> {
  const res = makeRes();
  let nexted = false;
  await idempotency(req, res as unknown as Response, () => {
    nexted = true;
  });
  return { nexted, res };
}

/** Simulate a handler that runs after next(): write a response, then finish. */
function handlerResponds(res: FakeRes, status: number, body: unknown): void {
  res.status(status).json(body);
  res.finish();
}

const A = { id: 'emp-A', role: 'employee', companyId: 'co-1' };
const B = { id: 'emp-B', role: 'employee', companyId: 'co-1' };

beforeEach(async () => {
  // The in-memory store persists across tests in-process; clear it.
  const mem = (redisService as unknown as { memory: Map<string, unknown> }).memory;
  mem.clear();
  jest.restoreAllMocks();
});

describe('idempotency middleware — pass-through and auth gate', () => {
  it('no Idempotency-Key: passes through untouched', async () => {
    const { nexted, res } = await run(makeReq({ user: A }));
    expect(nexted).toBe(true);
    expect(res.jsonBody).toBeUndefined();
  });

  it('key present but NO authenticated principal: 401, store never touched', async () => {
    const setSpy = jest.spyOn(redisService, 'setIfAbsent');
    const getSpy = jest.spyOn(redisService, 'get');
    const { nexted, res } = await run(makeReq({ key: 'k1' /* no user */ }));
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.jsonBody).toEqual({ error: 'IDEMPOTENCY_REQUIRES_AUTH' });
    expect(setSpy).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('malformed key is rejected 400', async () => {
    for (const key of ['has space', 'bad|char', 'x'.repeat(201), '']) {
      const { res, nexted } = await run(makeReq({ key, user: A }));
      // empty key is treated as "no key" (pass-through); others are 400
      if (key === '') {
        expect(nexted).toBe(true);
      } else {
        expect(res.statusCode).toBe(400);
        expect(res.jsonBody).toEqual({ error: 'IDEMPOTENCY_KEY_INVALID' });
      }
    }
  });
});

describe('idempotency middleware — authorized replay (same principal, same payload)', () => {
  it('first request reserves and runs; the replay returns the cached 2xx without re-running', async () => {
    const first = await run(makeReq({ key: 'k', user: A }));
    expect(first.nexted).toBe(true);
    handlerResponds(first.res, 201, { ok: true, id: 'tx-1' });

    const replay = await run(makeReq({ key: 'k', user: A }));
    expect(replay.nexted).toBe(false); // handler NOT re-run
    expect(replay.res.statusCode).toBe(201); // exact status replayed
    expect(replay.res.jsonBody).toEqual({ ok: true, id: 'tx-1' });
  });

  it('a non-2xx outcome is NOT cached; the reservation releases and a retry re-runs', async () => {
    const first = await run(makeReq({ key: 'k', user: A }));
    expect(first.nexted).toBe(true);
    handlerResponds(first.res, 400, { error: 'INSUFFICIENT_BALANCE' });

    const retry = await run(makeReq({ key: 'k', user: A }));
    expect(retry.nexted).toBe(true); // re-runs rather than replaying a failure
    expect(retry.res.statusCode).not.toBe(400);
  });
});

describe('idempotency middleware — isolation (no cross-boundary replay)', () => {
  async function cacheFor(user: typeof A, over: Partial<Parameters<typeof makeReq>[0]> = {}): Promise<void> {
    const r = await run(makeReq({ key: 'shared', user, ...over }));
    handlerResponds(r.res, 200, { secret: `balance-of-${user.id}` });
  }

  it('cross-user: B with the same key never receives A’s cached response', async () => {
    await cacheFor(A);
    const b = await run(makeReq({ key: 'shared', user: B }));
    expect(b.nexted).toBe(true); // B executes its own request
    expect(b.res.jsonBody).toBeUndefined(); // nothing replayed to B
  });

  it('cross-tenant: same user id but a different companyId is isolated', async () => {
    const t1 = { id: 'emp-X', role: 'employee', companyId: 'co-1' };
    const t2 = { id: 'emp-X', role: 'employee', companyId: 'co-2' };
    await cacheFor(t1);
    const other = await run(makeReq({ key: 'shared', user: t2 }));
    expect(other.nexted).toBe(true);
    expect(other.res.jsonBody).toBeUndefined();
  });

  it('admin vs ordinary user with the same id/key is isolated by role', async () => {
    const user = { id: 'subj', role: 'employee', companyId: 'co-1' };
    const admin = { id: 'subj', role: 'admin' };
    await cacheFor(user);
    const a = await run(makeReq({ key: 'shared', user: admin }));
    expect(a.nexted).toBe(true);
    expect(a.res.jsonBody).toBeUndefined();
  });

  it('same key across a different route or method is isolated', async () => {
    await cacheFor(A, { path: '/transfer', method: 'POST' });
    const otherRoute = await run(makeReq({ key: 'shared', user: A, path: '/withdraw', method: 'POST' }));
    expect(otherRoute.nexted).toBe(true);
    const otherMethod = await run(makeReq({ key: 'shared', user: A, path: '/transfer', method: 'PUT' }));
    expect(otherMethod.nexted).toBe(true);
  });
});

describe('idempotency middleware — payload conflict (TASK-013 §7)', () => {
  it('same key + a different payload is a deterministic 409, never a wrong replay', async () => {
    const first = await run(makeReq({ key: 'k', user: A, body: { amount: 100 } }));
    handlerResponds(first.res, 200, { ok: true });

    const conflict = await run(makeReq({ key: 'k', user: A, body: { amount: 999 } }));
    expect(conflict.nexted).toBe(false);
    expect(conflict.res.statusCode).toBe(409);
    expect(conflict.res.jsonBody).toEqual({ error: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' });
  });

  it('a different payload while the first is still in flight also conflicts', async () => {
    const first = await run(makeReq({ key: 'k', user: A, body: { amount: 100 } }));
    expect(first.nexted).toBe(true); // reserved, not yet finalized
    const conflict = await run(makeReq({ key: 'k', user: A, body: { amount: 5 } }));
    expect(conflict.res.statusCode).toBe(409);
    expect(conflict.res.jsonBody).toEqual({ error: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' });
  });
});

describe('idempotency middleware — concurrency (atomic reserve)', () => {
  it('a concurrent identical duplicate gets 409 IN_PROGRESS while the first is unfinished', async () => {
    const first = await run(makeReq({ key: 'k', user: A }));
    expect(first.nexted).toBe(true); // holds the reservation, handler not finished
    const concurrent = await run(makeReq({ key: 'k', user: A }));
    expect(concurrent.nexted).toBe(false);
    expect(concurrent.res.statusCode).toBe(409);
    expect(concurrent.res.jsonBody).toEqual({ error: 'IDEMPOTENCY_IN_PROGRESS' });
    // Once the first completes, the duplicate replays the result.
    handlerResponds(first.res, 200, { ok: true });
    const afterDone = await run(makeReq({ key: 'k', user: A }));
    expect(afterDone.nexted).toBe(false);
    expect(afterDone.res.jsonBody).toEqual({ ok: true });
  });
});

describe('idempotency middleware — fail closed on store outage (TASK-013 §14)', () => {
  it('reserve error → 503, handler never runs', async () => {
    jest.spyOn(redisService, 'setIfAbsent').mockRejectedValueOnce(new Error('redis down'));
    const { nexted, res } = await run(makeReq({ key: 'k', user: A }));
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(503);
    expect(res.jsonBody).toEqual({ error: 'IDEMPOTENCY_UNAVAILABLE' });
  });

  it('read error on a held key → 503, never a silent bypass', async () => {
    // First reserve so the next call takes the read branch.
    await run(makeReq({ key: 'k', user: A }));
    jest.spyOn(redisService, 'get').mockRejectedValueOnce(new Error('redis down'));
    const { nexted, res } = await run(makeReq({ key: 'k', user: A }));
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(503);
  });
});

describe('idempotency middleware — logging hygiene (TASK-013 §12)', () => {
  it('never logs the raw Idempotency-Key', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    const error = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const secretKey = 'SECRETKEY-abc123';
    // unauth path logs a warn; a conflict logs a warn — exercise both
    await run(makeReq({ key: secretKey }));
    const first = await run(makeReq({ key: secretKey, user: A, body: { a: 1 } }));
    handlerResponds(first.res, 200, { ok: true });
    await run(makeReq({ key: secretKey, user: A, body: { a: 2 } }));
    const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
    expect(logged).not.toContain(secretKey);
  });
});
