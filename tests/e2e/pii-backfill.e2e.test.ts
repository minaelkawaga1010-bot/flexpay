import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';
import {
  backfillEmployeePii,
  preflightEmailNormalization,
  verifyEmployeePiiProtection,
} from '@shared/security/pii-backfill';
import { decryptField, setKeyProvider, MissingKeyError } from '@shared/security/pii-crypto';
import {
  protectEmployeePhone,
  protectEmployeeEmail,
  blindIndexEmail,
  normalizePhone,
  normalizeEmail,
  setBlindIndexKeyProvider,
  MissingBlindIndexKeyError,
} from '@shared/security/employee-pii';

/**
 * TASK-018.3 — historical PII backfill, preflight, and decrypt-and-compare
 * verification against REAL PostgreSQL, synthetic data only.
 *
 * Runs against a DEDICATED, DISPOSABLE database (BACKFILL_DATABASE_URL →
 * `flexpay_bf`) that this suite fully owns and truncates between tests, so the
 * whole-table backfill/preflight/verify counts are deterministic and NOTHING
 * here can touch the data of any other suite or any shared/production store.
 * Real AES-256-GCM + HMAC-SHA256 (disposable keys from tests/e2e/setup.ts).
 */

const BF_URL = process.env.BACKFILL_DATABASE_URL;
const db = new PrismaClient(BF_URL ? { datasources: { db: { url: BF_URL } } } : undefined);

// Disposable providers that read the per-process test keys (restored after any
// fail-closed override). DISTINCT DEK vs blind-index key — never production.
const realDek = { getKey: () => Buffer.from(process.env.PII_DATA_KEY as string, 'base64') };
const realBlind = { getKey: () => Buffer.from(process.env.PII_BLIND_INDEX_KEY as string, 'base64') };

let seq = 0;
const uid = () => `${(seq++).toString(36)}${randomBytes(4).toString('hex')}`;
const phone = () => `+9715${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}${seq}`.slice(0, 15);

interface SeedOpts {
  phone?: string;
  email?: string | null;
  fullName?: string;
}
/** Create a HISTORICAL plaintext-only row (protected columns default NULL). */
async function seedPlaintext(opts: SeedOpts = {}) {
  const data: Record<string, unknown> = {
    phone: opts.phone ?? phone(),
    fullName: opts.fullName ?? 'Hist',
  };
  if ('email' in opts) data.email = opts.email;
  return db.employee.create({ data: data as never });
}
const rowById = (id: string) => db.employee.findUniqueOrThrow({ where: { id } });
const truncate = () => db.$executeRawUnsafe('TRUNCATE "employees" RESTART IDENTITY CASCADE');

beforeAll(async () => {
  if (!BF_URL) throw new Error('BACKFILL_DATABASE_URL must point at the disposable flexpay_bf DB');
  await db.$connect();
  setKeyProvider(realDek);
  setBlindIndexKeyProvider(realBlind);
});
beforeEach(truncate);
afterEach(() => {
  // Undo any fail-closed override so later tests have working crypto.
  setKeyProvider(realDek);
  setBlindIndexKeyProvider(realBlind);
});
afterAll(async () => {
  await truncate();
  await db.$disconnect();
});

describe('empty database', () => {
  it('backfill / preflight / verify all no-op cleanly on zero rows', async () => {
    const rep = await backfillEmployeePii({ client: db, batchSize: 50 });
    expect(rep).toMatchObject({ scanned: 0, eligible: 0, backfilled: 0, verified: 0, remainingUnprotected: 0, failed: 0 });
    const pf = await preflightEmailNormalization({ client: db, batchSize: 50 });
    expect(pf).toMatchObject({ scanned: 0, emailsPresent: 0, canonicalCollisionGroups: 0, blockedForUniqueCutover: false });
    const v = await verifyEmployeePiiProtection({ client: db, batchSize: 50 });
    expect(v).toMatchObject({ scanned: 0, fullyProtectedAndVerified: 0, remainingUnprotected: 0, inconsistent: 0 });
  });
});

