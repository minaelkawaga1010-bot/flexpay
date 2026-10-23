/**
 * Webhook handlers — unit tests.
 *
 * Tests the two production-grade webhook handlers in isolation:
 *
 *   src/webhooks/nymcard-card.webhook.ts
 *   src/webhooks/moneyhash-remittance.webhook.ts
 *
 * The handlers are exercised at the class-method level (rather than
 * through an Express server) so we don't have to spin up HTTP. The
 * Prisma client is mocked at the module boundary, matching the
 * pattern in tests/cashback.test.ts.
 *
 * What we verify:
 *   • Fail-closed authentication gate (TASK-007) — NymCard nCore Basic
 *     Auth, MoneyHash v3 signatures; rejects unsigned and tampered.
 *   • Idempotency — replayed events do not double-effect ledger / wallet.
 *   • Atomic happy path — all writes flow through a single $transaction.
 *   • Failed remittance triggers an append-only REFUND row + credits
 *     the wallet back. The original row is marked FAILED but its
 *     amounts are NOT mutated (the append-only invariant).
 *   • Remittance decisions are taken on the row re-read under the
 *     WALLET_DEBIT lock; a failure or reversal after COMPLETED never
 *     refunds — it is audited as a conflict (TASK-011).
 *   • Interchange-revenue audit log fires on positive-revenue events.
 *   • Card status enum coercion + unknown-card 202 ACK.
 */

// ───────────────────────────────────────────────────────────────────
// Mocks — Prisma + side-effect services
// ───────────────────────────────────────────────────────────────────

// env is captured at import time by the handler. Mock it so the
// webhook credentials and NODE_ENV are set at the moment the webhook
// module reads them, not just at test runtime. Credentials are random
// per run (TASK-007) — the verifiers refuse weak or fixed values.
jest.mock('@config/env', () => {
  const { randomBytes } = require('crypto');
  return {
    env: {
      NODE_ENV: 'production',
      MONEYHASH_WEBHOOK_SECRET: randomBytes(32).toString('hex'),
      MONEYHASH_WEBHOOK_TOLERANCE_SECONDS: 300,
      NYMCARD_WEBHOOK_BASIC_USER: 'flexpay-unit-test',
      NYMCARD_WEBHOOK_BASIC_PASSWORD: randomBytes(32).toString('hex'),
      WEBHOOK_REPLAY_TTL_SECONDS: 604800,
      REMITTANCE_FX_SPREAD: 0.005,
    },
    isProd: true,
    isTest: false,
  };
});

