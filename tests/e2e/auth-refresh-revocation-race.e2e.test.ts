/**
 * TASK-AUTH-R5 — deterministic adversarial concurrency tests for finding F-A:
 * a family / subject revocation must NOT miss a descendant refresh session
 * created by a concurrent rotation. Runs against REAL PostgreSQL with multiple
 * connections. Synthetic accounts only.
 *
 * Invariant under test: after a reuse-triggered family revocation, a logout, or
 * a subject-wide revocation races a rotation, NO active descendant session
 * (revokedAt IS NULL AND consumedAt IS NULL) may remain. On the pre-R5 code the
 * concurrently-inserted descendant escaped revocation and these assertions fail.
 */
import { randomBytes } from 'crypto';
import { PrismaClient, RefreshSubjectType } from '@prisma/client';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { closeAllQueues } from '@config/bull';
import { refreshSessionService } from '@modules/auth/refresh-session.service';

const PHONES = {
  reuseRace: '+971500000801',
  logoutRace: '+971500000802',
  blockRace: '+971500000803',
  lockProof: '+971500000804',
};

async function clearEmp(phone: string) {
  const e = await prisma.employee.findUnique({ where: { phone } });
  if (e) {
    await prisma.refreshSession.deleteMany({ where: { subjectId: e.id } });
    await prisma.auditLog.deleteMany({ where: { actorId: e.id } });
    await prisma.employee.delete({ where: { id: e.id } });
  }
}
async function makeEmployee(phone: string) {
  await clearEmp(phone);
  return prisma.employee.create({
    data: {
      phone,
      fullName: 'R5 Race User',
      plan: 'BASIC',
      status: 'ACTIVE',
      referralCode: `r5-${randomBytes(5).toString('hex')}`,
    },
  });
}
async function activeDescendants(subjectId: string): Promise<number> {
  return prisma.refreshSession.count({
    where: { subjectId, revokedAt: null, consumedAt: null },
  });
}

describe('AUTH-R5 — rotation vs revocation race (F-A)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await redisService.connect();
  });
  afterAll(async () => {
    for (const p of Object.values(PHONES)) await clearEmp(p);
    await closeAllQueues();
    await redisService.disconnect();
    await prisma.$disconnect();
  });

  it('reuse-triggered family revocation racing a sibling rotation leaves NO active descendant', async () => {
    const emp = await makeEmployee(PHONES.reuseRace);
    const t0 = await refreshSessionService.issue({ userId: emp.id, role: 'employee' });
    const t1 = await refreshSessionService.rotate(t0.refreshToken); // R0 consumed → R1 active

    // Replay R0 (reuse → family revoke) WHILE R1 legitimately rotates → R2.
    const results = await Promise.allSettled([
      refreshSessionService.rotate(t0.refreshToken), // reuse of consumed token
      refreshSessionService.rotate(t1.refreshToken), // concurrent legit rotation
    ]);

    expect(results.some((r) => r.status === 'rejected')).toBe(true); // reuse rejected
    // F-A INVARIANT: the family revocation must not have missed the descendant.
    expect(await activeDescendants(emp.id)).toBe(0);
    // Any token a racing rotation returned must itself be dead now.
    for (const r of results) {
      if (r.status === 'fulfilled') {
        await expect(refreshSessionService.rotate(r.value.refreshToken)).rejects.toBeTruthy();
      }
    }
  });

  it('logout (family revoke) racing a rotation leaves NO active descendant', async () => {
    const emp = await makeEmployee(PHONES.logoutRace);
    const t0 = await refreshSessionService.issue({ userId: emp.id, role: 'employee' });
    const t1 = await refreshSessionService.rotate(t0.refreshToken);
    await Promise.allSettled([
      refreshSessionService.rotate(t1.refreshToken),
      refreshSessionService.revokeByToken(t1.refreshToken),
    ]);
    expect(await activeDescendants(emp.id)).toBe(0);
  });

  it('subject-wide revocation racing a rotation leaves NO active descendant', async () => {
    const emp = await makeEmployee(PHONES.blockRace);
    const t0 = await refreshSessionService.issue({ userId: emp.id, role: 'employee' });
    const t1 = await refreshSessionService.rotate(t0.refreshToken);
    await Promise.allSettled([
      refreshSessionService.rotate(t1.refreshToken),
      refreshSessionService.revokeAllForSubject(RefreshSubjectType.EMPLOYEE, emp.id, 'race_block'),
    ]);
    expect(await activeDescendants(emp.id)).toBe(0);
  });

  it('rotate() blocks on the per-subject lock while an EXCLUSIVE lock is held (serialization proof)', async () => {
    const emp = await makeEmployee(PHONES.lockProof);
    const t0 = await refreshSessionService.issue({ userId: emp.id, role: 'employee' });
    // Dedicated single-connection client so the session advisory lock/unlock run
    // on the same backend connection.
    const holder = new PrismaClient({
      datasources: { db: { url: `${process.env.DATABASE_URL}&connection_limit=1` } },
    });
    await holder.$connect();
    await holder.$executeRawUnsafe('SELECT pg_advisory_lock(hashtext($1)::int8)', emp.id);

    let resolved = false;
    const rotating = refreshSessionService
      .rotate(t0.refreshToken)
      .then((r) => {
        resolved = true;
        return r;
      });

    await new Promise((res) => setTimeout(res, 600));
    expect(resolved).toBe(false); // rotate is blocked waiting for the subject lock

    await holder.$executeRawUnsafe('SELECT pg_advisory_unlock(hashtext($1)::int8)', emp.id);
    const pair = await rotating;
    expect(resolved).toBe(true);
    expect(pair.refreshToken).toMatch(/^eyJ/);
    await holder.$disconnect();
  });
});