describe('plaintext-only historical rows (the pre-fix state) → backfilled + verified', () => {
  it('reproduces missing protected fields, then protects and decrypt-verifies them', async () => {
    const p = phone();
    const email = `Core.${uid()}@x.com`;
    const r = await seedPlaintext({ phone: p, email });
    // Pre-fix condition: historical PII present but NO protected fields.
    expect(r.phoneEncrypted).toBeNull();
    expect(r.emailEncrypted).toBeNull();
    expect(r.emailHash).toBeNull();
    expect(await verifyEmployeePiiProtection({ client: db })).toMatchObject({ remainingUnprotected: 1, fullyProtectedAndVerified: 0 });

    const rep = await backfillEmployeePii({ client: db, batchSize: 50 });
    expect(rep).toMatchObject({ scanned: 1, eligible: 1, backfilled: 1, verified: 1, remainingUnprotected: 0, failed: 0 });

    const after = await rowById(r.id);
    // Verified by DECRYPTION, not merely non-NULL.
    expect(decryptField(after.phoneEncrypted)).toBe(normalizePhone(p));
    expect(decryptField(after.emailEncrypted)).toBe(normalizeEmail(email));
    expect(after.emailHash).toBe(blindIndexEmail(email));
    // Plaintext source untouched.
    expect(after.phone).toBe(p);
    expect(after.email).toBe(email);
  });

  it('a non-E.164 / oddly-formatted phone is normalised deterministically and round-trips', async () => {
    const weird = `0501${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`; // local format, no +
    const r = await seedPlaintext({ phone: weird, email: null });
    const rep = await backfillEmployeePii({ client: db });
    expect(rep.backfilled).toBe(1);
    const after = await rowById(r.id);
    expect(decryptField(after.phoneEncrypted)).toBe(normalizePhone(weird));
  });
});

describe('already-protected rows are never rewritten (idempotency)', () => {
  it('a fully protected row is counted previouslyProtected and left byte-identical', async () => {
    const p = phone();
    const email = `Pre.${uid()}@x.com`;
    const { phoneEncrypted } = protectEmployeePhone(p);
    const { emailEncrypted, emailHash } = protectEmployeeEmail(email);
    const r = await db.employee.create({ data: { phone: p, email, fullName: 'Pre', phoneEncrypted, emailEncrypted, emailHash } as never });

    const rep = await backfillEmployeePii({ client: db });
    expect(rep).toMatchObject({ scanned: 1, eligible: 0, backfilled: 0, previouslyProtected: 1 });
    const after = await rowById(r.id);
    expect(after.phoneEncrypted).toBe(phoneEncrypted); // identical — not re-encrypted (random nonce would differ)
    expect(after.emailEncrypted).toBe(emailEncrypted);
    expect(after.emailHash).toBe(emailHash);
  });

  it('re-running the backfill is a no-op with byte-identical ciphertext', async () => {
    await Promise.all([seedPlaintext({ email: `a.${uid()}@x.com` }), seedPlaintext({}), seedPlaintext({ email: `c.${uid()}@x.com` })]);
    await backfillEmployeePii({ client: db });
    const snap = await db.employee.findMany({ orderBy: { id: 'asc' }, select: { id: true, phoneEncrypted: true, emailEncrypted: true, emailHash: true } });

    const rep2 = await backfillEmployeePii({ client: db });
    expect(rep2.backfilled).toBe(0);
    expect(rep2.previouslyProtected).toBe(3);
    const snap2 = await db.employee.findMany({ orderBy: { id: 'asc' }, select: { id: true, phoneEncrypted: true, emailEncrypted: true, emailHash: true } });
    expect(snap2).toEqual(snap); // nothing re-encrypted on the second run
  });

  it('partial rows (phone protected, email still eligible) backfill ONLY the missing column', async () => {
    const p = phone();
    const email = `Part.${uid()}@x.com`;
    const { phoneEncrypted } = protectEmployeePhone(p);
    const r = await db.employee.create({ data: { phone: p, email, fullName: 'Part', phoneEncrypted } as never }); // emailEncrypted NULL
    const rep = await backfillEmployeePii({ client: db });
    expect(rep.backfilled).toBe(1);
    const after = await rowById(r.id);
    expect(after.phoneEncrypted).toBe(phoneEncrypted); // existing ciphertext untouched
    expect(decryptField(after.emailEncrypted)).toBe(normalizeEmail(email));
    expect(after.emailHash).toBe(blindIndexEmail(email));
  });
});

