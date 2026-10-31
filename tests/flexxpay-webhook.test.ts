/**
 * FlexxPay status webhook — security hardening regression.
 *
 * Pins the audit fix: the loan-state-mutating webhook now requires a
 * valid HMAC, Zod-validates the payload, and guards the JSON parse —
 * matching the NymCard / MoneyHash webhooks. Previously it accepted
 * unauthenticated, unvalidated input and could flip any loan's status.
 */

// Random per run (TASK-007): the verifier refuses weak or fixed secrets.
jest.mock('@config/env', () => ({
  env: {
    NODE_ENV: 'production',
    FLEXXPAY_WEBHOOK_SECRET: require('crypto').randomBytes(32).toString('hex'),
    WEBHOOK_REPLAY_TTL_SECONDS: 604800,
  },
}));

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

jest.mock('@config/prisma', () => ({
  prisma: {
    loan: { findFirst: jest.fn(), updateMany: jest.fn() },
  },
}));

import crypto from 'crypto';
import { env } from '@config/env';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { flexxpayWebhook } from '../src/webhooks/flexxpay.webhook';

const mocked = prisma as unknown as {
  loan: { findFirst: jest.Mock; updateMany: jest.Mock };
};

const SECRET = env.FLEXXPAY_WEBHOOK_SECRET as string;

function signedReq(body: unknown, secret = SECRET): any {
  const buf = Buffer.from(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(buf).digest('hex');
  return {
    body: buf,
    header: (n: string) => (n.toLowerCase() === 'x-flexxpay-signature' ? sig : undefined),
  };
}

function buildRes(): any {
  const res: any = {};
  res.status = jest.fn((c: number) => {
    res.statusCode = c;
    return res;
  });
  res.json = jest.fn((b: unknown) => {
    res.body = b;
    return res;
  });
  return res;
}

async function invoke(req: any, res: any): Promise<void> {
  const layer: any = flexxpayWebhook.router.stack.find((l: any) => l.route?.path === '/status');
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
    setImmediate(() => next());
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (redisService as unknown as { __store: Map<string, string> }).__store.clear();
});

describe('FlexxPayWebhook /status', () => {
  const validBody = { partnerReference: 'pr-1', status: 'disbursed', disbursedAmount: 500 };

  it('rejects a missing signature with 401', async () => {
    const req: any = { body: Buffer.from('{}'), header: () => undefined };
    const res = buildRes();
    await expect(invoke(req, res)).rejects.toMatchObject({ status: 401 });
    expect(mocked.loan.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a tampered signature with 401', async () => {
    const body = validBody;
    const wrong = crypto.createHmac('sha256', 'wrong').update(JSON.stringify(body)).digest('hex');
    const req: any = {
      body: Buffer.from(JSON.stringify(body)),
      header: (n: string) => (n.toLowerCase() === 'x-flexxpay-signature' ? wrong : undefined),
    };
    const res = buildRes();
    await expect(invoke(req, res)).rejects.toMatchObject({ status: 401 });
  });

  it('400s a malformed JSON body (guarded parse, no unhandled throw)', async () => {
    const buf = Buffer.from('not-json');
    const sig = crypto.createHmac('sha256', SECRET).update(buf).digest('hex');
    const req: any = {
      body: buf,
      header: (n: string) => (n.toLowerCase() === 'x-flexxpay-signature' ? sig : undefined),
    };
    const res = buildRes();
    await invoke(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'INVALID_JSON' });
  });

  it('400s an invalid payload (unknown status enum)', async () => {
    const req = signedReq({ partnerReference: 'pr-1', status: 'totally-bogus' });
    const res = buildRes();
    await invoke(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'INVALID_PAYLOAD' });
  });

  it('updates the loan to ACTIVE on a signed, valid disbursed event', async () => {
    mocked.loan.findFirst.mockResolvedValue({
      id: 'loan-1',
      status: 'APPROVED',
      disbursedAmount: null,
      disbursedAt: null,
      disbursementTxnId: null,
    });
    mocked.loan.updateMany.mockResolvedValue({ count: 1 });
    const req = signedReq(validBody);
    const res = buildRes();
    await invoke(req, res);
    expect(res.statusCode).toBe(200);
    // Compare-and-set on the status that was read.
    expect(mocked.loan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'loan-1', status: 'APPROVED' },
        data: expect.objectContaining({ status: 'ACTIVE', disbursedAmount: 500 }),
      }),
    );
  });

  it('202s an unknown partnerReference without writing (no retry storm)', async () => {
    mocked.loan.findFirst.mockResolvedValue(null);
    const req = signedReq(validBody);
    const res = buildRes();
    await invoke(req, res);
    expect(res.statusCode).toBe(202);
    expect(mocked.loan.updateMany).not.toHaveBeenCalled();
  });
});

