/**
 * TASK-007 — adversarial webhook security tests.
 *
 * Every request goes over real HTTP (supertest) through the same raw-body
 * mounts as src/app.ts, with the real env parsing (tests/setup.ts supplies
 * random strong credentials), the real verifiers and the real Redis
 * service (its in-memory fallback, as in every unit test). Only Prisma and
 * downstream side-effect services are mocked. Each test loads a fresh,
 * isolated module "world" so no mock state or replay marker leaks.
 *
 * Covers: unsigned requests, invalid signatures, modified payloads,
 * expired and future timestamps, replay attempts, missing and weak
 * secrets in every environment (no bypass), duplicate and concurrent
 * delivery, unauthorized financial state changes, secret-free logging,
 * and the production startup gate for stub / sandbox integrations.
 */

jest.mock('@config/prisma', () => {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ locked: '' }]),
    employee: { update: jest.fn() },
    employeeTransaction: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    card: { update: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  return {
    prisma: {
      employee: { findUnique: jest.fn() },
      employeeTransaction: { findUnique: jest.fn(), findFirst: jest.fn() },
      card: { findUnique: jest.fn(), update: jest.fn() },
      auditLog: { create: jest.fn() },
      loan: { findFirst: jest.fn(), updateMany: jest.fn() },
      billPayment: { findFirst: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  };
});

jest.mock('@modules/cashback/cashback.service', () => ({
  cashbackService: { processCashback: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('@modules/bill-payment/bill-payment.service', () => ({
  settleBillPayment: jest.fn().mockResolvedValue(undefined),
  refundFailedBill: jest.fn().mockResolvedValue(undefined),
}));

import { createHmac, randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import express from 'express';
import request from 'supertest';

// ───────────────────────────────────────────────────────────────────
// Isolated module worlds
// ───────────────────────────────────────────────────────────────────

interface World {
  app: express.Express;
  env: Record<string, unknown>;
  prisma: any;
  bills: { settleBillPayment: jest.Mock; refundFailedBill: jest.Mock };
  redis: any;
  security: typeof import('../src/webhooks/webhook-security');
  logger: any;
}

const RAW = { type: 'application/json', limit: '1mb' } as const;

/** Load env + webhooks from scratch with `overrides` applied to process.env. */
function loadWorld(overrides: Record<string, string | undefined> = {}): World {
  const saved = process.env;
  process.env = { ...saved };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    let world!: World;
    jest.isolateModules(() => {
      jest.doMock('dotenv/config', () => ({}));
      const { nymCardAuthorizeWebhook } = require('../src/webhooks/nymcard-authorize.webhook');
      const { nymCardCardWebhook } = require('../src/webhooks/nymcard-card.webhook');
      const { moneyHashRemittanceWebhook } = require('../src/webhooks/moneyhash-remittance.webhook');
      const { flexxpayWebhook } = require('../src/webhooks/flexxpay.webhook');
      const { billerWebhook } = require('../src/webhooks/biller.webhook');
      const { errorHandler } = require('../src/shared/middleware/error-handler');

      // Same mounts as src/app.ts: raw body, before any JSON parser.
      const app = express();
      app.use('/webhooks/nymcard', express.raw(RAW), nymCardAuthorizeWebhook.router);
      app.use('/webhooks/nymcard', express.raw(RAW), nymCardCardWebhook.router);
      app.use('/webhooks/moneyhash', express.raw(RAW), moneyHashRemittanceWebhook.router);
      app.use('/webhooks/flexxpay', express.raw(RAW), flexxpayWebhook.router);
      app.use('/webhooks/biller', express.raw(RAW), billerWebhook.router);
      app.use(errorHandler);

      world = {
        app,
        env: require('../src/config/env').env,
        prisma: require('../src/config/prisma').prisma,
        bills: require('../src/modules/bill-payment/bill-payment.service'),
        redis: require('../src/config/redis').default,
        security: require('../src/webhooks/webhook-security'),
        logger: require('../src/shared/utils/logger').default,
      };
    });
    return world;
  } finally {
    process.env = saved;
  }
}

/** Every `jest.fn()` reachable from `obj`. */
function allMocks(obj: unknown): jest.Mock[] {
  if (!obj || typeof obj !== 'object') return [];
  return Object.values(obj).flatMap((value) =>
    jest.isMockFunction(value) ? [value as jest.Mock] : allMocks(value),
  );
}

/** Nothing was read or written: no DB access and no settlement / refund call. */
function expectNoDataAccess(w: World): void {
  for (const mock of [...allMocks(w.prisma), ...allMocks(w.bills)]) {
    expect(mock).not.toHaveBeenCalled();
  }
}

const spies: jest.SpyInstance[] = [];

/** Swallow and record every log line (logger and console); returns a serializer. */
function captureLogs(w: World): () => string {
  const lines: unknown[][] = [];
  for (const level of ['error', 'warn', 'info', 'debug']) {
    spies.push(jest.spyOn(w.logger, level).mockImplementation((...args: unknown[]) => {
      lines.push(args);
      return w.logger;
    }));
  }
  for (const method of ['error', 'warn', 'log'] as const) {
    spies.push(jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args);
    }));
  }
  return () => JSON.stringify(lines);
}

function freezeClock(ms: number): void {
  spies.push(jest.spyOn(Date, 'now').mockReturnValue(ms));
}

afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore());
});

// ───────────────────────────────────────────────────────────────────
// Credentials, signing and requests
// ───────────────────────────────────────────────────────────────────

const NYM_USER = process.env.NYMCARD_WEBHOOK_BASIC_USER as string;
const NYM_PASSWORD = process.env.NYMCARD_WEBHOOK_BASIC_PASSWORD as string;
const MH_SECRET = process.env.MONEYHASH_WEBHOOK_SECRET as string;
const FX_SECRET = process.env.FLEXXPAY_WEBHOOK_SECRET as string;
const BILLER_SECRET = process.env.BILLER_WEBHOOK_SECRET as string;

