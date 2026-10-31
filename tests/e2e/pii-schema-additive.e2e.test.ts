import { randomBytes } from 'crypto';
import request from 'supertest';
import { app } from '@/app';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { closeAllQueues } from '@config/bull';

/**
 * TASK-018.1 — the additive nullable PII columns exist but are written by
 * NO code in this phase, and the existing plaintext columns + uniqueness
 * behave exactly as before. Real app + PostgreSQL (schema synced via the
 * additive migration / db push).
 */

const PREFIX = '/api/v1';
const ids: string[] = [];
const phone = () => `+97152${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

describe('additive PII columns are inert; plaintext + uniqueness unchanged (TASK-018.1)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await redisService.connect();
  });
  afterAll(async () => {
    await prisma.employee.deleteMany({ where: { id: { in: ids } } });
    await closeAllQueues();
    await redisService.disconnect();
    await prisma.$disconnect();
  });

  it('registration keeps plaintext; TASK-018.2 dual-writes phoneEncrypted; the rest stay NULL', async () => {
    const p = phone();
    await redisService.storeOTP(p, '123456');
    const res = await request(app)
      .post(`${PREFIX}/auth/employee/verify-otp`)
      .send({ phone: p, otp: '123456', fullName: 'Additive Schema', salary: 4200 });
    expect(res.status).toBe(200);

    const row = await prisma.employee.findUniqueOrThrow({ where: { phone: p } });
    ids.push(row.id);
    // Plaintext behaviour unchanged.
    expect(row.phone).toBe(p);
    expect(row.fullName).toBe('Additive Schema');
    // TASK-018.2: phone is now dual-written to its envelope column…
    expect(row.phoneEncrypted).not.toBeNull();
    // …while email columns stay NULL (no email at registration) and the
    // fields not in scope for encryption remain NULL.
    expect(row.emailEncrypted).toBeNull();
    expect(row.emailHash).toBeNull();
    expect(row.fullNameEncrypted).toBeNull();
    expect(row.salaryEncrypted).toBeNull();
    expect(row.phoneHash).toBeNull(); // untouched
  });

  it('phone uniqueness is still enforced by the plaintext column', async () => {
    const p = phone();
    const a = await prisma.employee.create({ data: { phone: p, fullName: 'Uniq A', plan: 'BASIC', status: 'PENDING_KYC', referralCode: `r-${randomBytes(4).toString('hex')}` } });
    ids.push(a.id);
    await expect(
      prisma.employee.create({ data: { phone: p, fullName: 'Uniq B', plan: 'BASIC', status: 'PENDING_KYC', referralCode: `r-${randomBytes(4).toString('hex')}` } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('a row can be read back through Prisma with the new nullable columns selected', async () => {
    const p = phone();
    const e = await prisma.employee.create({
      data: { phone: p, fullName: 'Readback', plan: 'BASIC', status: 'ACTIVE', walletBalance: 777, salary: 9000, referralCode: `r-${randomBytes(4).toString('hex')}` },
    });
    ids.push(e.id);
    const row = await prisma.employee.findUniqueOrThrow({
      where: { id: e.id },
      select: { walletBalance: true, salary: true, phoneEncrypted: true, emailEncrypted: true, emailHash: true },
    });
    expect(row.walletBalance).toBe(777); // financial field unaffected
    expect(row.salary).toBe(9000);
    expect(row.phoneEncrypted).toBeNull();
    expect(row.emailEncrypted).toBeNull();
    expect(row.emailHash).toBeNull();
  });
});
