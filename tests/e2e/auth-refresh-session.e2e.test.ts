/**
 * TASK-AUTH-R2 — stateful refresh-session security E2E (REAL PostgreSQL + Redis).
 *
 * Proves single-use rotation, replay/reuse detection + token-family revocation,
 * server-side logout, per-device sessions, all-session revocation on
 * block/suspend, legacy/forged rejection, concurrency (exactly one consumer),
 * fail-closed on store outage, and transaction-rollback atomicity. Synthetic
 * accounts/secrets only. No raw tokens are asserted into logs.
 *
 * Each test uses a DISTINCT synthetic phone so the per-phone auth rate limiter
 * (max 5 / window, in-memory) is never a confounder.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { app } from '@/app';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { closeAllQueues } from '@config/bull';
import { env } from '@config/env';

const PH = {
  rotation: '+971500000701',
  concurrent: '+971500000703',
  logout: '+971500000704',
  perDeviceA: '+971500000705',
  blocking: '+971500000706',
  malformed: '+971500000709',
  failClosed: '+971500000710',
  txRollback: '+971500000711',
  audit: '+971500000712',
};
const ALL_PHONES = Object.values(PH);
const CO_EMAIL = 'authr2-refresh-co@example.test';
const CO_PHONE = '+971500000799';
const CO_LICENSE = 'TL-AUTHR2-REFRESH-1';
const CO2_EMAIL = 'authr2-refresh-co2@example.test';
const CO2_PHONE = '+971500000798';
const CO2_LICENSE = 'TL-AUTHR2-REFRESH-2';
const OTP = '123456';
const CO_PASSWORD = 'Str0ng#Passw0rd!2026';

async function clearEmployee(phone: string) {
  const e = await prisma.employee.findUnique({ where: { phone } });
  if (e) {
    await prisma.employeeTransaction.deleteMany({ where: { employeeId: e.id } });
    await prisma.referral.deleteMany({ where: { OR: [{ refereeId: e.id }, { referrerId: e.id }] } });
    await prisma.card.deleteMany({ where: { employeeId: e.id } });
    await prisma.savingsGoal.deleteMany({ where: { employeeId: e.id } });
    await prisma.loan.deleteMany({ where: { employeeId: e.id } });
    await prisma.refreshSession.deleteMany({ where: { subjectId: e.id } });
    await prisma.employee.delete({ where: { id: e.id } });
  }
  await redisService.del(`otp:${phone}`);
}
async function clearCompany(email: string) {
  const c = await prisma.company.findUnique({ where: { adminEmail: email } });
  if (c) {
    await prisma.refreshSession.deleteMany({ where: { subjectId: c.id } });
    await prisma.auditLog.deleteMany({ where: { actorId: c.id } });
    await prisma.company.delete({ where: { id: c.id } });
  }
}
async function clearAll() {
  for (const p of ALL_PHONES) await clearEmployee(p);
  await clearCompany(CO_EMAIL);
  await clearCompany(CO2_EMAIL);
}

const refreshReq = (token: string) =>
  request(app).post('/api/v1/auth/refresh').send({ refreshToken: token });
const logoutReq = (token: string) =>
  request(app).post('/api/v1/auth/logout').send({ refreshToken: token });

async function loginEmployee(
  phone: string,
): Promise<{ id: string; refreshToken: string; accessToken: string }> {
  await redisService.storeOTP(phone, OTP);
  const res = await request(app)
    .post('/api/v1/auth/employee/verify-otp')
    .send({ phone, otp: OTP, fullName: 'AuthR2 User', salary: 3000 })
    .expect(200);
  return { id: res.body.user.id, refreshToken: res.body.refreshToken, accessToken: res.body.accessToken };
}
async function registerCompany(
  email = CO_EMAIL,
  phone = CO_PHONE,
  license = CO_LICENSE,
): Promise<{ id: string; refreshToken: string }> {
  const res = await request(app)
    .post('/api/v1/auth/company/register')
    .send({
      name: 'AuthR2 Co',
      tradeLicense: license,
      adminName: 'Admin R2',
      adminEmail: email,
      adminPhone: phone,
      password: CO_PASSWORD,
    })
    .expect(201);
  const co = await prisma.company.findUniqueOrThrow({ where: { adminEmail: email } });
  return { id: co.id, refreshToken: res.body.refreshToken };
}

describe('AUTH-R2 — stateful refresh sessions', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await redisService.connect();
    await clearAll();
  });
  afterAll(async () => {
    await clearAll();
    await closeAllQueues();
    await redisService.disconnect();
    await prisma.$disconnect();
  });

  it('employee: single-use rotation R1→R2, then R1 replay rejected and family revoked', async () => {
    const { refreshToken: R1 } = await loginEmployee(PH.rotation);
    const r2 = await refreshReq(R1).expect(200);
    const R2 = r2.body.refreshToken as string;
    expect(R2).not.toBe(R1);
    // A unique jti is NOT evidence of single-use: both tokens carry distinct
    // jti, yet the real protection is that the OLD token is now rejected.
    expect((jwt.decode(R1) as { jti: string }).jti).not.toBe((jwt.decode(R2) as { jti: string }).jti);

    await refreshReq(R1).expect(401); // replay of consumed token → reuse detected
    await refreshReq(R2).expect(401); // whole family revoked by the reuse
  });

  it('company: single-use rotation + replay rejection + family revocation', async () => {
    const { refreshToken: R1 } = await registerCompany();
    const R2 = (await refreshReq(R1).expect(200)).body.refreshToken as string;
    expect(R2).not.toBe(R1);
    await refreshReq(R1).expect(401);
    await refreshReq(R2).expect(401);
  });

  it('concurrent refresh of one token yields exactly one successful consumer', async () => {
    const { refreshToken: R1 } = await loginEmployee(PH.concurrent);
    const results = await Promise.all(Array.from({ length: 6 }, () => refreshReq(R1)));
    const ok = results.filter((r) => r.status === 200);
    const rejected = results.filter((r) => r.status === 401);
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(5);
  });

  it('server-side logout revokes the session family (subsequent refresh rejected)', async () => {
    const { refreshToken: R1 } = await loginEmployee(PH.logout);
    await logoutReq(R1).expect(200);
    await refreshReq(R1).expect(401);
  });

  it('per-device sessions are independent; logging out one device keeps the other', async () => {
    const deviceA = await loginEmployee(PH.perDeviceA); // family A
    const deviceB = await loginEmployee(PH.perDeviceA); // family B (separate login, same user)
    await logoutReq(deviceA.refreshToken).expect(200);
    await refreshReq(deviceA.refreshToken).expect(401); // A revoked
    await refreshReq(deviceB.refreshToken).expect(200); // B unaffected
  });

  it('blocking an employee revokes ALL sessions and refuses refresh (403)', async () => {
    const deviceA = await loginEmployee(PH.blocking);
    const deviceB = await loginEmployee(PH.blocking);
    await prisma.employee.update({ where: { phone: PH.blocking }, data: { status: 'BLOCKED' } });
    const blocked = await refreshReq(deviceA.refreshToken);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('FORBIDDEN');
    const emp = await prisma.employee.findUniqueOrThrow({ where: { phone: PH.blocking } });
    const live = await prisma.refreshSession.count({ where: { subjectId: emp.id, revokedAt: null } });
    expect(live).toBe(0); // all-session revocation
    // Device B is now revoked too (revoked → 401, or blocked → 403; refused either way).
    const deviceBAfterBlock = await refreshReq(deviceB.refreshToken);
    expect([401, 403]).toContain(deviceBAfterBlock.status);
  });

  it('suspending a company refuses refresh (403)', async () => {
    const { refreshToken: R1 } = await registerCompany(CO2_EMAIL, CO2_PHONE, CO2_LICENSE);
    await prisma.company.update({ where: { adminEmail: CO2_EMAIL }, data: { status: 'SUSPENDED' } });
    const res = await refreshReq(R1);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });

  it('rejects an untracked (legacy / unknown) refresh token with a valid signature', async () => {
    const legacy = jwt.sign(
      { userId: randomUUID(), role: 'employee', tokenUse: 'refresh' },
      env.JWT_REFRESH_SECRET,
      { algorithm: 'HS256', issuer: 'flexpay', audience: 'flexpay-users', expiresIn: '7d', jwtid: randomUUID() },
    );
    await refreshReq(legacy).expect(401);
  });

  it('rejects malformed, bad-signature, expired, and access-as-refresh tokens', async () => {
    const { accessToken } = await loginEmployee(PH.malformed);
    await refreshReq('not.a.jwt').expect(401);
    const badSig = jwt.sign(
      { userId: 'x', role: 'employee', tokenUse: 'refresh' },
      'a-different-wrong-secret-value',
      { algorithm: 'HS256', issuer: 'flexpay', audience: 'flexpay-users', expiresIn: '7d', jwtid: randomUUID() },
    );
    await refreshReq(badSig).expect(401);
    const expired = jwt.sign(
      { userId: 'x', role: 'employee', tokenUse: 'refresh' },
      env.JWT_REFRESH_SECRET,
      { algorithm: 'HS256', issuer: 'flexpay', audience: 'flexpay-users', expiresIn: -1, jwtid: randomUUID() },
    );
    await refreshReq(expired).expect(401);
    await refreshReq(accessToken).expect(401); // access token presented as refresh
  });

  it('fails CLOSED when the session store is unavailable (no token issued)', async () => {
    const { refreshToken: R1 } = await loginEmployee(PH.failClosed);
    const spy = jest
      .spyOn(prisma.refreshSession, 'findUnique')
      .mockRejectedValueOnce(new Error('simulated store outage'));
    const res = await refreshReq(R1);
    expect(res.status).not.toBe(200); // fail-closed (500) — never mints tokens
    expect(res.body.accessToken).toBeUndefined();
    spy.mockRestore();
    await refreshReq(R1).expect(200); // the failed attempt did not consume the token
  });

  it('a failed rotation transaction rolls back: the token is not left consumed', async () => {
    const { refreshToken: R1 } = await loginEmployee(PH.txRollback);
    const spy = jest
      .spyOn(prisma, '$transaction')
      .mockRejectedValueOnce(new Error('simulated transaction failure'));
    const res = await refreshReq(R1);
    expect(res.status).not.toBe(200);
    spy.mockRestore();
    // Atomicity: the consume+create rolled back, so R1 is still valid on retry.
    await refreshReq(R1).expect(200);
  });

  it('reuse-detection audit event is sanitized (hash prefix only, no raw token)', async () => {
    const { id, refreshToken: R1 } = await loginEmployee(PH.audit);
    const R2 = (await refreshReq(R1).expect(200)).body.refreshToken as string;
    await refreshReq(R1).expect(401); // triggers REFRESH_REUSE_DETECTED
    const events = await prisma.auditLog.findMany({
      where: { actorId: id, action: 'REFRESH_REUSE_DETECTED' },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    const meta = events[0].metadata as { jtiHashPrefix?: string } | null;
    expect(meta?.jtiHashPrefix).toMatch(/^[0-9a-f]{12}$/);
    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain(R1);
    expect(serialized).not.toContain(R2);
  });
});
