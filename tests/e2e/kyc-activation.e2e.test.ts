import { randomBytes } from 'crypto';
import request from 'supertest';
import { KycDocumentType } from '@prisma/client';
import { app } from '@/app';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { closeAllQueues } from '@config/bull';
import { generateAccessToken } from '@shared/utils/jwt';
import { payrollService } from '@modules/payroll/payroll.service';
import { cardsService } from '@modules/cards/cards.service';
import {
  submitKycDocument,
  setKycExtractor,
  validateEmiratesId,
  type EmiratesIdExtractor,
} from '@modules/compliance/kyc.service';

/**
 * TASK-015 — a new employee must never become financially ACTIVE from card
 * issuance or employer onboarding; only an authorised, verified KYC approval
 * activates. Real app + PostgreSQL + Redis; `npm run test:e2e` only.
 *
 * This suite is also the pre-fix detector: against the pre-TASK-015 tree the
 * "employer onboarding leaves PENDING_KYC" and "registration leaves
 * PENDING_KYC" checks FAIL (the account is activated purely by card
 * issuance).
 */

const PREFIX = '/api/v1';
const companies: string[] = [];
const employees: string[] = [];
const uid = () => randomBytes(5).toString('hex');
const phone = () => `+97150${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

/** Structurally valid Emirates ID (correct Luhn check digit). */
function validEid(): string {
  for (let c = 0; c <= 9; c++) {
    const candidate = `784-1988-1234567-${c}`;
    if (validateEmiratesId(candidate).ok) return candidate;
  }
  throw new Error('no valid check digit');
}

/** An extractor that reports a high-confidence, structurally valid identity. */
function verifyingExtractor(score = 0.99): EmiratesIdExtractor {
  return {
    async extract() {
      return {
        emiratesIdNumber: validEid(),
        fullName: 'Verified Person',
        dateOfBirth: new Date('1988-01-01'),
        nationality: 'ARE',
        documentExpiry: new Date(Date.now() + 365 * 86_400_000),
        score,
      };
    },
  };
}

/** The production default: no provider configured — extraction throws. */
function throwingExtractor(): EmiratesIdExtractor {
  return {
    async extract() {
      throw new Error('KYC provider not configured');
    },
  };
}

async function newEmployeePendingKyc(): Promise<string> {
  const e = await prisma.employee.create({
    data: {
      phone: phone(),
      fullName: 'KYC E2E',
      plan: 'BASIC',
      status: 'PENDING_KYC',
      walletBalance: 0,
      // A WPS-classified wallet so card issuance can succeed and the test
      // proves that a successful card issuance still never activates.
      wageReceiptVehicle: 'SVF_WALLET',
      wpsLicensedEntity: 'NYMCARD_SVF',
    },
  });
  employees.push(e.id);
  return e.id;
}

const statusOf = async (id: string) => prisma.employee.findUniqueOrThrow({ where: { id } });
const submit = (employeeId: string, type: KycDocumentType = KycDocumentType.EMIRATES_ID_FRONT) =>
  submitKycDocument({ employeeId, documentType: type, storageUri: `s3://kyc/${uid()}`, imageBytes: randomBytes(32) });