// Delivery replay markers live in Redis; a fresh store per test keeps
// tests that reuse a payload independent of each other.
jest.mock('@config/redis', () => {
  const store = new Map<string, string>();
  const redisService = {
    setIfAbsent: jest.fn(async (key: string, value: string) => {
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    __store: store,
  };
  return { __esModule: true, default: redisService, redisService };
});

jest.mock('@config/prisma', () => {
  const tx = {
    $queryRaw: jest.fn(),
    employee: { update: jest.fn() },
    employeeTransaction: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    card: { update: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  return {
    prisma: {
      employee: { findUnique: jest.fn() },
      employeeTransaction: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      card: { findUnique: jest.fn(), update: jest.fn() },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  };
});

jest.mock('@modules/cashback/cashback.service', () => ({
  cashbackService: { processCashback: jest.fn().mockResolvedValue(undefined) },
}));

import crypto from 'crypto';
import { env } from '@config/env';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { cashbackService } from '@modules/cashback/cashback.service';
import { nymCardCardWebhook } from '../src/webhooks/nymcard-card.webhook';
import { moneyHashRemittanceWebhook } from '../src/webhooks/moneyhash-remittance.webhook';

const mocked = prisma as unknown as {
  employee: { findUnique: jest.Mock };
  employeeTransaction: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  card: { findUnique: jest.Mock; update: jest.Mock };
  auditLog: { create: jest.Mock };
  $transaction: jest.Mock;
  __tx: {
    $queryRaw: jest.Mock;
    employee: { update: jest.Mock };
    employeeTransaction: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    card: { update: jest.Mock };
    auditLog: { create: jest.Mock };
  };
};

// ───────────────────────────────────────────────────────────────────
// Request stub builders
// ───────────────────────────────────────────────────────────────────

/** nCore Basic Auth header for the configured webhook credentials. */
function nymcardAuth(
  user = env.NYMCARD_WEBHOOK_BASIC_USER as string,
  password = env.NYMCARD_WEBHOOK_BASIC_PASSWORD as string,
): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` };
}

function buildReq(body: unknown, headers: Record<string, string> = nymcardAuth()): any {
  const buf = Buffer.from(JSON.stringify(body));
  return {
    body: buf,
    header: (name: string) => headers[name.toLowerCase()],
    headers,
  };
}

function buildRes(): { status: jest.Mock; json: jest.Mock; statusCode?: number } {
  const res: any = {};
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn(() => res);
  return res;
}

async function invokeRoute(router: any, path: string, req: any, res: any): Promise<void> {
  // The asyncHandler wraps the route handler with
  // `Promise.resolve(fn(...)).catch(next)`. To surface its thrown
  // errors as test-side rejections we wrap the call in a fresh
  // promise that resolves either via the success path (no error)
  // or via the error path (next(err)).
  const layer = router.stack.find((l: any) => l.route?.path === path);
  if (!layer) throw new Error(`route ${path} not registered`);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const next = (err?: unknown) => {
      if (settled) return;
      settled = true;
      if (err) reject(err as Error);
      else resolve();
    };
    handler(req, res, next);
    // Success path: handler completed without calling next(err). Give
    // the microtask queue one tick for the asyncHandler's .catch to
    // fire on rejection paths, then settle as success.
    setImmediate(() => next());
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (redisService as unknown as { __store: Map<string, string> }).__store.clear();
});

// ═══════════════════════════════════════════════════════════════════
// NymCard card webhook
// ═══════════════════════════════════════════════════════════════════

describe('NymCardCardWebhook /transaction', () => {
  const cardRow = {
    id: 'card-int-1',
    cardId: 'nym-ext-1',
    employeeId: 'emp-1',
    status: 'ACTIVE' as const,
    dailyLimit: 5_000,
    monthlyLimit: 50_000,
    spentToday: 100,
    spentThisMonth: 2_500,
    updatedAt: new Date(), // same UTC day → no rollover
  };

  const employeeRow = {
    id: 'emp-1',
    plan: 'BASIC' as const,
    walletBalance: 1_000,
  };

  function happyPathPayload() {
    return {
      type: 'transaction.settled',
      data: {
        id: 'nym-evt-1',
        cardId: 'nym-ext-1',
        amount: 250,
        currency: 'AED',
        interchangeFeeAED: 2.75,
        merchantName: 'Carrefour',
        merchantCategory: 'GROCERY',
      },
    };
  }

  it('rejects wrong Basic Auth credentials before any DB read', async () => {
    const req = buildReq(happyPathPayload(), nymcardAuth(undefined, 'wrong-password'));
    const res = buildRes();
    await expect(
      invokeRoute(nymCardCardWebhook.router, '/transaction', req, res),
    ).rejects.toMatchObject({ status: 401 });
    expect(mocked.card.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a request with no credentials', async () => {
    const req = buildReq(happyPathPayload(), {});
    const res = buildRes();
    await expect(
      invokeRoute(nymCardCardWebhook.router, '/transaction', req, res),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('processes a settled purchase atomically: txn + wallet decrement + interchange audit', async () => {
    mocked.card.findUnique.mockResolvedValue(cardRow);
    mocked.employee.findUnique.mockResolvedValue(employeeRow);
    mocked.employeeTransaction.findUnique.mockResolvedValue(null); // not a replay
    mocked.__tx.employeeTransaction.create.mockResolvedValue({ id: 'txn-1' });
    mocked.__tx.employee.update.mockResolvedValue({});
    mocked.__tx.card.update.mockResolvedValue({});
    mocked.__tx.auditLog.create.mockResolvedValue({});

    const req = buildReq(happyPathPayload());
    const res = buildRes();
    await invokeRoute(nymCardCardWebhook.router, '/transaction', req, res);

    expect(res.statusCode).toBe(200);
    // One $transaction wrapping everything
    expect(mocked.$transaction).toHaveBeenCalledTimes(1);
    // EmployeeTransaction created with NEGATIVE total (debit) + idempotency key namespaced
    const create = mocked.__tx.employeeTransaction.create.mock.calls[0][0].data;
    expect(create.totalAmount).toBe(-250);
    expect(create.amount).toBe(-250);
    expect(create.idempotencyKey).toBe('nymcard:transaction.settled:nym-evt-1');
    expect(create.type).toBe('CARD_PURCHASE');
    // Wallet decremented by the signed amount
    expect(mocked.__tx.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { walletBalance: { increment: -250 } },
    });
    // Interchange audit emitted (revenue > 0, not a refund)
    expect(mocked.__tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'INTERCHANGE_REVENUE_BOOKED',
        }),
      }),
    );
    // Cashback service called (outside the tx, per design)
    expect(cashbackService.processCashback).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: 'emp-1', amount: 250 }),
    );
  });

  it('idempotency: a replayed event short-circuits before opening a $transaction', async () => {
    mocked.card.findUnique.mockResolvedValue(cardRow);
    mocked.employee.findUnique.mockResolvedValue(employeeRow);
    mocked.employeeTransaction.findUnique.mockResolvedValue({ id: 'txn-prev' }); // replay!

    const req = buildReq(happyPathPayload());
    const res = buildRes();
    await invokeRoute(nymCardCardWebhook.router, '/transaction', req, res);

    expect(res.statusCode).toBe(200);
    expect(mocked.$transaction).not.toHaveBeenCalled();
    expect(cashbackService.processCashback).not.toHaveBeenCalled();
  });

  it('refund event credits the wallet back and does NOT book interchange', async () => {
    mocked.card.findUnique.mockResolvedValue(cardRow);
    mocked.employee.findUnique.mockResolvedValue(employeeRow);
    mocked.employeeTransaction.findUnique.mockResolvedValue(null);
    mocked.__tx.employeeTransaction.create.mockResolvedValue({ id: 'txn-refund' });

    const req = buildReq({
      type: 'transaction.refunded',
      data: {
        id: 'nym-evt-refund',
        cardId: 'nym-ext-1',
        amount: 80,
        currency: 'AED',
        interchangeFeeAED: 0,
      },
    });
    const res = buildRes();
    await invokeRoute(nymCardCardWebhook.router, '/transaction', req, res);

    expect(res.statusCode).toBe(200);
    const create = mocked.__tx.employeeTransaction.create.mock.calls[0][0].data;
    expect(create.type).toBe('REFUND');
    expect(create.amount).toBe(80); // POSITIVE — credit
    expect(create.totalAmount).toBe(80);
    expect(mocked.__tx.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { walletBalance: { increment: 80 } },
    });
    // Interchange audit NOT emitted on refunds
    expect(mocked.__tx.auditLog.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'INTERCHANGE_REVENUE_BOOKED' }),
      }),
    );
    // Cashback NOT issued on refunds
    expect(cashbackService.processCashback).not.toHaveBeenCalled();
  });

  it('authorized events ACK without touching the ledger', async () => {
    const req = buildReq({
      type: 'transaction.authorized',
      data: { id: 'nym-evt-auth', cardId: 'nym-ext-1', amount: 50, currency: 'AED' },
    });
    const res = buildRes();
    await invokeRoute(nymCardCardWebhook.router, '/transaction', req, res);

    expect(res.statusCode).toBe(200);
    expect(mocked.card.findUnique).not.toHaveBeenCalled();
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it('unknown card returns ACK without writes', async () => {
    mocked.card.findUnique.mockResolvedValue(null);

    const req = buildReq(happyPathPayload());
    const res = buildRes();
    await invokeRoute(nymCardCardWebhook.router, '/transaction', req, res);

    expect(res.statusCode).toBe(200);
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });
});

describe('NymCardCardWebhook /card-status', () => {
  it('coerces a recognised status, writes audit log, returns 200', async () => {
    mocked.card.findUnique.mockResolvedValue({ id: 'c1', cardId: 'nym-1', status: 'ACTIVE' });
    mocked.card.update.mockResolvedValue({});
    mocked.auditLog.create.mockResolvedValue({});

    const req = buildReq({ cardId: 'nym-1', status: 'BLOCKED' });
    const res = buildRes();
    await invokeRoute(nymCardCardWebhook.router, '/card-status', req, res);

    expect(res.statusCode).toBe(200);
    expect(mocked.card.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'BLOCKED' },
    });
    expect(mocked.auditLog.create).toHaveBeenCalled();
  });

  it('returns 202 for an unknown card (no retry storm)', async () => {
    mocked.card.findUnique.mockResolvedValue(null);

    const req = buildReq({ cardId: 'nym-unknown', status: 'BLOCKED' });
    const res = buildRes();
    await invokeRoute(nymCardCardWebhook.router, '/card-status', req, res);

    expect(res.statusCode).toBe(202);
  });
});

// ═══════════════════════════════════════════════════════════════════
// MoneyHash remittance webhook
// ═══════════════════════════════════════════════════════════════════

describe('MoneyHashRemittanceWebhook /status', () => {
  /**
   * Builds a request the way MoneyHash signs it (v3):
   * `MoneyHash-Signature: t=<unix>,v3=<hex HMAC-SHA256(base64(raw body) + t)>`.
   */
  function signedReq(body: unknown, secret = env.MONEYHASH_WEBHOOK_SECRET as string): any {
    const buf = Buffer.from(JSON.stringify(body));
    const t = Math.floor(Date.now() / 1000);
    const v3 = crypto.createHmac('sha256', secret).update(buf.toString('base64') + t).digest('hex');
    return {
      body: buf,
      header: (name: string) =>
        name.toLowerCase() === 'moneyhash-signature' ? `t=${t},v3=${v3}` : undefined,
    };
  }

  // Env is mocked at module-import time above — see jest.mock('@config/env').
  // The mocked env pins NODE_ENV='production' and the MoneyHash secret
  // so the signature gate runs strictly for these tests.

  /**
   * `findFirst` only routes the event by transferId. The decision
   * (TASK-011) is taken on the row re-read by id under the WALLET_DEBIT
   * lock, and a prior refund is looked up by its idempotency key — both
   * on the transaction client.
   */
  function givenRemittance(row: Record<string, unknown>, refund: unknown = null): void {
    const stored = { id: 'txn-orig', employeeId: 'emp-1', type: 'REMITTANCE', totalAmount: 500, fee: 5, currency: 'AED', ...row };
    mocked.employeeTransaction.findFirst.mockResolvedValue(stored);
    mocked.__tx.employeeTransaction.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id !== undefined ? stored : refund,
    );
  }

  /** pg_advisory_xact_lock(key, WALLET_DEBIT) ran first, then the decisive re-read. */
  function expectLockedReread(): void {
    expect(mocked.__tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mocked.__tx.$queryRaw.mock.calls[0].slice(1)).toEqual([expect.any(Number), 3]);
    expect(mocked.__tx.employeeTransaction.findUnique).toHaveBeenNthCalledWith(1, { where: { id: 'txn-orig' } });
    expect(mocked.__tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.__tx.employeeTransaction.findUnique.mock.invocationCallOrder[0],
    );
  }

  /** No status change, no refund row, no wallet movement. */
  function expectNoFinancialWrites(): void {
    expect(mocked.__tx.employeeTransaction.update).not.toHaveBeenCalled();
    expect(mocked.__tx.employeeTransaction.create).not.toHaveBeenCalled();
    expect(mocked.__tx.employee.update).not.toHaveBeenCalled();
    expect(mocked.employeeTransaction.update).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    mocked.__tx.$queryRaw.mockResolvedValue([{ locked: '' }]);
    mocked.__tx.employeeTransaction.findUnique.mockResolvedValue(null);
  });

  it('rejects when signature is missing entirely', async () => {
    const req: any = { body: Buffer.from('{}'), header: () => undefined };
    const res = buildRes();
    await expect(
      invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects when signature does not match', async () => {
    const req = signedReq({ transferId: 'tr-1', status: 'succeeded' }, 'wrong-secret');
    const res = buildRes();
    await expect(
      invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res),
    ).rejects.toMatchObject({ status: 401 });
    expect(mocked.employeeTransaction.findFirst).not.toHaveBeenCalled();
  });

  it('succeeded: marks the original COMPLETED + writes audit log inside one tx', async () => {
    givenRemittance({ status: 'PENDING', reference: 'tr-success' });
    mocked.__tx.employeeTransaction.update.mockResolvedValue({});
    mocked.__tx.auditLog.create.mockResolvedValue({});

    const req = signedReq({ transferId: 'tr-success', status: 'succeeded' });
    const res = buildRes();
    await invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(200);
    expect(mocked.$transaction).toHaveBeenCalledTimes(1);
    expectLockedReread();
    expect(mocked.__tx.employeeTransaction.create).not.toHaveBeenCalled();
    expect(mocked.__tx.employee.update).not.toHaveBeenCalled();
    expect(mocked.__tx.employeeTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'txn-orig' },
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
    expect(mocked.__tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'REMITTANCE_COMPLETED' }),
      }),
    );
  });

  it('failed: appends REFUND row + credits wallet + does NOT mutate original amounts', async () => {
    // totalAmount 500 = the original debit magnitude; no prior refund.
    givenRemittance({ status: 'PENDING', reference: 'tr-fail' });
    mocked.__tx.employeeTransaction.update.mockResolvedValue({});
    mocked.__tx.employeeTransaction.create.mockResolvedValue({ id: 'txn-refund' });
    mocked.__tx.employee.update.mockResolvedValue({});
    mocked.__tx.auditLog.create.mockResolvedValue({});

    const req = signedReq({
      transferId: 'tr-fail',
      status: 'failed',
      failureReason: 'beneficiary_account_invalid',
    });
    const res = buildRes();
    await invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(200);
    expect(mocked.$transaction).toHaveBeenCalledTimes(1);
    expectLockedReread();
    expect(mocked.__tx.employeeTransaction.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: 'moneyhash:refund:tr-fail' },
    });

    // Original marked FAILED — but no amount mutations in the update
    expect(mocked.__tx.employeeTransaction.update).toHaveBeenCalledTimes(1);
    const updateCall = mocked.__tx.employeeTransaction.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe('FAILED');
    expect(updateCall.data.amount).toBeUndefined();
    expect(updateCall.data.totalAmount).toBeUndefined();

    // Append-only refund row — exactly one
    expect(mocked.__tx.employeeTransaction.create).toHaveBeenCalledTimes(1);
    const refundCreate = mocked.__tx.employeeTransaction.create.mock.calls[0][0].data;
    expect(refundCreate.type).toBe('REFUND');
    expect(refundCreate.amount).toBe(500);
    expect(refundCreate.totalAmount).toBe(500);
    expect(refundCreate.idempotencyKey).toBe('moneyhash:refund:tr-fail');
    expect(refundCreate.reference).toBe('tr-fail');

    // Wallet credit-back — exactly once
    expect(mocked.__tx.employee.update).toHaveBeenCalledTimes(1);
    expect(mocked.__tx.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { walletBalance: { increment: 500 } },
    });

    expect(mocked.__tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'REMITTANCE_FAILED_AND_REFUNDED' }),
      }),
    );
  });

  it('failed (replay): if a refund row already exists, no second refund is created', async () => {
    // Prior refund found via the idempotency key lookup, under the lock
    givenRemittance({ status: 'PENDING', reference: 'tr-replay' }, { id: 'txn-refund-existing' });
    mocked.__tx.employeeTransaction.update.mockResolvedValue({});

    const req = signedReq({ transferId: 'tr-replay', status: 'failed' });
    const res = buildRes();
    await invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(200);
    expectLockedReread();
    expect(mocked.__tx.employeeTransaction.create).not.toHaveBeenCalled();
    expect(mocked.__tx.employee.update).not.toHaveBeenCalled();
  });

  it('succeeded → already COMPLETED: replay is a no-op', async () => {
    givenRemittance({ status: 'COMPLETED', reference: 'tr-already-done' });

    const req = signedReq({ transferId: 'tr-already-done', status: 'succeeded' });
    const res = buildRes();
    await invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(200);
    expectLockedReread();
    expectNoFinancialWrites();
    expect(mocked.__tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('success-after-failure conflict: audit-logged but NEVER auto-reconciled', async () => {
    // Already failed and refunded earlier
    givenRemittance({ status: 'FAILED', reference: 'tr-conflict' }, { id: 'txn-refund' });

    const req = signedReq({ transferId: 'tr-conflict', status: 'succeeded' });
    const res = buildRes();
    await invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(200);
    expectLockedReread();
    expectNoFinancialWrites();
    // Conflict surfaced in the same locked transaction that read the state
    expect(mocked.__tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'REMITTANCE_SUCCESS_AFTER_FAILURE_CONFLICT',
          metadata: expect.objectContaining({ currentStatus: 'FAILED', refundIssued: true }),
        }),
      }),
    );
  });

  // TASK-011: a remittance MoneyHash confirmed is never credited back.
  it.each(['failed', 'reversed'] as const)(
    '%s after COMPLETED: no refund, no wallet credit — conflict audited',
    async (status) => {
      givenRemittance({ status: 'COMPLETED', reference: 'tr-settled' });

      const req = signedReq({ transferId: 'tr-settled', status, failureReason: 'beneficiary_bank_returned' });
      const res = buildRes();
      await invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res);

      expect(res.statusCode).toBe(200);
      expectLockedReread();
      expectNoFinancialWrites();
      expect(mocked.__tx.auditLog.create).toHaveBeenCalledTimes(1);
      expect(mocked.__tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
        action: 'REMITTANCE_FAILURE_AFTER_COMPLETION_CONFLICT',
        resourceId: 'txn-orig',
        metadata: { currentStatus: 'COMPLETED', event: status, failureCode: 'beneficiary_bank_returned' },
      });
    },
  );

  it('decides on the row re-read under the lock, not on the earlier routing lookup', async () => {
    givenRemittance({ status: 'COMPLETED', reference: 'tr-race' });
    // The routing read saw PENDING; a success committed before the lock was granted.
    mocked.employeeTransaction.findFirst.mockResolvedValue({
      id: 'txn-orig', employeeId: 'emp-1', type: 'REMITTANCE', status: 'PENDING', totalAmount: 500, fee: 5, currency: 'AED', reference: 'tr-race',
    });

    const req = signedReq({ transferId: 'tr-race', status: 'failed' });
    const res = buildRes();
    await invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(200);
    expectLockedReread();
    expectNoFinancialWrites();
    expect(mocked.__tx.auditLog.create.mock.calls[0][0].data.action).toBe(
      'REMITTANCE_FAILURE_AFTER_COMPLETION_CONFLICT',
    );
  });

  it('conflict audits carry identifiers and codes only — no free text or amounts', async () => {
    givenRemittance({ status: 'COMPLETED', reference: 'tr-audit' });

    const req = signedReq({
      transferId: 'tr-audit',
      status: 'reversed',
      providerReference: 'mh-prov-9',
      failureReason: 'Account of Test Person, IBAN AE00 0000 0000 0000 0000 000, closed',
    });
    const res = buildRes();
    await invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res);

    expect(mocked.__tx.auditLog.create.mock.calls[0][0].data.metadata).toEqual({
      transferId: 'tr-audit',
      providerReference: 'mh-prov-9',
      currentStatus: 'COMPLETED',
      event: 'reversed',
      failureCode: 'unspecified',
      detectedUnderLock: true,
    });
  });

  it('unknown transferId returns 202 (no retry storm) without DB writes', async () => {
    mocked.employeeTransaction.findFirst.mockResolvedValue(null);
    const req = signedReq({ transferId: 'tr-unknown', status: 'succeeded' });
    const res = buildRes();
    await invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(202);
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it('accepts the new-style { type, data } payload variant', async () => {
    givenRemittance({ status: 'PENDING', reference: 'tr-new-style' });
    mocked.__tx.employeeTransaction.update.mockResolvedValue({});
    mocked.__tx.auditLog.create.mockResolvedValue({});

    const req = signedReq({
      type: 'transfer.succeeded',
      data: { transferId: 'tr-new-style', providerReference: 'mh-prov-1' },
    });
    const res = buildRes();
    await invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(200);
    expect(mocked.__tx.employeeTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
  });

  it("rejects the legacy x-moneyhash-signature header — not MoneyHash's protocol", async () => {
    // Pre-TASK-007 the handler accepted a bare hex HMAC of the body in a
    // header MoneyHash never sends. Even correctly keyed, it is refused.
    const buf = Buffer.from(JSON.stringify({ transferId: 'tr-legacy', status: 'failed' }));
    const legacy = crypto
      .createHmac('sha256', env.MONEYHASH_WEBHOOK_SECRET as string)
      .update(buf)
      .digest('hex');
    const req: any = {
      body: buf,
      header: (n: string) => (n.toLowerCase() === 'x-moneyhash-signature' ? `sha256=${legacy}` : undefined),
    };
    const res = buildRes();
    await expect(
      invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res),
    ).rejects.toMatchObject({ status: 401 });
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });
});
