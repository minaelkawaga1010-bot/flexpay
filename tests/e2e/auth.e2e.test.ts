import request from 'supertest';
import { app } from '@/app';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { closeAllQueues } from '@config/bull';

const TEST_PHONE = '+971509999001';
const SECOND_PHONE = '+971509999002';
const TEST_OTP = '123456';

async function clearTestState(phone: string) {
  // referrals and transactions cascade off employee.id, but the schema
  // doesn't enforce ON DELETE CASCADE — clean explicitly.
  const employee = await prisma.employee.findUnique({ where: { phone } });
  if (!employee) {
    await redisService.del(`otp:${phone}`);
    await redisService.del(`rate:auth:otp:${phone}`);
    await redisService.del(`rate:otp:${phone}`);
    return;
  }
  await prisma.employeeTransaction.deleteMany({ where: { employeeId: employee.id } });
  await prisma.referral.deleteMany({
    where: { OR: [{ refereeId: employee.id }, { referrerId: employee.id }] },
  });
  await prisma.card.deleteMany({ where: { employeeId: employee.id } });
  await prisma.savingsGoal.deleteMany({ where: { employeeId: employee.id } });
  await prisma.loan.deleteMany({ where: { employeeId: employee.id } });
  await prisma.employee.delete({ where: { id: employee.id } });
  await redisService.del(`otp:${phone}`);
  await redisService.del(`rate:auth:otp:${phone}`);
  await redisService.del(`rate:otp:${phone}`);
}

describe('Auth — E2E', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await redisService.connect();
  });

  afterAll(async () => {
    await Promise.all([clearTestState(TEST_PHONE), clearTestState(SECOND_PHONE)]);
    await closeAllQueues();
    await redisService.disconnect();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await clearTestState(TEST_PHONE);
    await clearTestState(SECOND_PHONE);
  });

  it('completes the employee OTP → registration → JWT flow', async () => {
    const otpRes = await request(app)
      .post('/api/v1/auth/employee/request-otp')
      .send({ phone: TEST_PHONE })
      .expect(200);
    expect(otpRes.body.message).toMatch(/OTP sent/i);

    // The Twilio side is stubbed, so we plant the OTP we want to verify.
    await redisService.storeOTP(TEST_PHONE, TEST_OTP);

    const verifyRes = await request(app)
      .post('/api/v1/auth/employee/verify-otp')
      .send({
        phone: TEST_PHONE,
        otp: TEST_OTP,
        fullName: 'E2E Test User',
        salary: 3500,
      })
      .expect(200);

    expect(verifyRes.body).toMatchObject({
      accessToken: expect.stringMatching(/^eyJ/),
      user: {
        role: 'employee',
        phone: TEST_PHONE,
        fullName: 'E2E Test User',
        balance: 0,
      },
    });

    // Refresh-token cookie is HttpOnly + secure-shaped.
    const cookies = verifyRes.headers['set-cookie'];
    const cookieList = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
    expect(cookieList.some((c: string) => c.startsWith('refreshToken='))).toBe(true);
    expect(cookieList.some((c: string) => /HttpOnly/i.test(c))).toBe(true);

    const employee = await prisma.employee.findUnique({ where: { phone: TEST_PHONE } });
    expect(employee).toMatchObject({
      phone: TEST_PHONE,
      fullName: 'E2E Test User',
      // Card issuance succeeds (stub mode), so we end ACTIVE.
      status: 'ACTIVE',
    });

    // OTP was consumed by verify.
    expect(await redisService.exists(`otp:${TEST_PHONE}`)).toBe(false);
  });

  it('rejects an invalid OTP', async () => {
    await redisService.storeOTP(SECOND_PHONE, TEST_OTP);

    const res = await request(app)
      .post('/api/v1/auth/employee/verify-otp')
      .send({
        phone: SECOND_PHONE,
        otp: '000000',
        fullName: 'Wrong OTP',
      })
      .expect(401);

    expect(res.body.error).toBe('UNAUTHORIZED');
    // Original OTP is still consumable since we never matched it.
    expect(await redisService.get(`otp:${SECOND_PHONE}`)).toBe(TEST_OTP);
  });

  it('refreshes the access token via the cookie', async () => {
    await redisService.storeOTP(TEST_PHONE, TEST_OTP);
    const verifyRes = await request(app)
      .post('/api/v1/auth/employee/verify-otp')
      .send({ phone: TEST_PHONE, otp: TEST_OTP, fullName: 'Refresh Tester', salary: 3000 })
      .expect(200);

    const cookies = verifyRes.headers['set-cookie'];
    const cookieList = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
    const refreshCookie = cookieList.find((c: string) => c.startsWith('refreshToken='));
    expect(refreshCookie).toBeDefined();

    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie!)
      .send({})
      .expect(200);

    expect(refreshRes.body.accessToken).toMatch(/^eyJ/);
    expect(refreshRes.body.accessToken).not.toBe(verifyRes.body.accessToken);
  });
});
