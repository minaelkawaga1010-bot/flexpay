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
 *   • Strict HMAC signature gate — rejects unsigned and tampered.
 *   • Idempotency — replayed events do not double-effect ledger / wallet.
 *   • Atomic happy path — all writes flow through a single $transaction.
 *   • Failed remittance triggers an append-only REFUND row + credits
 *     the wallet back. The original row is marked FAILED but its
 *     amounts are NOT mutated (the append-only invariant).
 *   • Interchange-revenue audit log fires on positive-revenue events.
 *   • Card status enum coercion + unknown-card 202 ACK.
 */

// ───────────────────────────────────────────────────────────────────
// Mocks — Prisma + side-effect services
// ───────────────────────────────────────────────────────────────────

// env is captured at import time by the handler. Mock it so the
// MoneyHash secret and NODE_ENV are set at the moment the webhook
// module reads them, not just at test runtime.
jest.mock('@config/env', () => ({
  env: {
    NODE_ENV: 'production',
    MONEYHASH_WEBHOOK_SECRET: 'test-secret',
    NYMCARD_WEBHOOK_SECRET: 'test-secret',
    WEBHOOK_SIGNATURE_HEADER: 'x-nymcard-signature',
    REMITTANCE_FX_SPREAD: 0.005,
  },
  isProd: true,
  isTest: false,
}));

