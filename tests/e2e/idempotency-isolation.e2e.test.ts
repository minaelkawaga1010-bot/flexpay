import { randomBytes } from 'crypto';
import request from 'supertest';
import { app } from '@/app';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { closeAllQueues } from '@config/bull';
import { generateAccessToken } from '@shared/utils/jwt';

/**
 * TASK-013 — HTTP idempotency isolation over the REAL app, PostgreSQL and
 * Redis. Proves the integrated stack (authenticate → idempotency) never
 * lets a cached response cross an authentication or user boundary, never
 * double-applies a financial effect on replay, and conflicts a reused key
 * with a changed payload. `npm run test:e2e` only.
 */

const PREFIX = '/api/v1';
const ids: string[] = [];
const uid = () => randomBytes(5).toString('hex');
const phone = () => `+97158${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

async function employee(balance: number): Promise<{ id: string; phone: string; token: string }> {
  const e = await prisma.employee.create({
    data: { phone: phone(), fullName: 'Idem E2E', plan: 'BASIC', status: 'ACTIVE', walletBalance: balance },
  });
  ids.push(e.id);
  return { id: e.id, phone: e.phone, token: generateAccessToken({ userId: e.id, role: 'employee' }) };
}

const balanceOf = async (id: string) =>
  (await prisma.employee.findUniqueOrThrow({ where: { id } })).walletBalance;

const transfer = (token: string | null, key: string | null, body: unknown) => {
  let r = request(app).post(`${PREFIX}/wallet/transfer`).set('Content-Type', 'application/json');
  if (token) r = r.set('Authorization', `Bearer ${token}`);
  if (key) r = r.set('Idempotency-Key', key);
  return r.send(body as object);
};

describe('idempotency isolation — real app + PostgreSQL + Redis (TASK-013)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await redisService.connect();
  });
  afterAll(async () => {
    await prisma.employeeTransaction.deleteMany({ where: { employeeId: { in: ids } } });
    await prisma.employee.deleteMany({ where: { id: { in: ids } } });
    await closeAllQueues();
    await redisService.disconnect();
    await prisma.$disconnect();
  });

  it('unauthenticated request with an Idempotency-Key is rejected by auth, never served from cache', async () => {
    const a = await employee(1000);
    const r = await employee(0);
    const key = `k-${uid()}`;

    // A performs and caches a transfer under the key.
    const first = await transfer(a.token, key, { recipientPhone: r.phone, amount: 100 });
    expect(first.status).toBe(200);

    // An unauthenticated caller replays the exact key — must hit the auth
    // wall (401), never A's cached response.
    const unauth = await transfer(null, key, { recipientPhone: r.phone, amount: 100 });
    expect(unauth.status).toBe(401);
    expect(unauth.body).not.toHaveProperty('transactionId');
    // A GET surface carrying a key is equally gated.
    const bal = await request(app).get(`${PREFIX}/wallet/balance`).set('Idempotency-Key', key);
    expect(bal.status).toBe(401);
  });

  it('a different user replaying the same key gets their own result, never the first user’s', async () => {
    const a = await employee(1000);
    const b = await employee(1000);
    const r = await employee(0);
    const key = `k-${uid()}`;

    const aRes = await transfer(a.token, key, { recipientPhone: r.phone, amount: 100 });
    expect(aRes.status).toBe(200);
    const rAfterA = await balanceOf(r.id);

    // B uses the SAME key. B is a different principal → isolated → B's own
    // transfer executes; B never receives A's cached transactionId.
    const bRes = await transfer(b.token, key, { recipientPhone: r.phone, amount: 100 });
    expect(bRes.status).toBe(200);
    expect(bRes.body.transactionId).not.toBe(aRes.body.transactionId);
    // Both transfers really happened (R credited by both), proving B was
    // not short-circuited with A's cached response.
    expect(await balanceOf(r.id)).toBe(rAfterA + 100);
    expect(await balanceOf(b.id)).toBeLessThan(1000);
  });

  it('authorized replay (same user, same key, same payload) applies the financial effect once', async () => {
    const a = await employee(1000);
    const r = await employee(0);
    const key = `k-${uid()}`;

    const first = await transfer(a.token, key, { recipientPhone: r.phone, amount: 100 });
    expect(first.status).toBe(200);
    const aAfter = await balanceOf(a.id);
    const rAfter = await balanceOf(r.id);

    const replay = await transfer(a.token, key, { recipientPhone: r.phone, amount: 100 });
    expect(replay.status).toBe(200);
    // No second debit / credit, and the recipient keeps exactly one credit.
    expect(await balanceOf(a.id)).toBe(aAfter);
    expect(await balanceOf(r.id)).toBe(rAfter);
    expect(await prisma.employeeTransaction.count({ where: { employeeId: a.id, type: 'TRANSFER' } })).toBe(1);
  });

  it('same key + a modified payload is a deterministic 409, with no second financial effect', async () => {
    const a = await employee(1000);
    const r = await employee(0);
    const key = `k-${uid()}`;

    expect((await transfer(a.token, key, { recipientPhone: r.phone, amount: 100 })).status).toBe(200);
    const rAfter = await balanceOf(r.id);

    const conflict = await transfer(a.token, key, { recipientPhone: r.phone, amount: 250 });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual({ error: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' });
    expect(await balanceOf(r.id)).toBe(rAfter); // the 250 never moved
  });

  it('concurrent identical requests credit the recipient exactly once', async () => {
    const a = await employee(1000);
    const r = await employee(0);
    const key = `k-${uid()}`;
    const body = { recipientPhone: r.phone, amount: 100 };

    const [one, two] = await Promise.all([transfer(a.token, key, body), transfer(a.token, key, body)]);
    const statuses = [one.status, two.status].sort();
    // One wins (200); the other is either an in-progress 409 or a 200 replay.
    expect(statuses[0]).toBe(200);
    expect([200, 409]).toContain(statuses[1]);
    expect(await balanceOf(r.id)).toBe(100); // credited once, never twice
    expect(await prisma.employeeTransaction.count({ where: { employeeId: a.id, type: 'TRANSFER' } })).toBe(1);
  });

  it('a failed request releases the key so a corrected retry can proceed', async () => {
    const a = await employee(1000);
    const key = `k-${uid()}`;

    // Recipient does not exist → 404, reservation released (non-2xx).
    const bad = await transfer(a.token, key, { recipientPhone: '+971500000000', amount: 100 });
    expect(bad.status).toBe(404);

    // Same key, now a valid recipient → not a replayed 404; executes.
    const r = await employee(0);
    const good = await transfer(a.token, key, { recipientPhone: r.phone, amount: 100 });
    expect(good.status).toBe(200);
    expect(await balanceOf(r.id)).toBe(100);
  });
});