const hex = (bytes: number) => randomBytes(bytes).toString('hex');
const uid = (prefix: string) => `${prefix}-${hex(6)}`;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const hmacHex = (secret: string, data: string | Buffer) =>
  createHmac('sha256', secret).update(data).digest('hex');

/** MoneyHash v3: HMAC-SHA256(secret, base64(raw body) + t), hex. */
function moneyHashHeader(raw: string, secret = MH_SECRET, t = nowSeconds()): string {
  return `t=${t},v3=${hmacHex(secret, Buffer.from(raw).toString('base64') + t)}`;
}

const ROUTES = {
  authorize: '/webhooks/nymcard/authorize',
  transaction: '/webhooks/nymcard/transaction',
  shipping: '/webhooks/nymcard/shipping-update',
  cardStatus: '/webhooks/nymcard/card-status',
  moneyhash: '/webhooks/moneyhash/status',
  flexxpay: '/webhooks/flexxpay/status',
  biller: '/webhooks/biller/status',
} as const;
type Route = keyof typeof ROUTES;
const ALL_ROUTES = Object.keys(ROUTES) as Route[];
const NYMCARD_ROUTES: readonly Route[] = ['authorize', 'transaction', 'shipping', 'cardStatus'];

/** A body that would move money or change financial state if accepted. */
function forgedBody(route: Route): string {
  switch (route) {
    case 'authorize':
      return JSON.stringify({ card_id: 'nym-1', amount: 4321.987, currency: 'AED', merchant_mcc: '5411', merchant_country: 'AE' });
    case 'transaction':
      return JSON.stringify({ type: 'transaction.refunded', data: { id: uid('evt'), cardId: 'nym-1', amount: 4321.987, currency: 'AED' } });
    case 'shipping':
      return JSON.stringify({ cardId: 'nym-1', status: 'DELIVERED' });
    case 'cardStatus':
      return JSON.stringify({ cardId: 'nym-1', status: 'ACTIVE' });
    case 'moneyhash':
      return JSON.stringify({ transferId: uid('tr'), status: 'failed' });
    case 'flexxpay':
      return JSON.stringify({ partnerReference: uid('pr'), status: 'repaid' });
    case 'biller':
      return JSON.stringify({ externalRef: uid('rail'), status: 'failed' });
  }
}

interface Creds {
  user: string;
  password: string;
  moneyhash: string;
  flexxpay: string;
  biller: string;
}
const CONFIGURED: Creds = {
  user: NYM_USER,
  password: NYM_PASSWORD,
  moneyhash: MH_SECRET,
  flexxpay: FX_SECRET,
  biller: BILLER_SECRET,
};

/** Correct authentication for `route` under the given credentials. */
function authHeaders(route: Route, raw: string, creds: Creds = CONFIGURED): Record<string, string> {
  if (NYMCARD_ROUTES.includes(route)) return { Authorization: basic(creds.user, creds.password) };
  if (route === 'moneyhash') return { 'MoneyHash-Signature': moneyHashHeader(raw, creds.moneyhash) };
  if (route === 'flexxpay') return { 'x-flexxpay-signature': hmacHex(creds.flexxpay, raw) };
  return { 'x-biller-signature': hmacHex(creds.biller, raw) };
}

function post(w: World, route: Route, raw: string, headers: Record<string, string> = {}, contentType = 'application/json') {
  const req = request(w.app).post(ROUTES[route]).set('Content-Type', contentType);
  for (const [name, value] of Object.entries(headers)) req.set(name, value);
  return req.send(raw);
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !condition(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!condition()) throw new Error('condition not reached');
}

let w: World;
beforeEach(() => {
  jest.clearAllMocks();
  w = loadWorld();
  captureLogs(w);
});

// ═══════════════════════════════════════════════════════════════════
// 1. Unsigned / unauthenticated requests
// ═══════════════════════════════════════════════════════════════════

