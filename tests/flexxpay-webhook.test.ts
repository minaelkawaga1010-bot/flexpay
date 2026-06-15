/**
 * FlexxPay status webhook — security hardening regression.
 *
 * Pins the audit fix: the loan-state-mutating webhook now requires a
 * valid HMAC, Zod-validates the payload, and guards the JSON parse —
 * matching the NymCard / MoneyHash webhooks. Previously it accepted
 * unauthenticated, unvalidated input and could flip any loan's status.
 */

jest.mock('@config/env', () => ({
  env: {
    NODE_ENV: 'production',
    FLEXXPAY_WEBHOOK_SECRET: 'flexxpay-test-secret',
  },
}));

jest.mock('@config/prisma', () => ({
  prisma: {
    loan: { findFirst: jest.fn(), update: jest.fn() },
  },
}));

import crypto from 'crypto';
import { prisma } from '@config/prisma';
import { flexxpayWebhook } from '../src/webhooks/flexxpay.webhook';

const mocked = prisma as unknown as {
  loan: { findFirst: jest.Mock; update: jest.Mock };
};

const SECRET = 'flexxpay-test-secret';

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

beforeEach(() => jest.clearAllMocks());

describe('FlexxPayWebhook /status', () => {
  const validBody = { partnerReference: 'pr-1', status: 'disbursed', disbursedAmount: 500 };

  it('rejects a missing signature with 401', async () => {
    const req: any = { body: Buffer.from('{}'), header: () => undefined };
    const res = buildRes();
    await expect(invoke(req, res)).rejects.toMatchObject({ status: 401 });
    expect(mocked.loan.update).not.toHaveBeenCalled();
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
    mocked.loan.update.mockResolvedValue({});
    const req = signedReq(validBody);
    const res = buildRes();
    await invoke(req, res);
    expect(res.statusCode).toBe(200);
    expect(mocked.loan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'loan-1' },
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
    expect(mocked.loan.update).not.toHaveBeenCalled();
  });
});