describe('null / empty / malformed / unicode emails', () => {
  it('null and empty-string emails: phone is protected, email columns stay NULL, row verifies', async () => {
    const p1 = phone();
    const p2 = phone();
    const rNull = await seedPlaintext({ phone: p1, email: null });
    const rEmpty = await seedPlaintext({ phone: p2, email: '' });
    const rep = await backfillEmployeePii({ client: db });
    expect(rep.emptyOrNullEmail).toBe(2);
    const an = await rowById(rNull.id);
    const ae = await rowById(rEmpty.id);
    expect(decryptField(an.phoneEncrypted)).toBe(normalizePhone(p1));
    expect(an.emailEncrypted).toBeNull();
    expect(an.emailHash).toBeNull();
    expect(ae.emailEncrypted).toBeNull();
    expect(ae.emailHash).toBeNull();
    expect(await verifyEmployeePiiProtection({ client: db })).toMatchObject({ fullyProtectedAndVerified: 2, remainingUnprotected: 0, inconsistent: 0 });
  });

  it('a malformed email is recorded and left unprotected (never force-encrypted); phone still protected', async () => {
    const p = phone();
    const r = await seedPlaintext({ phone: p, email: 'not-an-email' });
    const rep = await backfillEmployeePii({ client: db });
    expect(rep.malformedSkipped).toBe(1);
    const after = await rowById(r.id);
    expect(after.emailEncrypted).toBeNull();
    expect(after.emailHash).toBeNull();
    expect(after.email).toBe('not-an-email'); // plaintext untouched
    expect(decryptField(after.phoneEncrypted)).toBe(normalizePhone(p));
    // Fail-safe: the un-protectable email is honestly reported as remaining.
    expect(await verifyEmployeePiiProtection({ client: db })).toMatchObject({ remainingUnprotected: 1 });
  });

  it('a control-char (suspicious unicode) email is skipped, not encrypted', async () => {
    const p = phone();
    const r = await seedPlaintext({ phone: p, email: `a\u0007${uid()}@b.com` });
    const rep = await backfillEmployeePii({ client: db });
    expect(rep.malformedSkipped).toBe(1);
    const after = await rowById(r.id);
    expect(after.emailEncrypted).toBeNull();
    expect(decryptField(after.phoneEncrypted)).toBe(normalizePhone(p));
  });

  it('a valid non-ASCII (accented) email round-trips through encrypt + blind index', async () => {
    const p = phone();
    const email = `tëst.${uid()}@exämple.com`;
    const r = await seedPlaintext({ phone: p, email });
    const rep = await backfillEmployeePii({ client: db });
    expect(rep.backfilled).toBe(1);
    const after = await rowById(r.id);
    expect(decryptField(after.emailEncrypted)).toBe(normalizeEmail(email));
    expect(after.emailHash).toBe(blindIndexEmail(email));
  });
});

