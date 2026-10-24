import { createHash, randomBytes } from 'crypto';
import { KycDocumentType, SanctionsListSource } from '@prisma/client';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { closeAllQueues } from '@config/bull';
import {
  screenIdentityAgainstSanctions,
  normaliseName,
  SANCTIONS_MAX_AGE_MS,
} from '@modules/compliance/sanctions.service';
import {
  submitKycDocument,
  setKycExtractor,
  validateEmiratesId,
  type EmiratesIdExtractor,
} from '@modules/compliance/kyc.service';

/**
 * TASK-016 — sanctions screening fails CLOSED against real PostgreSQL, and
 * KYC activation requires a genuine clearance. This suite is also the
 * pre-fix detector: against the pre-TASK-016 tree, "no lists" and "Arabic
 * name" both read as clear and the account is ACTIVATED — here they must
 * leave the account PENDING_KYC.
 */

const employees: string[] = [];
const uid = () => randomBytes(5).toString('hex');
const phone = () => `+97155${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

function validEid(): string {
  for (let c = 0; c <= 9; c++) {
    const candidate = `784-1988-1234567-${c}`;
    if (validateEmiratesId(candidate).ok) return candidate;
  }
  throw new Error('no valid check digit');
}

function extractorFor(fullName: string, dateOfBirth: Date): EmiratesIdExtractor {
  return {
    async extract() {
      return {
        emiratesIdNumber: validEid(),
        fullName,
        dateOfBirth,
        nationality: 'ARE',
        documentExpiry: new Date(Date.now() + 365 * 86_400_000),
        score: 0.99,
      };
    },
  };
}

async function clearLists(): Promise<void> {
  await prisma.sanctionsListEntry.deleteMany({});
  await prisma.sanctionsListSnapshot.deleteMany({});
}

/** One fresh snapshot per required source; `entries` seeded into the first. */
async function seedLists(opts: { entries?: Array<{ name: string; dob?: Date }>; ingestedAt?: Date; empty?: boolean } = {}): Promise<void> {
  const entries = opts.entries ?? [];
  let first = true;
  for (const source of Object.values(SanctionsListSource)) {
    const snap = await prisma.sanctionsListSnapshot.create({
      data: {
        source,
        publishedAt: new Date(),
        ...(opts.ingestedAt ? { ingestedAt: opts.ingestedAt } : {}),
        entryCount: opts.empty ? 0 : first ? Math.max(1, entries.length) : 1,
        checksumSha256: createHash('sha256').update(`${source}:${randomBytes(6).toString('hex')}`).digest('hex'),
      },
    });
    if (!opts.empty) {
      const rows = first && entries.length
        ? entries.map((e, i) => ({ snapshotId: snap.id, externalRef: `e-${i}-${uid()}`, fullName: e.name, normalisedName: normaliseName(e.name), dateOfBirth: e.dob ?? null }))
        : [{ snapshotId: snap.id, externalRef: `benign-${source}`, fullName: 'Totally Unrelated Person', normalisedName: normaliseName('Totally Unrelated Person'), dateOfBirth: null }];
      await prisma.sanctionsListEntry.createMany({ data: rows });
    }
    first = false;
  }
}

async function employeePendingKyc(): Promise<string> {
  const e = await prisma.employee.create({
    data: { phone: phone(), fullName: 'Sanctions E2E', plan: 'BASIC', status: 'PENDING_KYC', walletBalance: 0 },
  });
  employees.push(e.id);
  return e.id;
}
const statusOf = async (id: string) => prisma.employee.findUniqueOrThrow({ where: { id } });
const submit = (employeeId: string) =>
  submitKycDocument({ employeeId, documentType: KycDocumentType.EMIRATES_ID_FRONT, storageUri: `s3://k/${uid()}`, imageBytes: randomBytes(32) });

