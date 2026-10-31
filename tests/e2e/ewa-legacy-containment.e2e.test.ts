import { randomBytes } from 'crypto';
import request from 'supertest';
import { app } from '@/app';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { closeAllQueues } from '@config/bull';
import { generateAccessToken } from '@shared/utils/jwt';
import { creditScoringService } from '@modules/scoring/scoring.service';
import { flexxPayService } from '@modules/ewa/flexxpay.service';

/**
 * TASK-014 — the legacy POST /api/v1/ewa/request issuance path is contained:
 * it must create no advance/loan, submit no external credit request, move no
 * wallet balance, and write no ledger entry, for every request variation.
 *
 * This same suite is the pre-fix detector: against the pre-TASK-014 tree it
 * FAILS (the endpoint, with eligibility stubbed, creates unbounded PENDING
 * Loan rows with no cumulative cap and calls the provider), and PASSES on the
 * contained route (410 Gone before any side effect). Real app + PostgreSQL +
 * Redis; `npm run test:e2e` only.
 */

const PREFIX = '/api/v1';
const ids: string[] = [];
const uid = () => randomBytes(5).toString('hex');
const phone = () => `+97159${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

async function employee(balance = 500): Promise<{ id: string; token: string }> {
  const e = await prisma.employee.create({
    data: { phone: phone(), fullName: 'EWA Legacy E2E', plan: 'BASIC', status: 'ACTIVE', walletBalance: balance },
  });
  ids.push(e.id);
  return { id: e.id, token: generateAccessToken({ userId: e.id, role: 'employee' }) };
}

const ELIGIBLE = {
  score: 80,
  breakdown: { base: 50, transactions: 10, balance: 10, referrals: 10, defaults: 0 },
  eligibleForEWA: true,
  maxEWAAmount: 500,
  computedAt: new Date(),
  nextReviewAt: new Date(Date.now() + 86_400_000),
};

const ewaState = async (employeeId: string) => ({
  loans: await prisma.loan.count({ where: { employeeId } }),
  advances: await prisma.advance.count({ where: { employeeId } }),
  ledger: await prisma.ledgerEntry.count({ where: { employeeId } }),
  txns: await prisma.employeeTransaction.count({ where: { employeeId } }),
  wallet: (await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).walletBalance,
});

const post = (token: string | null, body: unknown, key?: string) => {
  let r = request(app).post(`${PREFIX}/ewa/request`).set('Content-Type', 'application/json');
  if (token) r = r.set('Authorization', `Bearer ${token}`);
  if (key) r = r.set('Idempotency-Key', key);
  return r.send(body as object);
};

describe('legacy EWA endpoint containment — real app + PostgreSQL (TASK-014)', () => {
  // Eligibility and the provider are stubbed so that, were issuance still
  // enabled (pre-fix), the endpoint WOULD create loans and call the rail —
  // isolating the test from FlexScore internals (out of scope) and proving
  // the containment is what stops issuance, not a failed eligibility check.
  let scoreSpy: jest.SpyInstance;
  let railSpy: jest.SpyInstance;

  beforeAll(async () => {
    await prisma.$connect();
    await redisService.connect();
  });
  beforeEach(() => {
    scoreSpy = jest.spyOn(creditScoringService, 'computeScore').mockResolvedValue({ ...ELIGIBLE });
    railSpy = jest.spyOn(flexxPayService, 'createAdvanceRequest').mockResolvedValue('https://stub/redirect/x');
  });
  afterEach(() => {
    scoreSpy.mockRestore();
    railSpy.mockRestore();
  });
  afterAll(async () => {
    await prisma.loan.deleteMany({ where: { employeeId: { in: ids } } });
    await prisma.employeeTransaction.deleteMany({ where: { employeeId: { in: ids } } });
    await prisma.employee.deleteMany({ where: { id: { in: ids } } });
    await closeAllQueues();
    await redisService.disconnect();
    await prisma.$disconnect();
  });

  it('an authenticated request is refused (410) with no loan, no external call, no wallet/ledger effect', async () => {
    const a = await employee();
    const before = await ewaState(a.id);

    const res = await post(a.token, { amount: 400 });

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('EWA_LEGACY_ENDPOINT_DISABLED');
    expect(railSpy).not.toHaveBeenCalled(); // no external credit request
    expect(await ewaState(a.id)).toEqual(before); // no loan/advance/ledger/txn/wallet change
    expect((await ewaState(a.id)).loans).toBe(0);
  });

  it('repeated requests with different Idempotency-Keys create zero loans (cumulative bypass closed)', async () => {
    const a = await employee();
    for (let i = 0; i < 4; i++) {
      const res = await post(a.token, { amount: 400 }, `legacy-${uid()}`);
      expect(res.status).toBe(410);
    }
    expect(await prisma.loan.count({ where: { employeeId: a.id } })).toBe(0);
    expect(railSpy).not.toHaveBeenCalled();
  });

  it('concurrent requests produce zero financial side effects', async () => {
    const a = await employee();
    const results = await Promise.all(Array.from({ length: 8 }, () => post(a.token, { amount: 400 }, `c-${uid()}`)));
    expect(results.every((r) => r.status === 410)).toBe(true);
    const s = await ewaState(a.id);
    expect(s.loans).toBe(0);
    expect(s.advances).toBe(0);
    expect(s.wallet).toBe(500);
    expect(railSpy).not.toHaveBeenCalled();
  });

  it('an unauthenticated request is rejected and has no effect', async () => {
    const countBefore = await prisma.loan.count();
    const res = await post(null, { amount: 400 });
    expect(res.status).toBe(401);
    expect(await prisma.loan.count()).toBe(countBefore);
    expect(railSpy).not.toHaveBeenCalled();
  });

  it('a pre-existing historical advance (Loan) is preserved untouched by the disabled route', async () => {
    const a = await employee();
    const existing = await prisma.loan.create({
      data: { employeeId: a.id, type: 'EWA', principal: 300, termDays: 30, status: 'PENDING', partnerReference: 'legacy-ref-keep' },
    });

    expect((await post(a.token, { amount: 400 })).status).toBe(410);

    const after = await prisma.loan.findUniqueOrThrow({ where: { id: existing.id } });
    expect(after).toMatchObject({ id: existing.id, principal: 300, status: 'PENDING', partnerReference: 'legacy-ref-keep' });
    expect(await prisma.loan.count({ where: { employeeId: a.id } })).toBe(1); // only the historical one, no new issuance
  });
});