describe('normalisation-identity conflicts (case-only duplicates) — never merged', () => {
  it('case-variant emails get distinct ciphertext but a shared blind index; both rows survive', async () => {
    const local = `Case.${uid()}`;
    const e1 = `${local}@x.com`;
    const e2 = `${local.toUpperCase()}@X.COM`; // distinct plaintext (case-sensitive column), same canonical
    const a = await seedPlaintext({ email: e1 });
    const b = await seedPlaintext({ email: e2 });

    const rep = await backfillEmployeePii({ client: db });
    expect(rep.backfilled).toBe(2);
    const ra = await rowById(a.id);
    const rb = await rowById(b.id);
    expect(ra.emailHash).toBe(rb.emailHash); // same normalised identity
    expect(ra.emailEncrypted).not.toBe(rb.emailEncrypted); // distinct ciphertext (random nonce)
    expect(ra.email).not.toBe(rb.email); // plaintext preserved distinct
    expect(await db.employee.count()).toBe(2); // NEITHER row merged, deleted, or picked as a survivor
  });

  it('preflight flags the collision as BLOCKED for a unique/lookup cutover, with opaque output only', async () => {
    const local = `Dup.${uid()}`;
    await seedPlaintext({ email: `${local}@x.com` });
    await seedPlaintext({ email: `${local.toUpperCase()}@X.COM` });
    await seedPlaintext({ email: `unique.${uid()}@x.com` }); // a non-colliding control row

    const pf = await preflightEmailNormalization({ client: db });
    expect(pf.canonicalCollisionGroups).toBe(1);
    expect(pf.canonicalCollisionRows).toBe(2);
    expect(pf.caseOnlyNormalisation).toBeGreaterThanOrEqual(1);
    expect(pf.blockedForUniqueCutover).toBe(true);
    // Output is opaque: a hashed group key + row ids, never a raw email.
    expect(pf.collisions).toHaveLength(1);
    expect(pf.collisions[0].group).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(pf.collisions)).not.toContain(local);
  });

  it('preflight flags an inconsistent stored emailHash and is READ-ONLY', async () => {
    await seedPlaintext({ email: `ok.${uid()}@x.com` });
    await db.employee.create({ data: { phone: phone(), email: `bad.${uid()}@x.com`, fullName: 'Inc', emailHash: 'f'.repeat(64) } as never });

    const before = await db.employee.findMany({ orderBy: { id: 'asc' } });
    const pf = await preflightEmailNormalization({ client: db });
    expect(pf.inconsistentEmailHash).toBe(1);
    expect(pf.blockedForUniqueCutover).toBe(true);
    const after = await db.employee.findMany({ orderBy: { id: 'asc' } });
    expect(after).toEqual(before); // preflight wrote nothing
  });
});

describe('corrupted / inconsistent existing ciphertext', () => {
  it('a non-NULL ciphertext that fails to decrypt is flagged and NEVER overwritten or repaired', async () => {
    const p = phone();
    const garbage = 'v1:AAAA:BBBB:CCCC';
    const r = await db.employee.create({ data: { phone: p, fullName: 'Corrupt', phoneEncrypted: garbage } as never });
    const rep = await backfillEmployeePii({ client: db });
    expect(rep.inconsistentSkipped).toBe(1);
    expect(rep.backfilled).toBe(0);
    const after = await rowById(r.id);
    expect(after.phoneEncrypted).toBe(garbage); // left exactly as-is for operator review
    expect(await verifyEmployeePiiProtection({ client: db })).toMatchObject({ inconsistent: 1 });
  });
});