jest.mock('@config/prisma', () => {
  const tx = {
    employee: { update: jest.fn() },
    employeeTransaction: { create: jest.fn(), update: jest.fn() },
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

// We mock the nymcardService signature verifier so the test controls
// the verdict directly — the verifier's own HMAC math is exercised by
// nymcard service-level tests (out of scope here).
jest.mock('@modules/cards/nymcard.service', () => ({
  nymcardService: { verifyWebhookSignature: jest.fn() },
}));

import crypto from 'crypto';
import { prisma } from '@config/prisma';
import { nymcardService } from '@modules/cards/nymcard.service';
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
    employee: { update: jest.Mock };
    employeeTransaction: { create: jest.Mock; update: jest.Mock };
    card: { update: jest.Mock };
    auditLog: { create: jest.Mock };
  };
};

// ───────────────────────────────────────────────────────────────────
// Request stub builders
// ───────────────────────────────────────────────────────────────────

function buildReq(body: unknown, headers: Record<string, string> = {}): any {
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

  it('rejects when HMAC signature is invalid', async () => {
    (nymcardService.verifyWebhookSignature as jest.Mock).mockReturnValue(false);
    const req = buildReq(happyPathPayload());
    const res = buildRes();
    await expect(
      invokeRoute(nymCardCardWebhook.router, '/transaction', req, res),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('processes a settled purchase atomically: txn + wallet decrement + interchange audit', async () => {
    (nymcardService.verifyWebhookSignature as jest.Mock).mockReturnValue(true);
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
    (nymcardService.verifyWebhookSignature as jest.Mock).mockReturnValue(true);
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
    (nymcardService.verifyWebhookSignature as jest.Mock).mockReturnValue(true);
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
    (nymcardService.verifyWebhookSignature as jest.Mock).mockReturnValue(true);
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
    (nymcardService.verifyWebhookSignature as jest.Mock).mockReturnValue(true);
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
    (nymcardService.verifyWebhookSignature as jest.Mock).mockReturnValue(true);
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
    (nymcardService.verifyWebhookSignature as jest.Mock).mockReturnValue(true);
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
  const SECRET = 'test-secret';

  /**
   * Builds a request with a valid HMAC. Mirrors what MoneyHash
   * would send: hex-encoded sha256 of the raw body, optionally
   * prefixed with `sha256=`.
   */
  function signedReq(body: unknown, secret = SECRET, withPrefix = false): any {
    const buf = Buffer.from(JSON.stringify(body));
    const sig = crypto.createHmac('sha256', secret).update(buf).digest('hex');
    return {
      body: buf,
      header: (name: string) =>
        name.toLowerCase() === 'x-moneyhash-signature'
          ? withPrefix
            ? `sha256=${sig}`
            : sig
          : undefined,
    };
  }

  // Env is mocked at module-import time above — see jest.mock('@config/env').
  // The mocked env pins NODE_ENV='production' and the MoneyHash secret
  // so the signature gate runs strictly for these tests.

  it('rejects when signature is missing entirely', async () => {
    const req: any = { body: Buffer.from('{}'), header: () => undefined };
    const res = buildRes();
    await expect(
      invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects when signature does not match', async () => {
    const body = { transferId: 'tr-1', status: 'succeeded' };
    const wrongSig = crypto.createHmac('sha256', 'wrong-secret').update(JSON.stringify(body)).digest('hex');
    const req: any = {
      body: Buffer.from(JSON.stringify(body)),
      header: (n: string) => (n.toLowerCase() === 'x-moneyhash-signature' ? wrongSig : undefined),
    };
    const res = buildRes();
    await expect(
      invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('succeeded: marks the original COMPLETED + writes audit log inside one tx', async () => {
    mocked.employeeTransaction.findFirst.mockResolvedValue({
      id: 'txn-orig',
      employeeId: 'emp-1',
      status: 'PENDING',
      totalAmount: 500,
      fee: 5,
      currency: 'AED',
      reference: 'tr-success',
    });
    mocked.__tx.employeeTransaction.update.mockResolvedValue({});
    mocked.__tx.auditLog.create.mockResolvedValue({});

    const req = signedReq({ transferId: 'tr-success', status: 'succeeded' });
    const res = buildRes();
    await invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(200);
    expect(mocked.$transaction).toHaveBeenCalledTimes(1);
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
    mocked.employeeTransaction.findFirst.mockResolvedValue({
      id: 'txn-orig',
      employeeId: 'emp-1',
      status: 'PENDING',
      totalAmount: 500, // original debit magnitude
      fee: 5,
      currency: 'AED',
      reference: 'tr-fail',
    });
    mocked.employeeTransaction.findUnique.mockResolvedValue(null); // no prior refund
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

    // Original marked FAILED — but no amount mutations in the update
    const updateCall = mocked.__tx.employeeTransaction.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe('FAILED');
    expect(updateCall.data.amount).toBeUndefined();
    expect(updateCall.data.totalAmount).toBeUndefined();

    // Append-only refund row
    const refundCreate = mocked.__tx.employeeTransaction.create.mock.calls[0][0].data;
    expect(refundCreate.type).toBe('REFUND');
    expect(refundCreate.amount).toBe(500);
    expect(refundCreate.totalAmount).toBe(500);
    expect(refundCreate.idempotencyKey).toBe('moneyhash:refund:tr-fail');
    expect(refundCreate.reference).toBe('tr-fail');

    // Wallet credit-back
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
    mocked.employeeTransaction.findFirst.mockResolvedValue({
      id: 'txn-orig',
      employeeId: 'emp-1',
      status: 'PENDING',
      totalAmount: 500,
      fee: 5,
      currency: 'AED',
      reference: 'tr-replay',
    });
    // Prior refund found via the idempotency key lookup
    mocked.employeeTransaction.findUnique.mockResolvedValue({ id: 'txn-refund-existing' });

    const req = signedReq({ transferId: 'tr-replay', status: 'failed' });
    const res = buildRes();
    await invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(200);
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it('succeeded → already COMPLETED: replay is a no-op', async () => {
    mocked.employeeTransaction.findFirst.mockResolvedValue({
      id: 'txn-orig',
      employeeId: 'emp-1',
      status: 'COMPLETED',
      totalAmount: 500,
      fee: 5,
      currency: 'AED',
      reference: 'tr-already-done',
    });

    const req = signedReq({ transferId: 'tr-already-done', status: 'succeeded' });
    const res = buildRes();
    await invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(200);
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it('success-after-failure conflict: audit-logged but NEVER auto-reconciled', async () => {
    mocked.employeeTransaction.findFirst.mockResolvedValue({
      id: 'txn-orig',
      employeeId: 'emp-1',
      status: 'FAILED', // already refunded earlier
      totalAmount: 500,
      fee: 5,
      currency: 'AED',
      reference: 'tr-conflict',
    });
    mocked.auditLog.create.mockResolvedValue({});

    const req = signedReq({ transferId: 'tr-conflict', status: 'succeeded' });
    const res = buildRes();
    await invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(200);
    expect(mocked.$transaction).not.toHaveBeenCalled();
    // Conflict surfaced via top-level audit log, NOT inside a tx
    expect(mocked.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'REMITTANCE_SUCCESS_AFTER_FAILURE_CONFLICT',
        }),
      }),
    );
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
    mocked.employeeTransaction.findFirst.mockResolvedValue({
      id: 'txn-orig',
      employeeId: 'emp-1',
      status: 'PENDING',
      totalAmount: 500,
      fee: 5,
      currency: 'AED',
      reference: 'tr-new-style',
    });
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

  it('accepts sha256-prefixed signatures (MoneyHash transport variant)', async () => {
    mocked.employeeTransaction.findFirst.mockResolvedValue({
      id: 'txn-orig',
      employeeId: 'emp-1',
      status: 'PENDING',
      totalAmount: 500,
      fee: 5,
      currency: 'AED',
      reference: 'tr-prefixed',
    });
    mocked.__tx.employeeTransaction.update.mockResolvedValue({});
    mocked.__tx.auditLog.create.mockResolvedValue({});

    const req = signedReq({ transferId: 'tr-prefixed', status: 'succeeded' }, SECRET, true);
    const res = buildRes();
    await invokeRoute(moneyHashRemittanceWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(200);
    expect(mocked.$transaction).toHaveBeenCalledTimes(1);
  });
});
