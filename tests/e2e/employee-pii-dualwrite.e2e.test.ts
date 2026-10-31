import { createHash, randomBytes } from 'crypto';
import request from 'supertest';
import { app } from '@/app';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { closeAllQueues } from '@config/bull';
import { decryptField, setKeyProvider, MissingKeyError } from '@shared/security/pii-crypto';
import {
  blindIndexEmail,
  normalizePhone,
  setBlindIndexKeyProvider,
  MissingBlindIndexKeyError,
} from '@shared/security/employee-pii';
import { payrollService } from '@modules/payroll/payroll.service';

/**
 * TASK-018.2 — atomic dual-write of Employee phone/email protected columns,
 * against the REAL app + PostgreSQL + Redis. Verifies rows directly: new
 * service writes carry valid ciphertext + correct emailHash, the plaintext
 * columns and uniqueness are unchanged, old rows are not rewritten, and a key
 * failure writes NOTHING (no plaintext-only row). Also the pre-fix detector:
 * on the pre-018.2 tree the protected columns stay NULL after a service write.
 */

const PREFIX = '/api/v1';
const employees: string[] = [];
const companies: string[] = [];
const uid = () => randomBytes(5).toString('hex');
const phone = () => `+97153${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

const realDek = { getKey: () => Buffer.from(process.env.PII_DATA_KEY as string, 'base64') };
const realBlind = { getKey: () => Buffer.from(process.env.PII_BLIND_INDEX_KEY as string, 'base64') };

async function company(): Promise<string> {
  const c = await prisma.company.create({
    data: { name: `Co ${uid()}`, tradeLicense: `TL-${uid()}`, adminName: 'A', adminEmail: `a-${uid()}@co.ae`, adminPhone: phone(), passwordHash: 'x' },
  });
  companies.push(c.id);
  return c.id;
}
const rowOf = (id: string) => prisma.employee.findUniqueOrThrow({ where: { id } });

describe('Employee PII dual-write — real app + PostgreSQL (TASK-018.2)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await redisService.connect();
  });
  afterEach(() => {
    setKeyProvider(realDek);
    setBlindIndexKeyProvider(realBlind);
  });
  afterAll(async () => {
    await prisma.employee.deleteMany({ where: { id: { in: employees } } });
    await prisma.company.deleteMany({ where: { id: { in: companies } } });
    await closeAllQueues();
    await redisService.disconnect();
    await prisma.$disconnect();
  });

  it('self-registration dual-writes phoneEncrypted; phoneHash + email columns stay NULL', async () => {
    const p = phone();
    await redisService.storeOTP(p, '123456');
    const res = await request(app).post(`${PREFIX}/auth/employee/verify-otp`).send({ phone: p, otp: '123456', fullName: 'Dual Reg', salary: 4000 });
    expect(res.status).toBe(200);
    const row = await prisma.employee.findUniqueOrThrow({ where: { phone: p } });
    employees.push(row.id);

    expect(row.phone).toBe(p); // plaintext intact
    expect(row.phoneEncrypted).not.toBeNull();
    expect(decryptField(row.phoneEncrypted)).toBe(normalizePhone(p)); // real decrypt
    expect(row.phoneHash).toBeNull(); // untouched (not repurposed)
    expect(row.emailEncrypted).toBeNull(); // no email at registration
    expect(row.emailHash).toBeNull();
  });

  it('employer onboarding dual-writes phone + email; emailHash equals the keyed HMAC', async () => {
    const co = await company();
    const p = phone();
    const email = `Hire.${uid()}@Example.COM`;
    const e = await payrollService.addEmployee(co, { fullName: 'Hire', phone: p, email, salary: 5000 } as never);
    employees.push(e.id);
    const row = await rowOf(e.id);

    expect(row.phone).toBe(p);
    expect(row.email).toBe(email); // plaintext stored as-given (unchanged)
    expect(decryptField(row.phoneEncrypted)).toBe(normalizePhone(p));
    expect(decryptField(row.emailEncrypted)).toBe(email.trim().toLowerCase());
    expect(row.emailHash).toBe(blindIndexEmail(email)); // direct HMAC verification
  });

  it('employer onboarding without an email leaves the email columns NULL', async () => {
    const co = await company();
    const e = await payrollService.addEmployee(co, { fullName: 'No Email', phone: phone(), salary: 5000 } as never);
    employees.push(e.id);
    const row = await rowOf(e.id);
    expect(row.email).toBeNull();
    expect(row.emailEncrypted).toBeNull();
    expect(row.emailHash).toBeNull();
    expect(row.phoneEncrypted).not.toBeNull(); // phone still protected
  });

  it('updating the email atomically re-writes emailEncrypted + emailHash consistently', async () => {
    const co = await company();
    const e = await payrollService.addEmployee(co, { fullName: 'Upd', phone: phone(), email: `old.${uid()}@x.com`, salary: 5000 } as never);
    employees.push(e.id);
    const newEmail = `New.${uid()}@X.com`;
    await payrollService.updateEmployee(co, e.id, { email: newEmail });
    const row = await rowOf(e.id);
    expect(row.email).toBe(newEmail);
    expect(decryptField(row.emailEncrypted)).toBe(newEmail.trim().toLowerCase());
    expect(row.emailHash).toBe(blindIndexEmail(newEmail)); // consistent with committed email
  });

  it('FAIL-CLOSED: a missing blind-index key writes NO row (no plaintext-only persistence)', async () => {
    const co = await company();
    const before = await prisma.employee.count();
    setBlindIndexKeyProvider({ getKey: () => { throw new MissingBlindIndexKeyError(); } });
    await expect(
      payrollService.addEmployee(co, { fullName: 'Keyless', phone: phone(), email: `k.${uid()}@x.com`, salary: 1 } as never),
    ).rejects.toThrow(MissingBlindIndexKeyError);
    expect(await prisma.employee.count()).toBe(before); // nothing written
  });

  it('FAIL-CLOSED: a missing DEK writes NO row', async () => {
    const co = await company();
    const before = await prisma.employee.count();
    setKeyProvider({ getKey: () => { throw new MissingKeyError(); } });
    await expect(
      payrollService.addEmployee(co, { fullName: 'NoDek', phone: phone(), email: `d.${uid()}@x.com`, salary: 1 } as never),
    ).rejects.toThrow(MissingKeyError);
    expect(await prisma.employee.count()).toBe(before);
  });

  it('historical rows that predate dual-write are NOT rewritten', async () => {
    const legacy = await prisma.employee.create({
      data: { phone: phone(), fullName: 'Legacy', plan: 'BASIC', status: 'ACTIVE', referralCode: `r-${uid()}` },
    });
    employees.push(legacy.id);
    expect(legacy.phoneEncrypted).toBeNull(); // created directly, no dual-write
    // A later service write of a DIFFERENT employee must not backfill the legacy row.
    const co = await company();
    const fresh = await payrollService.addEmployee(co, { fullName: 'Fresh', phone: phone(), salary: 1 } as never);
    employees.push(fresh.id);
    expect((await rowOf(legacy.id)).phoneEncrypted).toBeNull(); // still null — untouched
    expect((await rowOf(fresh.id)).phoneEncrypted).not.toBeNull();
  });

  it('plaintext uniqueness unchanged; case-variant emails share a blind index but stay distinct rows', async () => {
    const co = await company();
    const p = phone();
    const a = await payrollService.addEmployee(co, { fullName: 'U A', phone: p, email: `Dup.${uid()}@x.com`, salary: 1 } as never);
    employees.push(a.id);
    // duplicate phone → still rejected (the service's existing plaintext-phone
    // dedup check fires before the DB unique constraint). Behaviour unchanged.
    await expect(payrollService.addEmployee(co, { fullName: 'U B', phone: p, salary: 1 } as never)).rejects.toMatchObject({ status: 409 });

    // case-variant email → distinct plaintext rows, identical emailHash
    const base = `Case.${uid()}@x.com`;
    const lower = await payrollService.addEmployee(co, { fullName: 'L', phone: phone(), email: base.toLowerCase(), salary: 1 } as never);
    const upper = await payrollService.addEmployee(co, { fullName: 'U', phone: phone(), email: base.toUpperCase(), salary: 1 } as never);
    employees.push(lower.id, upper.id);
    const [lr, ur] = [await rowOf(lower.id), await rowOf(upper.id)];
    expect(lr.email).not.toBe(ur.email); // distinct plaintext (case-sensitive column)
    expect(lr.emailHash).toBe(ur.emailHash); // same blind index (case-insensitive identity)
  });

  it('concurrent onboarding writes are each fully protected (no partial state)', async () => {
    const co = await company();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => payrollService.addEmployee(co, { fullName: 'C', phone: phone(), email: `c.${uid()}@x.com`, salary: 1 } as never)),
    );
    for (const e of results) {
      employees.push(e.id);
      const row = await rowOf(e.id);
      expect(row.phone).not.toBeNull();
      expect(row.phoneEncrypted).not.toBeNull();
      expect(row.emailEncrypted).not.toBeNull();
      expect(row.emailHash).not.toBeNull();
    }
  });

  it('no raw key / ciphertext secret is written into emailHash (it is an opaque HMAC)', async () => {
    // Sanity: emailHash is a 64-hex HMAC, not the key and not the plaintext.
    const h = blindIndexEmail('probe@x.com');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('probe');
    expect(h).not.toBe(createHash('sha256').update('probe@x.com').digest('hex')); // keyed, not a plain SHA-256
  });
});
