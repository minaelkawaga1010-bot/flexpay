/**
 * TASK-AUTH-R7A — logout ACKNOWLEDGEMENT vs end-to-end REVOCATION (finding F-B).
 *
 * HTTP integration evidence (REAL PostgreSQL + Redis) for the mobile logout
 * contract correction. It proves the two halves of the contract:
 *
 *   (A) For a VALID, tracked refresh token, a successful logout (HTTP 200)
 *       actually revokes THIS device's session family — a subsequent refresh is
 *       rejected — while an UNRELATED device's session stays valid.
 *
 *   (B) The backend logout endpoint is IDEMPOTENT and returns HTTP 200 even for
 *       an unknown (valid-signature, untracked), malformed, or already-revoked
 *       token. Therefore a 2xx is only an ACKNOWLEDGEMENT of the request and can
 *       never, on its own, prove that a session was revoked. (The mobile client
 *       is corrected to treat requestServerLogout()'s true as "acknowledged",
 *       not "verified revocation".)
 *
 * Synthetic accounts/secrets only. Distinct phones avoid the per-phone auth
 * rate limiter (max 5 / window).
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
  revoke: '+971500000901',
  isolation: '+971500000902',
  idempotent: '+971500000903',
};
const ALL_PHONES = Object.values(PH);
const OTP = '123456';

const refreshReq = (token: string) =>
  request(app).post('/api/v1/auth/refresh').send({ refreshToken: token });
const logoutReq = (token: string) =>
  request(app).post('/api/v1/auth/logout').send({ refreshToken: token });

async function clearEmployee(phone: string) {
  const e = await prisma.employee.findUnique({ where: { phone } });
  if (e) {
    await prisma.refreshSession.deleteMany({ where: { subjectId: e.id } });
    await prisma.auditLog.deleteMany({ where: { actorId: e.id } });
    await prisma.employee.delete({ where: { id: e.id } });
  }
  await redisService.del(`otp:${phone}`);
}
async function clearAll() {
  for (const p of ALL_PHONES) await clearEmployee(p);
}

async function loginEmployee(
  phone: string,
): Promise<{ id: string; refreshToken: string; accessToken: string }> {
  await redisService.storeOTP(phone, OTP);
  const res = await request(app)
    .post('/api/v1/auth/employee/verify-otp')
    .send({ phone, otp: OTP, fullName: 'AuthR7A User', salary: 3000 })
    .expect(200);
  return {
    id: res.body.user.id,
    refreshToken: res.body.refreshToken,
    accessToken: res.body.accessToken,
  };
}

// A refresh token with a VALID signature that was never tracked server-side.
function untrackedButSignedRefreshToken(): string {
  return jwt.sign(
    { userId: randomUUID(), role: 'employee', tokenUse: 'refresh' },
    env.JWT_REFRESH_SECRET,
    {
      algorithm: 'HS256',
      issuer: 'flexpay',
      audience: 'flexpay-users',
      expiresIn: '7d',
      jwtid: randomUUID(),
    },
  );
}

describe('AUTH-R7A — logout acknowledgement vs revocation', () => {
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

  it('(A) a VALID refresh token is REVOKED after logout: logout → 200, then refresh → 401', async () => {
    const { refreshToken: R1 } = await loginEmployee(PH.revoke);
    // The token is live before logout.
    const before = await refreshReq(R1);
    expect(before.status).toBe(200);
    const R2 = before.body.refreshToken as string; // rotation produced the live token

    // Logging out the CURRENT live token acknowledges (200) AND revokes the family.
    await logoutReq(R2).expect(200);

    // End-to-end proof of revocation: the live token is now rejected.
    await refreshReq(R2).expect(401);
    // The already-consumed predecessor remains rejected too.
    await refreshReq(R1).expect(401);
  });

  it('(A) logging out ONE device does not revoke an UNRELATED device session', async () => {
    const deviceA = await loginEmployee(PH.isolation); // family A
    const deviceB = await loginEmployee(PH.isolation); // family B (separate login)

    await logoutReq(deviceA.refreshToken).expect(200);

    await refreshReq(deviceA.refreshToken).expect(401); // A revoked
    await refreshReq(deviceB.refreshToken).expect(200); // B unaffected (isolation)
  });

  it('(B) logout returns HTTP 200 for an UNKNOWN (valid-signature, untracked) token — acknowledgement, NOT revocation proof', async () => {
    const unknown = untrackedButSignedRefreshToken();
    // It was never a session: refresh is rejected both before and after logout.
    await refreshReq(unknown).expect(401);
    await logoutReq(unknown).expect(200); // idempotent acknowledgement
    await refreshReq(unknown).expect(401);
    // 200 here proved nothing was revoked — there was never a session to revoke.
  });

  it('(B) logout returns HTTP 200 for a malformed token (idempotent acknowledgement, never 4xx/5xx)', async () => {
    await logoutReq('not.a.jwt').expect(200);
    await logoutReq('').expect(200);
  });

  it('(B) logout is IDEMPOTENT: repeating logout of an already-revoked token still returns 200', async () => {
    const { refreshToken: R1 } = await loginEmployee(PH.idempotent);
    await logoutReq(R1).expect(200); // first logout revokes the family
    await refreshReq(R1).expect(401); // revoked
    await logoutReq(R1).expect(200); // second logout: still acknowledged (no-op), not an error
  });
});