describe('FlexxPayWebhook /status — forward-only loan transitions (TASK-007)', () => {
  const loanIn = (status: string) => ({
    id: 'loan-1',
    status,
    disbursedAmount: 500,
    disbursedAt: new Date('2026-01-01T00:00:00Z'),
    disbursementTxnId: 'fx-txn-1',
  });

  it.each([
    ['REPAID', 'disbursed'],
    ['REPAID', 'defaulted'],
    ['REJECTED', 'approved'],
    ['ACTIVE', 'approved'],
    ['DEFAULTED', 'disbursed'],
  ])('ignores a stale event: %s loan + %s → no write, 200', async (current, event) => {
    mocked.loan.findFirst.mockResolvedValue(loanIn(current));
    const res = buildRes();
    await invoke(signedReq({ partnerReference: 'pr-1', status: event }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true, ignored: 'STALE_OR_INVALID_TRANSITION' });
    expect(mocked.loan.updateMany).not.toHaveBeenCalled();
  });

  it('re-delivery of an applied status is a no-op (no write)', async () => {
    mocked.loan.findFirst.mockResolvedValue(loanIn('ACTIVE'));
    const res = buildRes();
    await invoke(signedReq({ partnerReference: 'pr-1', status: 'disbursed', disbursedAmount: 999 }), res);
    expect(res.statusCode).toBe(200);
    expect(mocked.loan.updateMany).not.toHaveBeenCalled();
  });

  it('an event that arrives ahead of its predecessor is 409 (retry), not applied', async () => {
    mocked.loan.findFirst.mockResolvedValue(loanIn('PENDING'));
    const res = buildRes();
    await expect(invoke(signedReq({ partnerReference: 'pr-1', status: 'repaid' }), res)).rejects.toMatchObject({
      status: 409,
      code: 'EVENT_OUT_OF_ORDER',
    });
    expect(mocked.loan.updateMany).not.toHaveBeenCalled();
  });

  it('applies DEFAULTED → REPAID (late repayment)', async () => {
    mocked.loan.findFirst.mockResolvedValue(loanIn('DEFAULTED'));
    mocked.loan.updateMany.mockResolvedValue({ count: 1 });
    const res = buildRes();
    await invoke(signedReq({ partnerReference: 'pr-1', status: 'repaid' }), res);
    expect(res.statusCode).toBe(200);
    expect(mocked.loan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'loan-1', status: 'DEFAULTED' }, data: expect.objectContaining({ status: 'REPAID' }) }),
    );
  });

  it('a concurrent status change (compare-and-set miss) is 409 so the provider retries', async () => {
    mocked.loan.findFirst.mockResolvedValue(loanIn('ACTIVE'));
    mocked.loan.updateMany.mockResolvedValue({ count: 0 });
    const res = buildRes();
    await expect(invoke(signedReq({ partnerReference: 'pr-1', status: 'repaid' }), res)).rejects.toMatchObject({
      status: 409,
      code: 'CONCURRENT_UPDATE',
    });
  });
});