describe('fail-closed on missing / invalid keys (no partial record update)', () => {
  it('a missing DEK aborts the run and writes NO protected column', async () => {
    const p = phone();
    const r = await seedPlaintext({ phone: p, email: `k.${uid()}@x.com` });
    setKeyProvider({ getKey: () => { throw new MissingKeyError(); } });
    await expect(backfillEmployeePii({ client: db })).rejects.toThrow(MissingKeyError);
    const after = await rowById(r.id);
    expect(after.phoneEncrypted).toBeNull();
    expect(after.emailEncrypted).toBeNull();
    expect(after.emailHash).toBeNull();
    expect(after.phone).toBe(p); // plaintext intact — nothing deleted
  });

  it('a missing blind-index key aborts BEFORE the phone is written (no partial update of the record)', async () => {
    const p = phone();
    const r = await seedPlaintext({ phone: p, email: `b.${uid()}@x.com` });
    setBlindIndexKeyProvider({ getKey: () => { throw new MissingBlindIndexKeyError(); } });
    await expect(backfillEmployeePii({ client: db })).rejects.toThrow(MissingBlindIndexKeyError);
    const after = await rowById(r.id);
    // The row has an email, so email protection is attempted; because every
    // protected value is computed BEFORE any write, the blind-index failure
    // means the phone column is NOT written either.
    expect(after.phoneEncrypted).toBeNull();
    expect(after.emailEncrypted).toBeNull();
    expect(after.emailHash).toBeNull();
  });

  it('an interrupted run commits only the rows processed before the failure, and a re-run completes the rest', async () => {
    const phones: string[] = [];
    for (let i = 0; i < 6; i++) {
      const p = phone();
      phones.push(p);
      await seedPlaintext({ phone: p, email: null }); // phone-only → exactly one DEK call per row
    }
    // DEK that throws on the 4th getKey call → rows 1-3 commit, row 4 aborts.
    let calls = 0;
    setKeyProvider({ getKey: () => { if (++calls > 3) throw new MissingKeyError(); return Buffer.from(process.env.PII_DATA_KEY as string, 'base64'); } });
    await expect(backfillEmployeePii({ client: db, batchSize: 50 })).rejects.toThrow(MissingKeyError);
    setKeyProvider(realDek); // restore the real key before we decrypt anything to inspect state

    const protectedCount = await db.employee.count({ where: { phoneEncrypted: { not: null } } });
    expect(protectedCount).toBe(3);
    // Every row is in a clean state: phoneEncrypted is NULL or a valid envelope —
    // never a half-written / corrupt value.
    const all = await db.employee.findMany({ select: { phone: true, phoneEncrypted: true } });
    for (const row of all) {
      if (row.phoneEncrypted != null) expect(decryptField(row.phoneEncrypted)).toBe(normalizePhone(row.phone));
    }

    // Resume the run now that the key is back.
    const rep = await backfillEmployeePii({ client: db, batchSize: 50 });
    expect(rep.backfilled).toBe(3); // only the 3 that remained
    expect(rep.previouslyProtected).toBe(3);
    expect(rep.verified).toBe(6);
    expect(rep.remainingUnprotected).toBe(0);
  });
});

