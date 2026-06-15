/**
 * Biller webhook — inbound rail confirmation tests.
 *
 * Mirrors the moneyhash-remittance webhook test pattern in
 * tests/webhooks.test.ts: HMAC gate, JSON guard, idempotent
 * settlement, append-only refund on failure, and replay no-ops.
 */

jest.mock('@config/env', () => ({
  env: {
    NODE_ENV: 'production',
    BILLER_WEBHOOK_SECRET: 'test-biller-secret',
  },
  isProd: true,
  isTest: false,
}));

jest.mock('@config/prisma', () => {
  return {
    prisma: {
      billPayment: { findFirst: jest.fn() },
    },
  };
});

jest.mock('@modules/bill-payment/bill-payment.service', () => ({
  settleBillPayment: jest.fn().mockResolvedValue(undefined),
  refundFailedBill: jest.fn().mockResolvedValue(undefined),
}));

import crypto from 'crypto';
import { BillPaymentStatus } from '@prisma/client';
import { prisma } from '@config/prisma';
import {
  refundFailedBill,
  settleBillPayment,
} from '@modules/bill-payment/bill-payment.service';
import { billerWebhook } from '../src/webhooks/biller.webhook';

const mocked = prisma as unknown as {
  billPayment: { findFirst: jest.Mock };
};

const SECRET = 'test-biller-secret';

function signedReq(body: unknown, secret = SECRET, withPrefix = false): any {
  const buf = Buffer.from(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(buf).digest('hex');
  return {
    body: buf,
    header: (name: string) =>
      name.toLowerCase() === 'x-biller-signature'
        ? withPrefix
          ? `sha256=${sig}`
          : sig
        : undefined,
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
    setImmediate(() => next());
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('BillerWebhook /status — signature gate', () => {
  it('rejects when signature is missing', async () => {
    const req: any = { body: Buffer.from('{}'), header: () => undefined };
    const res = buildRes();
    await expect(
      invokeRoute(billerWebhook.router, '/status', req, res),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects when signature is wrong', async () => {
    const body = { externalRef: 'rail-1', status: 'completed' };
    const wrongSig = crypto.createHmac('sha256', 'nope').update(JSON.stringify(body)).digest('hex');
    const req: any = {
      body: Buffer.from(JSON.stringify(body)),
      header: (n: string) => (n.toLowerCase() === 'x-biller-signature' ? wrongSig : undefined),
    };
    const res = buildRes();
    await expect(
      invokeRoute(billerWebhook.router, '/status', req, res),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('accepts sha256-prefixed signatures', async () => {
    mocked.billPayment.findFirst.mockResolvedValue({
      id: 'bp-1',
      externalRef: 'rail-prefix',
      status: BillPaymentStatus.PENDING,
    });

    const req = signedReq({ externalRef: 'rail-prefix', status: 'completed' }, SECRET, true);
    const res = buildRes();
    await invokeRoute(billerWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(200);
    expect(settleBillPayment).toHaveBeenCalled();
  });
});

describe('BillerWebhook /status — payload validation', () => {
  it('returns 400 on malformed JSON', async () => {
    const buf = Buffer.from('{not json');
    const sig = crypto.createHmac('sha256', SECRET).update(buf).digest('hex');
    const req: any = {
      body: buf,
      header: (n: string) => (n.toLowerCase() === 'x-biller-signature' ? sig : undefined),
    };
    const res = buildRes();
    await invokeRoute(billerWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'INVALID_JSON' }));
  });

  it('returns 400 on schema mismatch', async () => {
    const req = signedReq({ foo: 'bar' });
    const res = buildRes();
    await invokeRoute(billerWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'INVALID_PAYLOAD' }),
    );
  });
});

describe('BillerWebhook /status — routing', () => {
  it('completed: looks up by externalRef and calls settleBillPayment', async () => {
    mocked.billPayment.findFirst.mockResolvedValue({
      id: 'bp-1',
      externalRef: 'rail-ok',
      status: BillPaymentStatus.PENDING,
    });

    const req = signedReq({ externalRef: 'rail-ok', status: 'completed' });
    const res = buildRes();
    await invokeRoute(billerWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(200);
    expect(mocked.billPayment.findFirst).toHaveBeenCalledWith({
      where: { externalRef: 'rail-ok' },
    });
    expect(settleBillPayment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bp-1' }),
      'rail-ok',
    );
    expect(refundFailedBill).not.toHaveBeenCalled();
  });

  it('failed: calls refundFailedBill with the rail-reported reason and externalRef', async () => {
    mocked.billPayment.findFirst.mockResolvedValue({
      id: 'bp-fail',
      externalRef: 'rail-bad',
      status: BillPaymentStatus.PENDING,
    });

    const req = signedReq({
      externalRef: 'rail-bad',
      status: 'failed',
      failureReason: 'rail_timeout',
    });
    const res = buildRes();
    await invokeRoute(billerWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(200);
    expect(refundFailedBill).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bp-fail' }),
      'rail_timeout',
      'rail-bad',
    );
    expect(settleBillPayment).not.toHaveBeenCalled();
  });

  it('accepts the new-style { type, data } envelope', async () => {
    mocked.billPayment.findFirst.mockResolvedValue({
      id: 'bp-2',
      externalRef: 'rail-envelope',
      status: BillPaymentStatus.PENDING,
    });

    const req = signedReq({
      type: 'bill.completed',
      data: { externalRef: 'rail-envelope' },
    });
    const res = buildRes();
    await invokeRoute(billerWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(200);
    expect(settleBillPayment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bp-2' }),
      'rail-envelope',
    );
  });

  it('unknown externalRef returns 202 without service calls (no retry storm)', async () => {
    mocked.billPayment.findFirst.mockResolvedValue(null);

    const req = signedReq({ externalRef: 'rail-ghost', status: 'completed' });
    const res = buildRes();
    await invokeRoute(billerWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(202);
    expect(settleBillPayment).not.toHaveBeenCalled();
    expect(refundFailedBill).not.toHaveBeenCalled();
  });

  it('replay on a terminal row delegates to the service (which is idempotent)', async () => {
    mocked.billPayment.findFirst.mockResolvedValue({
      id: 'bp-done',
      externalRef: 'rail-done',
      status: BillPaymentStatus.COMPLETED,
    });

    const req = signedReq({ externalRef: 'rail-done', status: 'completed' });
    const res = buildRes();
    await invokeRoute(billerWebhook.router, '/status', req, res);

    // The webhook still 200s and delegates — the service's own
    // already-COMPLETED guard short-circuits without writes. This
    // mirrors the moneyhash pattern: the idempotency invariant
    // lives in the service, the webhook is a thin adapter.
    expect(res.statusCode).toBe(200);
    expect(settleBillPayment).toHaveBeenCalledTimes(1);
  });

  it('reversed maps to the refund flow (rail-side reversal)', async () => {
    mocked.billPayment.findFirst.mockResolvedValue({
      id: 'bp-rev',
      externalRef: 'rail-rev',
      status: BillPaymentStatus.PENDING,
    });

    const req = signedReq({ externalRef: 'rail-rev', status: 'reversed' });
    const res = buildRes();
    await invokeRoute(billerWebhook.router, '/status', req, res);

    expect(res.statusCode).toBe(200);
    expect(refundFailedBill).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bp-rev' }),
      'rail_reported_reversed',
      'rail-rev',
    );
  });
});