describe('sanctions screening fail-closed — real PostgreSQL (TASK-016)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await redisService.connect();
  });
  beforeEach(async () => {
    await clearLists();
    setKycExtractor(extractorFor('Verified Clear Person', new Date('1988-01-01')));
  });
  afterAll(async () => {
    await clearLists();
    await prisma.complianceIncident.deleteMany({ where: { employeeId: { in: employees } } });
    await prisma.kycDocument.deleteMany({ where: { employeeId: { in: employees } } });
    await prisma.employee.deleteMany({ where: { id: { in: employees } } });
    await closeAllQueues();
    await redisService.disconnect();
    await prisma.$disconnect();
  });

  // ── Direct screening states ───────────────────────────────────────

  it('no lists loaded → SCREENING_UNAVAILABLE (never clear)', async () => {
    const r = await screenIdentityAgainstSanctions({ fullName: 'Any Person' });
    expect(r.status).toBe('SCREENING_UNAVAILABLE');
    expect(r.unavailableReason).toBe('list_missing');
  });

  it('fresh non-matching lists → VERIFIED_CLEAR', async () => {
    await seedLists();
    const r = await screenIdentityAgainstSanctions({ fullName: 'Verified Clear Person', dateOfBirth: new Date('1988-01-01') });
    expect(r.status).toBe('VERIFIED_CLEAR');
  });

  it('stale lists → SCREENING_UNAVAILABLE', async () => {
    await seedLists({ ingestedAt: new Date(Date.now() - SANCTIONS_MAX_AGE_MS - 60_000) });
    const r = await screenIdentityAgainstSanctions({ fullName: 'Verified Clear Person' });
    expect(r).toMatchObject({ status: 'SCREENING_UNAVAILABLE', unavailableReason: 'list_stale' });
  });

  it('empty lists → SCREENING_UNAVAILABLE', async () => {
    await seedLists({ empty: true });
    const r = await screenIdentityAgainstSanctions({ fullName: 'Verified Clear Person' });
    expect(r).toMatchObject({ status: 'SCREENING_UNAVAILABLE', unavailableReason: 'list_empty' });
  });

  it('an Arabic-script name → SCREENING_UNAVAILABLE even with fresh lists', async () => {
    await seedLists();
    const r = await screenIdentityAgainstSanctions({ fullName: 'محمد علي' });
    expect(r).toMatchObject({ status: 'SCREENING_UNAVAILABLE', unavailableReason: 'unsupported_script' });
  });

  it('name + DOB on a list entry → CONFIRMED_MATCH; name-only → POSSIBLE_MATCH', async () => {
    await seedLists({ entries: [{ name: 'Sanctioned Person', dob: new Date('1970-05-05') }] });
    const confirmed = await screenIdentityAgainstSanctions({ fullName: 'Sanctioned Person', dateOfBirth: new Date('1970-05-05') });
    expect(confirmed.status).toBe('CONFIRMED_MATCH');
    const possible = await screenIdentityAgainstSanctions({ fullName: 'Sanctioned Person', dateOfBirth: new Date('1990-10-10') });
    expect(possible.status).toBe('POSSIBLE_MATCH');
  });

  // ── KYC activation gated on a genuine clearance (TASK-016 §12) ─────

  it('KYC with no lists loaded does NOT activate — account held PENDING_KYC', async () => {
    const id = await employeePendingKyc();
    setKycExtractor(extractorFor('Verified Clear Person', new Date('1988-01-01')));
    await submit(id);
    const row = await statusOf(id);
    expect(row.status).toBe('PENDING_KYC'); // screening unavailable → not activated
    expect(row.kycVerifiedAt).toBeNull();
  });

  it('KYC with fresh clear lists activates the account', async () => {
    await seedLists();
    const id = await employeePendingKyc();
    setKycExtractor(extractorFor('Freshly Cleared', new Date('1992-02-02')));
    await submit(id);
    const row = await statusOf(id);
    expect(row.status).toBe('ACTIVE');
    expect(row.kycVerifiedAt).not.toBeNull();
  });

  it('KYC with a confirmed sanctions match BLOCKS and opens a SANCTIONS_HIT incident', async () => {
    await seedLists({ entries: [{ name: 'Blocked Person', dob: new Date('1975-07-07') }] });
    const id = await employeePendingKyc();
    setKycExtractor(extractorFor('Blocked Person', new Date('1975-07-07')));
    await submit(id);
    const row = await statusOf(id);
    expect(row.status).toBe('BLOCKED');
    expect(row.kycVerifiedAt).toBeNull();
    const incident = await prisma.complianceIncident.findFirst({ where: { employeeId: id, type: 'SANCTIONS_HIT' } });
    expect(incident).not.toBeNull();
    expect(incident!.status).toBe('OPEN');
  });

  it('KYC with an Arabic extracted name does NOT activate (screening unavailable)', async () => {
    await seedLists();
    const id = await employeePendingKyc();
    setKycExtractor(extractorFor('محمد علي', new Date('1980-03-03')));
    await submit(id);
    const row = await statusOf(id);
    expect(row.status).toBe('PENDING_KYC');
    expect(row.kycVerifiedAt).toBeNull();
  });

  it('KYC with stale lists does NOT activate', async () => {
    await seedLists({ ingestedAt: new Date(Date.now() - SANCTIONS_MAX_AGE_MS - 60_000) });
    const id = await employeePendingKyc();
    setKycExtractor(extractorFor('Stale Era Person', new Date('1983-03-03')));
    await submit(id);
    expect((await statusOf(id)).status).toBe('PENDING_KYC');
  });
});