describe('concurrency & transactional integrity', () => {
  it('two simultaneous backfill runs protect every row exactly once (guarded, no double write)', async () => {
    const n = 12;
    // Phone-only rows: exactly one eligible column each, so "won once" is
    // unambiguous (a two-column row may legitimately have its phone claimed by
    // one runner and its email by the other).
    await db.employee.createMany({ data: Array.from({ length: n }, (_, i) => ({ phone: `+97154${String(i).padStart(8, '0')}`, fullName: `C${i}` })) as never });
    const [r1, r2] = await Promise.all([
      backfillEmployeePii({ client: db, batchSize: 5 }),
      backfillEmployeePii({ client: db, batchSize: 5 }),
    ]);
    expect(r1.backfilled + r2.backfilled).toBe(n); // each row claimed exactly once across both runs
    const v = await verifyEmployeePiiProtection({ client: db });
    expect(v.fullyProtectedAndVerified).toBe(n);
    expect(v.inconsistent).toBe(0);
  });

  it("the guard prevents a stale snapshot from overwriting a concurrent dual-write's newer value", async () => {
    const p1 = phone();
    const p2 = phone();
    const r = await seedPlaintext({ phone: p1, email: null }); // historical {p1, NULL}
    // A newer TASK-018.2 dual-write lands first: phone→p2 with its matching ciphertext.
    const ctP2 = protectEmployeePhone(p2).phoneEncrypted;
    await db.employee.update({ where: { id: r.id }, data: { phone: p2, phoneEncrypted: ctP2 } });
    // Replay the backfill's EXACT guarded statement with the stale {p1, NULL} snapshot.
    const u = await db.employee.updateMany({
      where: { id: r.id, phone: p1, phoneEncrypted: null },
      data: { phoneEncrypted: protectEmployeePhone(p1).phoneEncrypted },
    });
    expect(u.count).toBe(0); // guard matched nothing
    const after = await rowById(r.id);
    expect(after.phone).toBe(p2);
    expect(decryptField(after.phoneEncrypted)).toBe(normalizePhone(p2)); // newer value preserved
  });

  it('backfill concurrent with a dual-write leaves the row consistent under every interleaving', async () => {
    for (let i = 0; i < 5; i++) {
      await truncate();
      const p1 = phone();
      const p2 = phone();
      const r = await seedPlaintext({ phone: p1, email: null });
      const ct = protectEmployeePhone(p2).phoneEncrypted;
      await Promise.all([
        backfillEmployeePii({ client: db, batchSize: 50 }),
        db.employee.update({ where: { id: r.id }, data: { phone: p2, phoneEncrypted: ct } }),
      ]);
      const after = await rowById(r.id);
      // Whoever won, phoneEncrypted always decrypts to its own row's phone.
      expect(decryptField(after.phoneEncrypted)).toBe(normalizePhone(after.phone));
    }
  });

  it('a rolled-back transaction persists NO protected columns (backfill honours the caller tx)', async () => {
    for (let i = 0; i < 8; i++) await seedPlaintext({ email: `tx.${uid()}@x.com` });
    await expect(
      db.$transaction(async (tx) => {
        const rep = await backfillEmployeePii({ client: tx, batchSize: 50 });
        expect(rep.backfilled).toBe(8); // visible inside the tx
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');
    // After rollback nothing is protected.
    const v = await verifyEmployeePiiProtection({ client: db });
    expect(v.fullyProtectedAndVerified).toBe(0);
    expect(v.remainingUnprotected).toBe(8);
  });
});

describe('scale & memory safety', () => {
  it('backfills a large set across many bounded batches (keyset-paginated, never the whole table)', async () => {
    const n = 300;
    await db.employee.createMany({
      data: Array.from({ length: n }, (_, i) => ({ phone: `+97150${String(i).padStart(8, '0')}`, fullName: `Bulk${i}`, email: i % 2 === 0 ? `bulk.${i}.${uid()}@x.com` : null })) as never,
    });
    const rep = await backfillEmployeePii({ client: db, batchSize: 50 });
    expect(rep.scanned).toBe(n);
    expect(rep.backfilled).toBe(n);
    expect(rep.batches).toBeGreaterThanOrEqual(n / 50);
    expect(rep.verified).toBe(n);
    expect(rep.remainingUnprotected).toBe(0);
  });
});

describe('no financial / ledger / KYC mutation', () => {
  it('the backfill changes ONLY the three protected columns; every other field is untouched', async () => {
    const mk = (over: Record<string, unknown>) => db.employee.create({ data: { phone: phone(), fullName: 'Fin', ...over } as never });
    await mk({ email: `f1.${uid()}@x.com`, walletBalance: 1234.56, salary: 9000, status: 'ACTIVE', kycVerifiedAt: new Date('2024-01-02T03:04:05.000Z'), creditScore: 73, plan: 'LUXURY', nymcardCustomerId: 'nym-xyz' });
    await mk({ email: null, walletBalance: 0, status: 'PENDING_KYC' });
    await mk({ email: `f3.${uid()}@x.com`, walletBalance: 50, salary: 3000, status: 'BLOCKED' });

    const cols = { id: true, phone: true, email: true, fullName: true, walletBalance: true, salary: true, status: true, kycVerifiedAt: true, creditScore: true, plan: true, nymcardCustomerId: true, companyId: true, referralCode: true } as const;
    const before = await db.employee.findMany({ orderBy: { id: 'asc' }, select: cols });

    await backfillEmployeePii({ client: db });

    const after = await db.employee.findMany({ orderBy: { id: 'asc' }, select: cols });
    expect(after).toEqual(before); // financial, KYC, plan, plaintext PII all identical
    // Dependent financial/compliance tables are never written.
    expect(await db.ledgerEntry.count()).toBe(0);
    expect(await db.employeeTransaction.count()).toBe(0);
    expect(await db.card.count()).toBe(0);
    expect(await db.kycDocument.count()).toBe(0);
  });
});
