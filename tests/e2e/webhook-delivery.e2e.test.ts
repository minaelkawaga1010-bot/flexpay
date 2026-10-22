import { createHash, createHmac, randomBytes } from 'crypto';
import express from 'express';
import request from 'supertest';
import { env } from '@config/env';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { errorHandler } from '@shared/middleware/error-handler';
import { moneyHashRemittanceWebhook } from '@webhooks/moneyhash-remittance.webhook';

/**
 * TASK-007 — webhook replay protection against a REAL Redis (atomic
 * SET NX EX, shared by every app instance) and a REAL PostgreSQL (unique
 * refund idempotency key). Requires live Postgres + Redis; runs only via
 * `npm run test:e2e`.
 *
 * Invariant under test: however a MoneyHash failure notice is duplicated —
 * the same signed delivery fired concurrently, re-signed retries racing
 * each other, or a replay hitting a second app instance — the employee's
 * wallet is credited exactly once and exactly one REFUND row exists.
 */

const PHONE = '+971509900701';
const RAW = { type: 'application/json', limit: '1mb' } as const;

function buildApp(router: express.Router, handler: express.ErrorRequestHandler): express.Express {
  const app = express();
  app.use('/webhooks/moneyhash', express.raw(RAW), router);
  app.use(handler);
  return app;
}

const app = buildApp(moneyHashRemittanceWebhook.router, errorHandler);

function sign(raw: string, t = Math.floor(Date.now() / 1000)): { header: string; v3: string } {
  const v3 = createHmac('sha256', env.MONEYHASH_WEBHOOK_SECRET as string)
    .update(Buffer.from(raw).toString('base64') + t)
    .digest('hex');
  return { header: `t=${t},v3=${v3}`, v3 };
}

const deliver = (target: express.Express, raw: string, header: string) =>
  request(target)
    .post('/webhooks/moneyhash/status')
    .set('Content-Type', 'application/json')
    .set('MoneyHash-Signature', header)
    .send(raw);

async function wipe() {
  const e = await prisma.employee.findUnique({ where: { phone: PHONE } });
  if (!e) return;
  await prisma.employeeTransaction.deleteMany({ where: { employeeId: e.id } });
  await prisma.employee.delete({ where: { id: e.id } });
}

describe('MoneyHash webhook delivery — real Redis + PostgreSQL (TASK-007)', () => {
  let employeeId: string;

  beforeAll(async () => {
    await prisma.$connect();
    await redisService.connect();
    await wipe();
    const employee = await prisma.employee.create({
      data: { phone: PHONE, fullName: 'Webhook Replay', plan: 'BASIC', status: 'ACTIVE', walletBalance: 0 },
    });
    employeeId = employee.id;
  });

  afterAll(async () => {
    await wipe();
    await redisService.disconnect();
    await prisma.$disconnect();
  });

  async function pendingRemittance(amount: number): Promise<string> {
    const transferId = `tr-e2e-${randomBytes(6).toString('hex')}`;
    await prisma.employeeTransaction.create({
      data: {
        employeeId,
        type: 'REMITTANCE',
        amount: -amount,
        totalAmount: amount,
        status: 'PENDING',
        reference: transferId,
      },
    });
    return transferId;
  }

  const balance = async () =>
    (await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).walletBalance;
  const refunds = (transferId: string) =>
    prisma.employeeTransaction.count({ where: { reference: transferId, type: 'REFUND' } });

  it('25 concurrent copies of one signed delivery: processed once, wallet credited once', async () => {
    const transferId = await pendingRemittance(250);
    const before = await balance();
    const raw = JSON.stringify({ transferId, status: 'failed' });
    const { header, v3 } = sign(raw);

    const responses = await Promise.all(Array.from({ length: 25 }, () => deliver(app, raw, header)));

    const processed = responses.filter((r) => r.status === 200 && !r.body.duplicate);
    const suppressed = responses.filter(
      (r) => r.status === 409 || (r.status === 200 && r.body.duplicate === true),
    );
    expect(processed).toHaveLength(1);
    expect(suppressed).toHaveLength(24);
    expect((await balance()) - before).toBe(250);
    expect(await refunds(transferId)).toBe(1);

    // The marker lives in the shared Redis, bounded by the signature's
    // own validity window (tolerance + future skew), not forever.
    const marker = `webhook:delivery:${createHash('sha256').update(`moneyhash:${v3}`).digest('hex')}`;
    expect(await redisService.get(marker)).toBe('done');
    const ttl = await redisService.client.ttl(marker);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(env.MONEYHASH_WEBHOOK_TOLERANCE_SECONDS + 60);
  });

  it('10 racing re-signed retries (distinct deliveries) still refund once — the DB unique key holds', async () => {
    const transferId = await pendingRemittance(100);
    const before = await balance();
    const raw = JSON.stringify({ transferId, status: 'failed' });
    const now = Math.floor(Date.now() / 1000);

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) => deliver(app, raw, sign(raw, now - i).header)),
    );

    // Each authenticates as a distinct delivery; losers of the DB race
    // either see the refund (200 no-op) or fail and are released for a
    // provider retry (5xx) — never a second credit.
    for (const r of responses) expect([200, 500]).toContain(r.status);
    expect((await balance()) - before).toBe(100);
    expect(await refunds(transferId)).toBe(1);
  });

  it('a delivery processed by one app instance is refused by another instance sharing Redis', async () => {
    const transferId = await pendingRemittance(40);
    const raw = JSON.stringify({ transferId, status: 'succeeded' });
    const { header } = sign(raw);
    expect((await deliver(app, raw, header)).body).toEqual({ received: true });

    let other!: { app: express.Express; redis: typeof redisService; prisma: typeof prisma };
    jest.isolateModules(() => {
      other = {
        app: buildApp(
          require('../../src/webhooks/moneyhash-remittance.webhook').moneyHashRemittanceWebhook.router,
          require('../../src/shared/middleware/error-handler').errorHandler,
        ),
        redis: require('../../src/config/redis').default,
        prisma: require('../../src/config/prisma').prisma,
      };
    });
    expect(other.redis).not.toBe(redisService); // a genuinely separate instance
    await other.redis.connect();
    try {
      const replay = await deliver(other.app, raw, header);
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual({ received: true, duplicate: true });
    } finally {
      await other.redis.disconnect();
      await other.prisma.$disconnect();
    }
    const row = await prisma.employeeTransaction.findFirstOrThrow({ where: { reference: transferId, type: 'REMITTANCE' } });
    expect(row.status).toBe('COMPLETED');
  });
});