describe('KYC activation gating — real app + PostgreSQL (TASK-015)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await redisService.connect();
  });
  afterEach(() => setKycExtractor(throwingExtractor())); // default fail-closed between tests
  afterAll(async () => {
    const emps = await prisma.employee.findMany({ where: { id: { in: employees } }, select: { id: true } });
    const ids = emps.map((e) => e.id);
    await prisma.complianceIncident.deleteMany({ where: { employeeId: { in: ids } } });
    await prisma.kycDocument.deleteMany({ where: { employeeId: { in: ids } } });
    await prisma.card.deleteMany({ where: { employeeId: { in: ids } } });
    await prisma.employee.deleteMany({ where: { id: { in: ids } } });
    await prisma.company.deleteMany({ where: { id: { in: companies } } });
    await closeAllQueues();
    await redisService.disconnect();
    await prisma.$disconnect();
  });

  // ── Onboarding never activates ────────────────────────────────────

  it('employer-created employee stays PENDING_KYC with no kycVerifiedAt (card issuance ≠ KYC)', async () => {
    const company = await prisma.company.create({
      data: {
        name: `Co ${uid()}`, tradeLicense: `TL-${uid()}`, adminName: 'Admin',
        adminEmail: `admin-${uid()}@co.ae`, adminPhone: phone(), passwordHash: 'x',
      },
    });
    companies.push(company.id);

    const created = await payrollService.addEmployee(company.id, {
      fullName: 'Employer Hire', phone: phone(), email: `hire-${uid()}@co.ae`, salary: 4000,
    } as never);
    employees.push(created.id);

    const row = await statusOf(created.id);
    expect(row.status).toBe('PENDING_KYC');
    expect(row.kycVerifiedAt).toBeNull();
  });

  it('self-registration via verify-otp leaves the account PENDING_KYC (card issuance never activates)', async () => {
    // Exercises the real auth.service registration path, which issues a
    // virtual card. Pre-TASK-015 this flipped the account to ACTIVE purely
    // from card issuance (the live bypass); it must now end PENDING_KYC.
    const p = phone();
    const otp = '123456';
    await redisService.storeOTP(p, otp);
    const res = await request(app)
      .post(`${PREFIX}/auth/employee/verify-otp`)
      .send({ phone: p, otp, fullName: 'Self Reg', salary: 3500 });
    expect(res.status).toBe(200);

    const row = await prisma.employee.findUniqueOrThrow({ where: { phone: p } });
    employees.push(row.id);
    expect(row.status).toBe('PENDING_KYC');
    expect(row.kycVerifiedAt).toBeNull();
    expect(res.body.user.status).toBe('PENDING_KYC');
  });

  it('a PENDING_KYC employee cannot initiate financial operations', async () => {
    const id = await newEmployeePendingKyc();
    const token = generateAccessToken({ userId: id, role: 'employee' });
    const auth = { Authorization: `Bearer ${token}` };

    // authenticate('employee') requires status ACTIVE → every financial
    // surface refuses the unverified account.
    expect((await request(app).get(`${PREFIX}/wallet/balance`).set(auth)).status).toBe(401);
    expect((await request(app).post(`${PREFIX}/wallet/transfer`).set(auth).send({ recipientPhone: phone(), amount: 10 })).status).toBe(401);
    expect((await request(app).get(`${PREFIX}/bills`).set(auth)).status).toBe(401);
    expect((await request(app).get(`${PREFIX}/cards`).set(auth)).status).toBe(401);
  });

  // ── Authorised KYC approval activates ─────────────────────────────

  it('a verified primary Emirates-ID approval activates the account and stamps kycVerifiedAt', async () => {
    const id = await newEmployeePendingKyc();
    setKycExtractor(verifyingExtractor(0.99));

    await submit(id);

    const row = await statusOf(id);
    expect(row.status).toBe('ACTIVE');
    expect(row.kycVerifiedAt).not.toBeNull();
  });

  // ── Fail closed when no provider is configured (TASK-015 §8) ──────

  it('with no provider configured, KYC submission fails closed — account stays PENDING_KYC', async () => {
    const id = await newEmployeePendingKyc();
    setKycExtractor(throwingExtractor());

    await expect(submit(id)).rejects.toThrow();

    const row = await statusOf(id);
    expect(row.status).toBe('PENDING_KYC');
    expect(row.kycVerifiedAt).toBeNull();
  });

  // ── Rejected KYC does not activate; a later card event cannot override ─

  it('a low-confidence extraction is rejected and never activates', async () => {
    const id = await newEmployeePendingKyc();
    setKycExtractor(verifyingExtractor(0.3)); // below the review threshold

    await submit(id);

    const row = await statusOf(id);
    expect(row.status).toBe('PENDING_KYC');
    expect(row.kycVerifiedAt).toBeNull();
  });

  it('issuing a card after a KYC rejection does not activate the account (TASK-015 §13)', async () => {
    const id = await newEmployeePendingKyc();
    setKycExtractor(verifyingExtractor(0.3));
    await submit(id);
    expect((await statusOf(id)).status).toBe('PENDING_KYC');

    await cardsService.issueVirtualCard(id); // a later card/onboarding event

    const row = await statusOf(id);
    expect(row.status).toBe('PENDING_KYC'); // unchanged — card issuance never activates
    expect(row.kycVerifiedAt).toBeNull();
  });

  // ── Concurrency: card issuance racing KYC verification ────────────

  it('concurrent card issuance and KYC verification: ACTIVE iff kycVerifiedAt is set', async () => {
    const id = await newEmployeePendingKyc();
    setKycExtractor(verifyingExtractor(0.99));

    await Promise.all([cardsService.issueVirtualCard(id), submit(id)]);

    const row = await statusOf(id);
    // The only status writer is the KYC path, so the terminal state is a
    // consistent ACTIVE-with-evidence — never ACTIVE without kycVerifiedAt.
    expect(row.status).toBe('ACTIVE');
    expect(row.kycVerifiedAt).not.toBeNull();
  });

  // ── Duplicate submission is idempotent-safe ───────────────────────

  it('a duplicate KYC document (same bytes) is refused and does not double-activate', async () => {
    const id = await newEmployeePendingKyc();
    setKycExtractor(verifyingExtractor(0.99));
    const bytes = randomBytes(32);
    await submitKycDocument({ employeeId: id, documentType: KycDocumentType.EMIRATES_ID_FRONT, storageUri: 's3://k/1', imageBytes: bytes });
    expect((await statusOf(id)).status).toBe('ACTIVE');
    const firstVerifiedAt = (await statusOf(id)).kycVerifiedAt;

    await expect(
      submitKycDocument({ employeeId: id, documentType: KycDocumentType.EMIRATES_ID_FRONT, storageUri: 's3://k/2', imageBytes: bytes }),
    ).rejects.toThrow(/already submitted/i);

    // kycVerifiedAt is not re-stamped (no fabricated/overwritten evidence).
    expect((await statusOf(id)).kycVerifiedAt).toEqual(firstVerifiedAt);
  });
});