describe('unsigned and unauthenticated requests', () => {
  it.each(ALL_ROUTES)('%s: no credentials or signature → 401 before any read or write', async (route) => {
    const res = await post(w, route, forgedBody(route));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe(route === 'authorize' ? 'invalid_credentials' : 'UNAUTHORIZED');
    expectNoDataAccess(w);
  });

  it.each(['moneyhash', 'flexxpay', 'biller'] as Route[])(
    '%s: a non-JSON content type leaves no raw body to verify → 401',
    async (route) => {
      const raw = forgedBody(route);
      const res = await post(w, route, raw, authHeaders(route, raw), 'text/plain');
      expect(res.status).toBe(401);
      expectNoDataAccess(w);
    },
  );

  it("NymCard: the legacy x-nymcard-signature HMAC header is not nCore's protocol → 401", async () => {
    const raw = forgedBody('transaction');
    const res = await post(w, 'transaction', raw, { 'x-nymcard-signature': `sha256=${hmacHex(NYM_PASSWORD, raw)}` });
    expect(res.status).toBe(401);
    expectNoDataAccess(w);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Invalid signatures and credentials
// ═══════════════════════════════════════════════════════════════════

describe('invalid signatures and credentials', () => {
  it.each(NYMCARD_ROUTES)('%s: wrong password, wrong user or a non-Basic scheme → 401', async (route) => {
    const raw = forgedBody(route);
    for (const authorization of [
      basic(NYM_USER, hex(32)),
      basic('someone-else', NYM_PASSWORD),
      `Bearer ${NYM_PASSWORD}`,
      basic(NYM_USER, `${NYM_PASSWORD}x`),
    ]) {
      const res = await post(w, route, raw, { Authorization: authorization });
      expect(res.status).toBe(401);
    }
    expectNoDataAccess(w);
  });

  it('moneyhash: wrong key, wrong construction, or only v1/v2 fields → 401', async () => {
    const raw = forgedBody('moneyhash');
    const t = nowSeconds();
    for (const header of [
      moneyHashHeader(raw, hex(32), t),
      `t=${t},v3=${hmacHex(MH_SECRET, raw)}`, // HMAC of the raw body, not base64(body) + t
      `t=${t},v1=${hmacHex(MH_SECRET, Buffer.from(raw).toString('base64') + t)}`,
      `t=${t},v3=${'0'.repeat(64)}`,
      `t=${t},v3=not-hex`,
    ]) {
      const res = await post(w, 'moneyhash', raw, { 'MoneyHash-Signature': header });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('INVALID_SIGNATURE');
    }
    expectNoDataAccess(w);
  });

  it.each([
    ['flexxpay', 'x-flexxpay-signature', FX_SECRET],
    ['biller', 'x-biller-signature', BILLER_SECRET],
  ] as Array<[Route, string, string]>)('%s: wrong key, truncated, non-hex or cross-provider signature → 401', async (route, header, secret) => {
    const raw = forgedBody(route);
    const good = hmacHex(secret, raw);
    const otherProvider = route === 'flexxpay' ? BILLER_SECRET : FX_SECRET;
    for (const value of [hmacHex(hex(32), raw), good.slice(0, 63), `${good.slice(0, 62)}zz`, hmacHex(otherProvider, raw), '']) {
      const res = await post(w, route, raw, { [header]: value });
      expect(res.status).toBe(401);
    }
    // A correct signature under the other provider's header name.
    const swapped = route === 'flexxpay' ? 'x-biller-signature' : 'x-flexxpay-signature';
    expect((await post(w, route, raw, { [swapped]: good })).status).toBe(401);
    expectNoDataAccess(w);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Modified payloads
// ═══════════════════════════════════════════════════════════════════

describe('modified payloads', () => {
  it('moneyhash: turning a signed success into a failure (refund) is rejected', async () => {
    const transferId = uid('tr');
    const signed = JSON.stringify({ transferId, status: 'succeeded' });
    const tampered = JSON.stringify({ transferId, status: 'failed' });
    const res = await post(w, 'moneyhash', tampered, { 'MoneyHash-Signature': moneyHashHeader(signed) });
    expect(res.status).toBe(401);
    expectNoDataAccess(w);
  });

  it('moneyhash: moving the signed timestamp without re-signing is rejected', async () => {
    const raw = forgedBody('moneyhash');
    const header = moneyHashHeader(raw, MH_SECRET, nowSeconds() - 30).replace(/t=\d+/, `t=${nowSeconds()}`);
    expect((await post(w, 'moneyhash', raw, { 'MoneyHash-Signature': header })).status).toBe(401);
    expectNoDataAccess(w);
  });

  it('flexxpay: turning a signed "repaid" into "defaulted" is rejected', async () => {
    const ref = uid('pr');
    const signed = JSON.stringify({ partnerReference: ref, status: 'repaid' });
    const tampered = JSON.stringify({ partnerReference: ref, status: 'defaulted' });
    const res = await post(w, 'flexxpay', tampered, { 'x-flexxpay-signature': hmacHex(FX_SECRET, signed) });
    expect(res.status).toBe(401);
    expectNoDataAccess(w);
  });

  it('biller: turning a signed completion into a failure (refund) is rejected', async () => {
    const ref = uid('rail');
    const signed = JSON.stringify({ externalRef: ref, status: 'completed' });
    const tampered = JSON.stringify({ externalRef: ref, status: 'failed' });
    const res = await post(w, 'biller', tampered, { 'x-biller-signature': hmacHex(BILLER_SECRET, signed) });
    expect(res.status).toBe(401);
    expectNoDataAccess(w);
  });

  it('signatures cover the exact raw bytes: semantically equal JSON with other whitespace is rejected', async () => {
    const ref = uid('pr');
    const signed = `{"partnerReference":"${ref}","status":"repaid"}`;
    const reformatted = `{ "partnerReference": "${ref}", "status": "repaid" }`;
    const res = await post(w, 'flexxpay', reformatted, { 'x-flexxpay-signature': hmacHex(FX_SECRET, signed) });
    expect(res.status).toBe(401);
    expectNoDataAccess(w);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Timestamps (MoneyHash is the only provider that signs one)
// ═══════════════════════════════════════════════════════════════════

describe('moneyhash timestamp window', () => {
  const NOW_MS = 1_800_000_000_000;
  const NOW = NOW_MS / 1000;

  async function at(t: number, world = w) {
    const raw = forgedBody('moneyhash');
    world.prisma.employeeTransaction.findFirst.mockResolvedValue(null); // unknown transfer → 202
    return post(world, 'moneyhash', raw, { 'MoneyHash-Signature': moneyHashHeader(raw, MH_SECRET, t) });
  }

  beforeEach(() => freezeClock(NOW_MS));

  it('accepts t up to the 300s tolerance and rejects anything older', async () => {
    expect((await at(NOW - 300)).status).toBe(202);
    const expired = await at(NOW - 301);
    expect(expired.status).toBe(401);
    expect(expired.body.message).toBe('STALE_TIMESTAMP');
  });

  it('accepts at most 60s of clock skew into the future', async () => {
    expect((await at(NOW + 60)).status).toBe(202);
    const future = await at(NOW + 61);
    expect(future.status).toBe(401);
    expect(future.body.message).toBe('STALE_TIMESTAMP');
  });

  it('rejects a millisecond or missing timestamp', async () => {
    const raw = forgedBody('moneyhash');
    const v3 = hmacHex(MH_SECRET, Buffer.from(raw).toString('base64') + NOW_MS);
    expect((await post(w, 'moneyhash', raw, { 'MoneyHash-Signature': `t=${NOW_MS},v3=${v3}` })).status).toBe(401);
    expect((await post(w, 'moneyhash', raw, { 'MoneyHash-Signature': `v3=${v3}` })).status).toBe(401);
    expectNoDataAccess(w);
  });

  it('honours a configured tolerance', async () => {
    const strict = loadWorld({ MONEYHASH_WEBHOOK_TOLERANCE_SECONDS: '60' });
    captureLogs(strict);
    expect((await at(NOW - 60, strict)).status).toBe(202);
    expect((await at(NOW - 61, strict)).status).toBe(401);
  });

  it.each([
    ['MONEYHASH_WEBHOOK_TOLERANCE_SECONDS', '30'],
    ['MONEYHASH_WEBHOOK_TOLERANCE_SECONDS', '86400'],
    ['WEBHOOK_REPLAY_TTL_SECONDS', '60'],
  ])('refuses to start with an out-of-bounds %s=%s', (variable, value) => {
    spies.push(jest.spyOn(console, 'error').mockImplementation(() => undefined));
    expect(() => loadWorld({ [variable]: value })).toThrow('Environment validation failed');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Replay attempts (authentication layer)
// ═══════════════════════════════════════════════════════════════════

describe('replay attempts', () => {
  it('moneyhash: an identical replay is acknowledged without a second refund', async () => {
    const transferId = uid('tr');
    const row = { id: 'txn-1', employeeId: 'emp-1', type: 'REMITTANCE', status: 'PENDING', totalAmount: 500, fee: 5, currency: 'AED', reference: transferId };
    w.prisma.employeeTransaction.findFirst.mockResolvedValue(row);
    // Always PENDING, never a refund: the business guard alone would not stop it
    w.prisma.__tx.employeeTransaction.findUnique.mockImplementation(async ({ where }: any) => (where.id ? row : null));
    w.prisma.__tx.employeeTransaction.create.mockResolvedValue({ id: 'refund-1' });
    const raw = JSON.stringify({ transferId, status: 'failed' });
    const headers = { 'MoneyHash-Signature': moneyHashHeader(raw) };

    const first = await post(w, 'moneyhash', raw, headers);
    const replay = await post(w, 'moneyhash', raw, headers);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ received: true, duplicate: true });
    expect(w.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(w.prisma.__tx.employee.update).toHaveBeenCalledTimes(1);
  });

  it('moneyhash: a captured request replayed after the tolerance window is rejected', async () => {
    const raw = forgedBody('moneyhash');
    const headers = { 'MoneyHash-Signature': moneyHashHeader(raw) };
    freezeClock(Date.now() + 400_000);
    const res = await post(w, 'moneyhash', raw, headers);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('STALE_TIMESTAMP');
    expectNoDataAccess(w);
  });

  it('flexxpay: an identical replay does not write the loan twice', async () => {
    w.prisma.loan.findFirst.mockResolvedValue({ id: 'loan-1', status: 'ACTIVE', disbursedAmount: 1, disbursedAt: null, disbursementTxnId: null });
    w.prisma.loan.updateMany.mockResolvedValue({ count: 1 });
    const raw = forgedBody('flexxpay');
    const headers = authHeaders('flexxpay', raw);
    expect((await post(w, 'flexxpay', raw, headers)).body).toEqual({ received: true });
    expect((await post(w, 'flexxpay', raw, headers)).body).toEqual({ received: true, duplicate: true });
    expect(w.prisma.loan.updateMany).toHaveBeenCalledTimes(1);
  });

  it('biller: an identical replay does not refund twice', async () => {
    w.prisma.billPayment.findFirst.mockResolvedValue({ id: 'bp-1', status: 'PENDING' });
    const raw = forgedBody('biller');
    const headers = authHeaders('biller', raw);
    await post(w, 'biller', raw, headers);
    const replay = await post(w, 'biller', raw, headers);
    expect(replay.body).toEqual({ received: true, duplicate: true });
    expect(w.bills.refundFailedBill).toHaveBeenCalledTimes(1);
  });

  it('nymcard /transaction: an identical replay is suppressed even before the DB idempotency check', async () => {
    w.prisma.card.findUnique.mockResolvedValue({ id: 'card-1', cardId: 'nym-1', employeeId: 'emp-1', dailyLimit: 1e6, monthlyLimit: 1e6, spentToday: 0, spentThisMonth: 0, updatedAt: new Date() });
    w.prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1', plan: 'BASIC', walletBalance: 0 });
    w.prisma.employeeTransaction.findUnique.mockResolvedValue(null);
    const raw = forgedBody('transaction');
    const headers = authHeaders('transaction', raw);
    expect((await post(w, 'transaction', raw, headers)).status).toBe(200);
    expect((await post(w, 'transaction', raw, headers)).body).toEqual({ received: true, duplicate: true });
    expect(w.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(w.prisma.__tx.employee.update).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Duplicate delivery (business idempotency) and concurrency
// ═══════════════════════════════════════════════════════════════════

describe('duplicate and concurrent delivery', () => {
  it('moneyhash: a provider retry with a fresh signature authenticates but cannot refund twice', async () => {
    const transferId = uid('tr');
    const row = { id: 'txn-1', employeeId: 'emp-1', type: 'REMITTANCE', status: 'PENDING', totalAmount: 500, fee: 5, currency: 'AED', reference: transferId };
    let refund: unknown = null;
    w.prisma.employeeTransaction.findFirst.mockImplementation(async () => ({ ...row }));
    // Re-read by id under the lock; refund looked up by its idempotency key.
    w.prisma.__tx.employeeTransaction.findUnique.mockImplementation(async ({ where }: any) => (where.id ? { ...row } : refund));
    w.prisma.__tx.employeeTransaction.update.mockImplementation(async ({ data }: any) => Object.assign(row, data));
    w.prisma.__tx.employeeTransaction.create.mockImplementation(async ({ data }: any) => (refund = { id: 'refund-1', ...data }));
    const raw = JSON.stringify({ transferId, status: 'failed' });

    const first = await post(w, 'moneyhash', raw, { 'MoneyHash-Signature': moneyHashHeader(raw, MH_SECRET, nowSeconds() - 5) });
    const retry = await post(w, 'moneyhash', raw, { 'MoneyHash-Signature': moneyHashHeader(raw) });

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({ received: true }); // processed, not suppressed — and a no-op
    expect(w.prisma.__tx.employeeTransaction.create).toHaveBeenCalledTimes(1);
    expect(w.prisma.__tx.employee.update).toHaveBeenCalledTimes(1);
  });

  it('nymcard: the same event re-serialised (new raw body) hits the DB idempotency key, not the ledger', async () => {
    const eventId = uid('evt');
    let booked: unknown = null;
    w.prisma.card.findUnique.mockResolvedValue({ id: 'card-1', cardId: 'nym-1', employeeId: 'emp-1', dailyLimit: 1e6, monthlyLimit: 1e6, spentToday: 0, spentThisMonth: 0, updatedAt: new Date() });
    w.prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1', plan: 'BASIC', walletBalance: 0 });
    w.prisma.employeeTransaction.findUnique.mockImplementation(async () => booked);
    w.prisma.__tx.employeeTransaction.create.mockImplementation(async ({ data }: any) => (booked = data));
    const data = { id: eventId, cardId: 'nym-1', amount: 80, currency: 'AED' };
    const first = JSON.stringify({ type: 'transaction.refunded', data });
    const reordered = JSON.stringify({ data, type: 'transaction.refunded' });

    await post(w, 'transaction', first, authHeaders('transaction', first));
    await post(w, 'transaction', reordered, authHeaders('transaction', reordered));

    expect(w.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(w.prisma.__tx.employee.update).toHaveBeenCalledTimes(1);
  });

  it('a concurrent duplicate gets 409 while the first is in flight, then a duplicate ACK', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    w.prisma.employeeTransaction.findFirst.mockImplementation(async () => {
      await gate;
      return null;
    });
    const raw = forgedBody('moneyhash');
    const headers = { 'MoneyHash-Signature': moneyHashHeader(raw) };

    const first = post(w, 'moneyhash', raw, headers).then((res) => res);
    await waitFor(() => w.prisma.employeeTransaction.findFirst.mock.calls.length === 1);
    const concurrent = await post(w, 'moneyhash', raw, headers);
    release();

    expect(concurrent.status).toBe(409);
    expect(concurrent.body).toEqual({ error: 'DELIVERY_IN_PROGRESS' });
    expect((await first).status).toBe(202);
    expect((await post(w, 'moneyhash', raw, headers)).body).toEqual({ received: true, duplicate: true });
    expect(w.prisma.employeeTransaction.findFirst).toHaveBeenCalledTimes(1);
  });

  it('a failed attempt releases the delivery so the provider retry is processed', async () => {
    w.prisma.loan.findFirst
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue({ id: 'loan-1', status: 'ACTIVE', disbursedAmount: 1, disbursedAt: null, disbursementTxnId: null });
    w.prisma.loan.updateMany.mockResolvedValue({ count: 1 });
    const raw = forgedBody('flexxpay');
    const headers = authHeaders('flexxpay', raw);

    expect((await post(w, 'flexxpay', raw, headers)).status).toBe(500);
    const retry = await post(w, 'flexxpay', raw, headers);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({ received: true });
    expect(w.prisma.loan.updateMany).toHaveBeenCalledTimes(1);
  });

  it('a non-2xx outcome (e.g. invalid payload) is not remembered as processed', async () => {
    const raw = JSON.stringify({ externalRef: uid('rail'), status: 'bogus' });
    const headers = authHeaders('biller', raw);
    expect((await post(w, 'biller', raw, headers)).status).toBe(400);
    expect((await post(w, 'biller', raw, headers)).status).toBe(400); // not a "duplicate" 200
  });

  it('claims a short processing lease and remembers acknowledged deliveries for the replay window', async () => {
    const claim = jest.spyOn(w.redis, 'setIfAbsent');
    const record = jest.spyOn(w.redis, 'set');
    spies.push(claim, record);
    w.prisma.billPayment.findFirst.mockResolvedValue({ id: 'bp-1', status: 'PENDING' });
    const raw = forgedBody('biller');
    const signature = hmacHex(BILLER_SECRET, raw);

    expect((await post(w, 'biller', raw, { 'x-biller-signature': signature })).status).toBe(200);

    const [marker, state, lease] = claim.mock.calls[0] as [string, string, number];
    expect(marker).toMatch(/^webhook:delivery:[0-9a-f]{64}$/);
    expect(marker).not.toContain(signature); // only a hash of the delivery key is stored
    expect(state).toBe('processing');
    expect(lease).toBe(w.security.DELIVERY_PROCESSING_LEASE_SECONDS);
    expect(record).toHaveBeenCalledWith(marker, 'done', w.env.WEBHOOK_REPLAY_TTL_SECONDS);
  });

  it('fails closed when the replay store is unavailable: nothing is processed', async () => {
    spies.push(jest.spyOn(w.redis, 'setIfAbsent').mockRejectedValueOnce(new Error('redis down')));
    const raw = forgedBody('biller');
    expect((await post(w, 'biller', raw, authHeaders('biller', raw))).status).toBe(500);
    expectNoDataAccess(w);
  });

  it('a failure to record the outcome never masks the processed result', async () => {
    spies.push(jest.spyOn(w.redis, 'set').mockRejectedValueOnce(new Error('redis down')));
    w.prisma.billPayment.findFirst.mockResolvedValue({ id: 'bp-1', status: 'PENDING' });
    const raw = JSON.stringify({ externalRef: uid('rail'), status: 'completed' });
    const res = await post(w, 'biller', raw, authHeaders('biller', raw));
    expect(res.status).toBe(200);
    expect(w.bills.settleBillPayment).toHaveBeenCalledTimes(1);
    expect(w.logger.warn).toHaveBeenCalledWith('Webhook delivery marker update failed', { provider: 'biller' });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Out-of-order events cannot regress financial state
// ═══════════════════════════════════════════════════════════════════

describe('flexxpay out-of-order events', () => {
  it('an early event is retried until its predecessor lands; a stale one can never move the loan back', async () => {
    const ref = uid('pr');
    const loan = { id: 'loan-9', status: 'PENDING', disbursedAmount: null as number | null, disbursedAt: null, disbursementTxnId: null };
    w.prisma.loan.findFirst.mockImplementation(async () => ({ ...loan }));
    w.prisma.loan.updateMany.mockImplementation(async ({ where, data }: any) => {
      if (where.status !== loan.status) return { count: 0 };
      Object.assign(loan, data);
      return { count: 1 };
    });
    const send = (raw: string) => post(w, 'flexxpay', raw, authHeaders('flexxpay', raw));
    const repaid = JSON.stringify({ partnerReference: ref, status: 'repaid' });
    const disbursed = JSON.stringify({ partnerReference: ref, status: 'disbursed', disbursedAmount: 100 });

    const early = await send(repaid);
    expect(early.status).toBe(409);
    expect(early.body.error).toBe('EVENT_OUT_OF_ORDER');
    expect((await send(disbursed)).status).toBe(200);
    expect(loan.status).toBe('ACTIVE');
    expect((await send(repaid)).status).toBe(200); // the provider's retry is processed
    expect(loan.status).toBe('REPAID');

    // A freshly signed, re-serialised copy of the old event (as after the
    // replay window) is acknowledged but cannot reopen the repaid loan.
    const staleCopy = JSON.stringify({ status: 'disbursed', partnerReference: ref, disbursedAmount: 100 });
    const stale = await send(staleCopy);
    expect(stale.body).toEqual({ received: true, ignored: 'STALE_OR_INVALID_TRANSITION' });
    expect(loan.status).toBe('REPAID');
    expect(w.prisma.loan.updateMany).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Missing or weak secrets: fail closed, no environment bypass
// ═══════════════════════════════════════════════════════════════════

const NO_WEBHOOK_SECRETS = {
  NYMCARD_WEBHOOK_BASIC_USER: undefined,
  NYMCARD_WEBHOOK_BASIC_PASSWORD: undefined,
  MONEYHASH_WEBHOOK_SECRET: undefined,
  FLEXXPAY_WEBHOOK_SECRET: undefined,
  BILLER_WEBHOOK_SECRET: undefined,
};

describe('missing or weak webhook secrets', () => {
  const UNCONFIGURED: Creds = { user: '', password: '', moneyhash: '', flexxpay: '', biller: '' };

  describe.each(['development', 'test'])('NODE_ENV=%s', (nodeEnv) => {
    it.each(ALL_ROUTES)('%s: refused with 503 — the old non-production passthrough is gone', async (route) => {
      const world = loadWorld({ ...NO_WEBHOOK_SECRETS, NODE_ENV: nodeEnv });
      captureLogs(world);
      const raw = forgedBody(route);
      for (const headers of [{}, authHeaders(route, raw, UNCONFIGURED)]) {
        const res = await post(world, route, raw, headers);
        expect(res.status).toBe(503);
        expect(res.body.error).toBe(route === 'authorize' ? 'webhook_not_configured' : 'WEBHOOK_NOT_CONFIGURED');
      }
      expectNoDataAccess(world);
    });
  });

  it.each([
    ['too short', hex(7)],
    ['placeholder', 'whsec_xxxxxxxxxxxxxxxxxxxx'],
    ['low variety', 'abababababababababababababababab'],
    ['whitespace', '                    '],
  ])('a %s HMAC secret disables the endpoint even for requests signed with it', async (_label, weak) => {
    const world = loadWorld({ MONEYHASH_WEBHOOK_SECRET: weak, FLEXXPAY_WEBHOOK_SECRET: weak, BILLER_WEBHOOK_SECRET: weak });
    const logs = captureLogs(world);
    const creds = { ...CONFIGURED, moneyhash: weak, flexxpay: weak, biller: weak };
    for (const route of ['moneyhash', 'flexxpay', 'biller'] as Route[]) {
      const raw = forgedBody(route);
      expect((await post(world, route, raw, authHeaders(route, raw, creds))).status).toBe(503);
    }
    expectNoDataAccess(world);
    if (weak.trim()) expect(logs()).not.toContain(weak); // names and rules only
  });

  it.each<[string, Record<string, string | undefined>]>([
    ['a short password', { NYMCARD_WEBHOOK_BASIC_PASSWORD: hex(15) }],
    ['a user containing ":"', { NYMCARD_WEBHOOK_BASIC_USER: 'flex:pay' }],
    ['a header name without a value', { NYMCARD_WEBHOOK_HEADER_NAME: 'apikey' }],
    ['only the legacy NYMCARD_WEBHOOK_SECRET', { ...NO_WEBHOOK_SECRETS, NYMCARD_WEBHOOK_SECRET: hex(32) }],
  ])('nymcard with %s refuses every request (503)', async (_label, overrides) => {
    const world = loadWorld(overrides);
    captureLogs(world);
    for (const route of NYMCARD_ROUTES) {
      const raw = forgedBody(route);
      expect((await post(world, route, raw, authHeaders(route, raw))).status).toBe(503);
    }
    expectNoDataAccess(world);
  });

  it('nymcard optional custom header is enforced when configured', async () => {
    const headerValue = hex(16);
    const world = loadWorld({ NYMCARD_WEBHOOK_HEADER_NAME: 'apikey', NYMCARD_WEBHOOK_HEADER_VALUE: headerValue });
    captureLogs(world);
    world.prisma.card.findUnique.mockResolvedValue(null);
    const raw = forgedBody('cardStatus');
    const auth = authHeaders('cardStatus', raw);
    expect((await post(world, 'cardStatus', raw, auth)).status).toBe(401);
    expect((await post(world, 'cardStatus', raw, { ...auth, apikey: hex(16) })).status).toBe(401);
    expect((await post(world, 'cardStatus', raw, { ...auth, apikey: headerValue })).status).toBe(202);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Malformed input from an authenticated sender
// ═══════════════════════════════════════════════════════════════════

describe('malformed authenticated input', () => {
  it('nymcard: invalid JSON or schema is a 400 — never a 500 that echoes payload text into logs', async () => {
    const logs = captureLogs(w);
    const canary = `CANARY${hex(8)}`;
    for (const raw of [`{"type": "${canary}`, JSON.stringify({ type: canary, data: {} })]) {
      const res = await post(w, 'transaction', raw, authHeaders('transaction', raw));
      expect(res.status).toBe(400);
    }
    const textPlain = await post(w, 'transaction', '{}', authHeaders('transaction', '{}'), 'text/plain');
    expect(textPlain.status).toBe(400);
    expect(logs()).not.toContain(canary);
    expectNoDataAccess(w);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. Logging hygiene
// ═══════════════════════════════════════════════════════════════════

describe('logging hygiene', () => {
  it('never logs secrets, signatures, credentials or financial payload values', async () => {
    const logs = captureLogs(w);
    const canary = `CANARY${hex(8)}`;
    const amount = 4321.987;
    const sent: string[] = [];
    const send = async (route: Route, raw: string, headers: Record<string, string>) => {
      sent.push(...Object.values(headers));
      return post(w, route, raw, headers);
    };
    w.prisma.card.findUnique.mockResolvedValue({ id: 'card-1', cardId: 'nym-1', employeeId: 'emp-1', dailyLimit: 1, monthlyLimit: 1, spentToday: 0, spentThisMonth: 0, updatedAt: new Date(), employee: { walletBalance: 1e6 } });
    w.prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1', plan: 'BASIC', walletBalance: 0 });
    w.prisma.employeeTransaction.findUnique.mockResolvedValue(null);
    const remittance = { id: 'txn-1', employeeId: 'emp-1', type: 'REMITTANCE', status: 'PENDING', totalAmount: amount, fee: 0, currency: 'AED', reference: 'tr' };
    w.prisma.employeeTransaction.findFirst.mockResolvedValue(remittance);
    w.prisma.__tx.employeeTransaction.findUnique.mockImplementation(async ({ where }: any) => (where.id ? remittance : null));
    w.prisma.__tx.employeeTransaction.create.mockResolvedValue({ id: 'refund-1' });
    w.prisma.loan.findFirst.mockResolvedValue(null);
    w.prisma.billPayment.findFirst.mockResolvedValue({ id: 'bp-1', status: 'PENDING' });

    const purchase = JSON.stringify({ type: 'transaction.settled', data: { id: uid('evt'), cardId: 'nym-1', amount, currency: 'AED', merchantName: canary, interchangeFeeAED: 1.5 } });
    await send('transaction', purchase, authHeaders('transaction', purchase));
    await send('transaction', purchase, { Authorization: basic(NYM_USER, canary) });
    const authz = JSON.stringify({ card_id: 'nym-1', amount, merchant_mcc: '5411', merchant_country: 'AE' });
    await send('authorize', authz, authHeaders('authorize', authz));
    await send('authorize', authz, { Authorization: basic(canary, canary) });
    const refund = JSON.stringify({ transferId: uid('tr'), status: 'failed', failureReason: canary });
    await send('moneyhash', refund, authHeaders('moneyhash', refund));
    await send('moneyhash', refund, authHeaders('moneyhash', refund)); // replay
    await send('moneyhash', refund, { 'MoneyHash-Signature': moneyHashHeader(refund, canary) });
    const loanUrl = JSON.stringify({ partnerReference: `https://flexxpay.example/redirect/${canary}?token=${canary}`, status: 'disbursed', disbursedAmount: amount });
    await send('flexxpay', loanUrl, authHeaders('flexxpay', loanUrl));
    await send('flexxpay', `{"partnerReference":"${canary}`, authHeaders('flexxpay', `{"partnerReference":"${canary}`));
    const bill = JSON.stringify({ externalRef: uid('rail'), status: 'failed', failureReason: canary });
    await send('biller', bill, authHeaders('biller', bill));
    const badBill = JSON.stringify({ externalRef: canary, status: canary });
    await send('biller', badBill, authHeaders('biller', badBill));

    const out = logs();
    const basicToken = basic(NYM_USER, NYM_PASSWORD).slice('Basic '.length);
    for (const forbidden of [NYM_PASSWORD, basicToken, MH_SECRET, FX_SECRET, BILLER_SECRET, canary, String(amount), ...sent]) {
      expect(out).not.toContain(forbidden);
    }
    // Signature hex values inside the MoneyHash header, individually.
    for (const value of sent.flatMap((h) => h.match(/[0-9a-f]{64}/g) ?? [])) {
      expect(out).not.toContain(value);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. Production startup gate — stub, sandbox and bypass modes
// ═══════════════════════════════════════════════════════════════════

const LIVE: Record<string, string> = {
  NYMCARD_API_KEY: hex(24),
  NYMCARD_API_BASE: 'https://api.nymcard.com/v1',
  MONEYHASH_API_KEY: hex(24),
  MONEYHASH_API_BASE: 'https://api.moneyhash.io/v1',
  FLEXXPAY_API_KEY: hex(24),
  FLEXXPAY_API_BASE: 'https://api.flexxpay.com/v1',
  MOHRE_API_BASE: 'https://api.mohre.gov.ae/v1',
  MOHRE_API_KEY: hex(24),
  TWILIO_ACCOUNT_SID: `AC${hex(16)}`,
  TWILIO_AUTH_TOKEN: hex(16),
  TWILIO_PHONE_NUMBER: '+971500000001',
};

describe('production integration gate', () => {
  const { productionIntegrationIssues, productionAdapterIssues } =
    jest.requireActual<typeof import('../src/config/integration-safety')>('../src/config/integration-safety');
  const liveConfig = () => ({
    ...LIVE,
    NYMCARD_WEBHOOK_BASIC_USER: NYM_USER,
    NYMCARD_WEBHOOK_BASIC_PASSWORD: NYM_PASSWORD,
    MONEYHASH_WEBHOOK_SECRET: MH_SECRET,
    FLEXXPAY_WEBHOOK_SECRET: FX_SECRET,
    BILLER_WEBHOOK_SECRET: BILLER_SECRET,
  });

  it('a complete live configuration passes', () => {
    expect(productionIntegrationIssues(liveConfig())).toEqual([]);
  });

  it.each<[string, string | undefined, RegExp]>([
    ['NYMCARD_API_KEY', undefined, /NYMCARD_API_KEY is required in production .*stub/],
    ['NYMCARD_API_BASE', 'https://sandbox.nymcard.com/v1', /NYMCARD_API_BASE points at a sandbox or test host/],
    ['MONEYHASH_API_KEY', '', /MONEYHASH_API_KEY is required in production/],
    ['MONEYHASH_API_BASE', 'http://api.moneyhash.io/v1', /MONEYHASH_API_BASE must use https/],
    ['FLEXXPAY_API_KEY', 'fxp_live_xxxxxxxxxxxxxxxx', /FLEXXPAY_API_KEY looks like a placeholder/],
    ['FLEXXPAY_API_BASE', 'https://staging.flexxpay.com/v1', /FLEXXPAY_API_BASE points at a sandbox or test host/],
    ['MOHRE_API_BASE', undefined, /MOHRE_API_BASE is required in production/],
    ['MOHRE_API_BASE', 'https://mohre-mock.internal/v1', /MOHRE_API_BASE points at a sandbox or test host/],
    ['TWILIO_AUTH_TOKEN', undefined, /TWILIO_AUTH_TOKEN is required in production/],
    ['MONEYHASH_WEBHOOK_SECRET', undefined, /MONEYHASH_WEBHOOK_SECRET is required/],
    ['FLEXXPAY_WEBHOOK_SECRET', 'your_secret_here_123', /FLEXXPAY_WEBHOOK_SECRET looks like a placeholder/],
    ['BILLER_WEBHOOK_SECRET', hex(4), /BILLER_WEBHOOK_SECRET must be at least 16 characters/],
    ['NYMCARD_WEBHOOK_BASIC_PASSWORD', hex(8), /NYMCARD_WEBHOOK_BASIC_PASSWORD must be at least 32 characters/],
  ])('flags %s=%s', (variable, value, expected) => {
    const issues = productionIntegrationIssues({ ...liveConfig(), [variable]: value });
    expect(issues).toEqual([expect.stringMatching(expected)]);
    if (value) expect(JSON.stringify(issues)).not.toContain(value);
  });

  it('env.ts refuses to load as production with the sandbox defaults, naming each problem', () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    spies.push(errors);
    expect(() => loadWorld({ ...NO_WEBHOOK_SECRETS, NODE_ENV: 'production' })).toThrow('Environment validation failed');
    const [message, issues] = errors.mock.calls[0] as [string, string[]];
    expect(message).toBe('Refusing to start in production: unsafe integration configuration');
    for (const name of ['NYMCARD_API_KEY', 'NYMCARD_API_BASE', 'MONEYHASH_API_BASE', 'FLEXXPAY_API_BASE', 'MOHRE_API_BASE', 'TWILIO_AUTH_TOKEN', 'NYMCARD_WEBHOOK_BASIC_PASSWORD', 'BILLER_WEBHOOK_SECRET']) {
      expect(issues.some((issue) => issue.startsWith(name))).toBe(true);
    }
  });

  it('env.ts refuses to load as production when one webhook secret is a placeholder — without printing it', () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    spies.push(errors);
    const placeholder = 'whsec_xxxxxxxxxxxxxxxxxxxx';
    expect(() => loadWorld({ ...LIVE, NODE_ENV: 'production', MONEYHASH_WEBHOOK_SECRET: placeholder })).toThrow(
      'Environment validation failed',
    );
    expect(JSON.stringify(errors.mock.calls)).toContain('MONEYHASH_WEBHOOK_SECRET looks like a placeholder');
    expect(JSON.stringify(errors.mock.calls)).not.toContain(placeholder);
  });

  it('a complete live configuration starts as production and still authenticates every webhook', async () => {
    const prod = loadWorld({ ...LIVE, NODE_ENV: 'production' });
    captureLogs(prod);
    expect(prod.env.NODE_ENV).toBe('production');
    prod.prisma.employeeTransaction.findFirst.mockResolvedValue(null);
    const raw = forgedBody('moneyhash');
    expect((await post(prod, 'moneyhash', raw)).status).toBe(401);
    expect((await post(prod, 'moneyhash', raw, authHeaders('moneyhash', raw))).status).toBe(202);
  });

  it('development may run stubs and sandboxes — but its webhooks still fail closed (see above)', () => {
    expect(() => loadWorld({ ...NO_WEBHOOK_SECRETS, NODE_ENV: 'development' })).not.toThrow();
  });

  it('the built-in biller stub blocks production until a real adapter is bound', () => {
    expect(productionAdapterIssues({ billerAdapterIsStub: true })).toEqual([
      'the bill-payment adapter is the built-in stub (no real biller rail is bound)',
    ]);
    jest.isolateModules(() => {
      const adapters = require('../src/modules/bill-payment/biller-adapter.service');
      expect(adapters.isStubBillerAdapter()).toBe(true);
      adapters.setBillerAdapter({ submit: jest.fn() });
      expect(adapters.isStubBillerAdapter()).toBe(false);
    });
    expect(productionAdapterIssues({ billerAdapterIsStub: false })).toEqual([]);
  });
});

describe('container image', () => {
  const dockerfile = readFileSync(join(__dirname, '..', 'Dockerfile'), 'utf8');
  const productionStage = dockerfile.slice(dockerfile.indexOf('AS production'));

  it('runs as production so the startup gates apply', () => {
    expect(productionStage).toMatch(/^ENV NODE_ENV=production$/m);
  });

  it('does not bake an example env file (NODE_ENV=development, sandbox URLs) into the image', () => {
    expect(productionStage).not.toMatch(/COPY\s+\.env/);
  });
});
