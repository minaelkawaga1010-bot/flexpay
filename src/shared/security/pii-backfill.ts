import { createHash } from 'crypto';
import { prisma as defaultPrisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { decryptField, MissingKeyError } from './pii-crypto';
import {
  normalizePhone,
  normalizeEmail,
  blindIndexEmail,
  protectEmployeePhone,
  protectEmployeeEmail,
  MissingBlindIndexKeyError,
} from './employee-pii';

/**
 * Historical PII backfill + preflight + verification (TASK-018.3).
 *
 * OPS TOOLING ONLY — not wired into any request path. It populates the
 * protected columns (phoneEncrypted / emailEncrypted / emailHash) on EXISTING
 * Employee rows that predate the TASK-018.2 dual-write, reading the plaintext
 * as historical source and never interpreting it as ciphertext. It touches
 * ONLY those three columns; fullName, salary, phoneHash, status, balances,
 * KYC evidence and transactions are never modified.
 *
 * Safety properties:
 *   • resumable + idempotent — keyset-paginated, bounded batches; a re-run
 *     skips already-protected rows; the whole table is never loaded at once;
 *   • concurrency-safe — each write is a GUARDED updateMany that only fills a
 *     still-NULL column AND matches the exact plaintext it read, so a
 *     concurrent TASK-018.2 dual-write (newer value) is never overwritten;
 *   • fail-closed — a missing/invalid DEK or blind-index key aborts the run
 *     before any further row is touched; a single malformed/inconsistent row
 *     is recorded (sanitised) and skipped, never force-overwritten;
 *   • verified by decryption — a row counts as protected only when the
 *     ciphertext decrypts back to the canonical plaintext and the emailHash
 *     recomputes, not merely because a column is non-NULL.
 *
 * Nothing here logs raw PII, keys, or full ciphertext — counts and opaque
 * row ids only.
 */

const DEFAULT_BATCH = 500;
/** Minimal structural email check for preflight classification only. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Client = Pick<typeof defaultPrisma, 'employee'>;

interface EmployeePiiRow {
  id: string;
  phone: string;
  email: string | null;
  phoneEncrypted: string | null;
  emailEncrypted: string | null;
  emailHash: string | null;
}

const SELECT = {
  id: true,
  phone: true,
  email: true,
  phoneEncrypted: true,
  emailEncrypted: true,
  emailHash: true,
} as const;

/** Opaque group key for a canonical email — a short hash, never the raw value. */
const canonKey = (normalised: string): string => createHash('sha256').update(normalised).digest('hex').slice(0, 16);

const isKeyError = (err: unknown): boolean =>
  err instanceof MissingKeyError || err instanceof MissingBlindIndexKeyError;

async function* scanEmployees(client: Client, batchSize: number): AsyncGenerator<EmployeePiiRow[]> {
  let cursor: string | undefined;
  for (;;) {
    const batch = (await client.employee.findMany({
      select: SELECT,
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })) as EmployeePiiRow[];
    if (batch.length === 0) return;
    yield batch;
    cursor = batch[batch.length - 1].id;
    if (batch.length < batchSize) return;
  }
}

// ───────────────────────────────────────────────────────────────────
// Phase 2 — email normalisation preflight (READ-ONLY)
// ───────────────────────────────────────────────────────────────────

/** Pure classification of a raw email for preflight. */
export function classifyEmail(raw: string): {
  normalized: string;
  empty: boolean;
  caseOnly: boolean;
  whitespacePadded: boolean;
  malformed: boolean;
  suspiciousUnicode: boolean;
} {
  const trimmed = raw.trim();
  const normalized = trimmed.toLowerCase();
  // Unpaired surrogates or control chars → cannot be reliably canonicalised.
  // eslint-disable-next-line no-control-regex
  const suspiciousUnicode = /[\u0000-\u001f\u007f]/.test(raw) || /[\uD800-\uDFFF]/.test(raw.normalize('NFC'));
  return {
    normalized,
    empty: trimmed === '',
    whitespacePadded: raw !== trimmed,
    caseOnly: trimmed !== normalized, // differs from its lowercase only by case
    malformed: trimmed !== '' && !EMAIL_RE.test(trimmed),
    suspiciousUnicode,
  };
}

export interface PreflightReport {
  scanned: number;
  emailsPresent: number;
  emptyStringEmails: number;
  whitespacePadded: number;
  caseOnlyNormalisation: number;
  malformedEmails: number;
  suspiciousUnicode: number;
  canonicalCollisionGroups: number;
  canonicalCollisionRows: number;
  inconsistentEmailHash: number;
  /** Opaque collision groups: a hash key + member row ids (no raw email). */
  collisions: Array<{ group: string; count: number; rowIds: string[] }>;
  /** A future UNIQUE(emailHash) or lookup cutover is BLOCKED while true. */
  blockedForUniqueCutover: boolean;
}

/**
 * Detect normalisation-identity conflicts: distinct plaintext emails (e.g.
 * case-only variants, the TASK-018.2 issue) that collapse to one canonical
 * value and would therefore share an emailHash. Read-only — never merges,
 * deletes, or picks a survivor.
 */
export async function preflightEmailNormalization(
  opts: { client?: Client; batchSize?: number } = {},
): Promise<PreflightReport> {
  const client = opts.client ?? defaultPrisma;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH;

  const r: PreflightReport = {
    scanned: 0,
    emailsPresent: 0,
    emptyStringEmails: 0,
    whitespacePadded: 0,
    caseOnlyNormalisation: 0,
    malformedEmails: 0,
    suspiciousUnicode: 0,
    canonicalCollisionGroups: 0,
    canonicalCollisionRows: 0,
    inconsistentEmailHash: 0,
    collisions: [],
    blockedForUniqueCutover: false,
  };
  // canonical → set of distinct raw emails + row ids (bounded by email count).
  const byCanonical = new Map<string, { rawSet: Set<string>; rowIds: string[] }>();

  for await (const batch of scanEmployees(client, batchSize)) {
    for (const row of batch) {
      r.scanned++;
      if (row.email == null) continue;
      r.emailsPresent++;
      const c = classifyEmail(row.email);
      if (c.empty) {
        r.emptyStringEmails++;
        continue;
      }
      if (c.whitespacePadded) r.whitespacePadded++;
      if (c.caseOnly) r.caseOnlyNormalisation++;
      if (c.malformed) r.malformedEmails++;
      if (c.suspiciousUnicode) r.suspiciousUnicode++;
      if (row.emailHash != null && !c.suspiciousUnicode && row.emailHash !== blindIndexEmail(row.email)) {
        r.inconsistentEmailHash++;
      }
      const entry = byCanonical.get(c.normalized) ?? { rawSet: new Set<string>(), rowIds: [] };
      entry.rawSet.add(row.email);
      entry.rowIds.push(row.id);
      byCanonical.set(c.normalized, entry);
    }
  }

  for (const [canonical, entry] of byCanonical) {
    // A collision that matters: >1 DISTINCT raw email (or >1 row) sharing one
    // canonical value — these would clash under a unique emailHash.
    if (entry.rowIds.length > 1) {
      r.canonicalCollisionGroups++;
      r.canonicalCollisionRows += entry.rowIds.length;
      r.collisions.push({ group: canonKey(canonical), count: entry.rowIds.length, rowIds: entry.rowIds });
    }
  }
  r.blockedForUniqueCutover = r.canonicalCollisionGroups > 0 || r.inconsistentEmailHash > 0;

  logger.info('pii backfill preflight complete', {
    scanned: r.scanned,
    emailsPresent: r.emailsPresent,
    canonicalCollisionGroups: r.canonicalCollisionGroups,
    inconsistentEmailHash: r.inconsistentEmailHash,
    blockedForUniqueCutover: r.blockedForUniqueCutover,
  });
  return r;
}

// ───────────────────────────────────────────────────────────────────
// Phase 4 — decrypt-and-compare verification
// ───────────────────────────────────────────────────────────────────

/** True only when every populated protected column decrypts/recomputes to the committed plaintext. */
export function rowIsConsistent(row: EmployeePiiRow): boolean {
  if (row.phoneEncrypted != null) {
    try {
      if (decryptField(row.phoneEncrypted) !== normalizePhone(row.phone)) return false;
    } catch {
      return false;
    }
  }
  const hasEmail = row.email != null && row.email.trim() !== '';
  if (row.emailEncrypted != null) {
    if (!hasEmail) return false;
    try {
      if (decryptField(row.emailEncrypted) !== normalizeEmail(row.email as string)) return false;
    } catch {
      return false;
    }
  }
  if (row.emailHash != null) {
    if (!hasEmail || row.emailHash !== blindIndexEmail(row.email as string)) return false;
  }
  return true;
}

export interface VerifyReport {
  scanned: number;
  fullyProtectedAndVerified: number;
  remainingUnprotected: number;
  inconsistent: number;
}

export async function verifyEmployeePiiProtection(
  opts: { client?: Client; batchSize?: number } = {},
): Promise<VerifyReport> {
  const client = opts.client ?? defaultPrisma;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH;
  const r: VerifyReport = { scanned: 0, fullyProtectedAndVerified: 0, remainingUnprotected: 0, inconsistent: 0 };
  for await (const batch of scanEmployees(client, batchSize)) {
    for (const row of batch) {
      r.scanned++;
      const hasEmail = row.email != null && row.email.trim() !== '';
      const phoneDone = row.phoneEncrypted != null;
      const emailDone = !hasEmail || (row.emailEncrypted != null && row.emailHash != null);
      if (!rowIsConsistent(row)) {
        r.inconsistent++;
      } else if (phoneDone && emailDone) {
        r.fullyProtectedAndVerified++;
      } else {
        r.remainingUnprotected++;
      }
    }
  }
  return r;
}

// ───────────────────────────────────────────────────────────────────
// Phase 3 — resumable, guarded, idempotent backfill
// ───────────────────────────────────────────────────────────────────

export interface BackfillReport {
  batches: number;
  scanned: number;
  eligible: number;
  backfilled: number;
  previouslyProtected: number;
  skippedRaced: number;
  emptyOrNullEmail: number;
  malformedSkipped: number;
  inconsistentSkipped: number;
  failed: number;
  verified: number;
  remainingUnprotected: number;
}

/**
 * Backfill the protected columns on eligible Employee rows. SYNTHETIC
 * DISPOSABLE DATABASES ONLY — callers must point `client` at an isolated DB.
 */
export async function backfillEmployeePii(
  opts: { client?: Client; batchSize?: number; actorId?: string } = {},
): Promise<BackfillReport> {
  const client = opts.client ?? defaultPrisma;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH;
  const rep: BackfillReport = {
    batches: 0,
    scanned: 0,
    eligible: 0,
    backfilled: 0,
    previouslyProtected: 0,
    skippedRaced: 0,
    emptyOrNullEmail: 0,
    malformedSkipped: 0,
    inconsistentSkipped: 0,
    failed: 0,
    verified: 0,
    remainingUnprotected: 0,
  };

  for await (const batch of scanEmployees(client, batchSize)) {
    rep.batches++;
    for (const row of batch) {
      rep.scanned++;
      const hasEmail = row.email != null && row.email.trim() !== '';
      const emailClass = hasEmail ? classifyEmail(row.email as string) : null;
      // An email we cannot safely canonicalise (malformed structure or control
      // chars) is never force-encrypted — only structurally valid emails.
      const emailProtectable = emailClass != null && !emailClass.malformed && !emailClass.suspiciousUnicode;
      const phoneEligible = row.phoneEncrypted == null;
      const emailEligible = emailProtectable && row.emailEncrypted == null;
      if (phoneEligible || emailEligible) rep.eligible++;
      if (!hasEmail) rep.emptyOrNullEmail++;

      let rowBackfilled = false;
      let rowFlagged = false;
      try {
        // Compute EVERY protected value for this row BEFORE issuing any write.
        // A missing/invalid DEK or blind-index key throws here, so a key
        // failure aborts the row with NOTHING written — a record is never left
        // partially updated (phone written, email not) on a key failure.
        const phoneData = phoneEligible ? protectEmployeePhone(row.phone) : null;
        const emailData = emailEligible ? protectEmployeeEmail(row.email) : null;

        // Guarded writes: only fill a still-NULL column for the EXACT plaintext
        // we read. A concurrent newer dual-write (changed value, or a column
        // already populated) loses the guard match (count 0) and is preserved —
        // the backfill never overwrites a newer value or existing ciphertext.
        if (phoneData) {
          const u = await client.employee.updateMany({
            where: { id: row.id, phone: row.phone, phoneEncrypted: null },
            data: phoneData,
          });
          if (u.count === 1) rowBackfilled = true;
          else rep.skippedRaced++;
        }
        if (emailData) {
          const u = await client.employee.updateMany({
            where: { id: row.id, email: row.email, emailEncrypted: null },
            data: emailData,
          });
          if (u.count === 1) rowBackfilled = true;
          else rep.skippedRaced++;
        }

        // Record (never fix) an email that could not be canonicalised.
        if (hasEmail && !emailProtectable && row.emailEncrypted == null) {
          rep.malformedSkipped++;
          rowFlagged = true;
        }
        // Already-populated protected columns are verify-only, never
        // overwritten; a value that fails to decrypt / recompute is flagged as
        // an inconsistency for operator review (possible tampering).
        if (!phoneEligible && !safeDecryptEquals(row.phoneEncrypted as string, normalizePhone(row.phone))) {
          rep.inconsistentSkipped++;
          rowFlagged = true;
        }
        if (hasEmail && emailProtectable && !emailEligible && row.emailEncrypted != null) {
          const okCt = safeDecryptEquals(row.emailEncrypted, normalizeEmail(row.email as string));
          const okHash = row.emailHash != null && row.emailHash === blindIndexEmail(row.email as string);
          if (!okCt || !okHash) {
            rep.inconsistentSkipped++;
            rowFlagged = true;
          }
        }
      } catch (err) {
        if (isKeyError(err)) {
          // Fail closed: abort the whole run before touching any further row.
          // Rows already committed stay valid; a re-run after the key is
          // restored resumes from the remaining eligible rows.
          logger.error('pii backfill aborted — key unavailable (fail-closed)', { reason: (err as Error).name });
          throw err;
        }
        // Per-row data error: record sanitised (id + error name only) and continue.
        rep.failed++;
        logger.warn('pii backfill: row failed, skipped', { rowId: row.id, reason: (err as Error).name });
        continue;
      }

      if (rowBackfilled) rep.backfilled++;
      else if (!phoneEligible && !emailEligible && !rowFlagged) rep.previouslyProtected++;
    }
  }

  // Final decrypt-and-compare pass (req 31/37): protected ≠ merely non-NULL.
  const v = await verifyEmployeePiiProtection({ client, batchSize });
  rep.verified = v.fullyProtectedAndVerified;
  rep.remainingUnprotected = v.remainingUnprotected;

  logger.info('pii backfill complete', {
    scanned: rep.scanned,
    eligible: rep.eligible,
    backfilled: rep.backfilled,
    verified: rep.verified,
    remainingUnprotected: rep.remainingUnprotected,
    failed: rep.failed,
    inconsistentSkipped: rep.inconsistentSkipped,
  });
  return rep;
}

function safeDecryptEquals(envelope: string, expected: string): boolean {
  try {
    return decryptField(envelope) === expected;
  } catch {
    return false;
  }
}
