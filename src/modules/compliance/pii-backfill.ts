import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { encryptField, encryptNumber, hashIdentifier } from '@shared/security/pii-crypto';

/**
 * PII backfill job — Day-Zero hardening (Advisory Board §1.2).
 *
 * Migrates plaintext employee PII into the AES-256-GCM envelope columns
 * (`fullNameEncrypted`, `salaryEncrypted`) + the phone equality hash
 * (`phoneHash`). Encryption is application-layer, so this CANNOT be a
 * SQL `UPDATE` — it must read plaintext, envelope it in-process, and
 * write back.
 *
 * Properties:
 *   • Cursor-paginated by `id` (ascending), 500-row chunks — bounded
 *     memory, no long table lock; each chunk is its own short write.
 *   • Idempotent — a row already carrying an envelope is skipped, so
 *     a re-run (after a crash, or to pick up newly-created rows) is
 *     safe and cheap.
 *   • Reconciliation gate — returns the count of rows STILL missing an
 *     envelope so the operator can assert 0 before running the
 *     plaintext-drop migration.
 *
 * Run BEFORE binding the prod traffic to the encrypted read path and
 * BEFORE dropping the plaintext columns. The KMS key provider must
 * already be bound (see kms-key-provider.ts) — this job encrypts under
 * whatever key is active, so running it with the dev key then dropping
 * plaintext would strand the data. Sequence: bind KMS key → backfill →
 * verify remaining == 0 → drop plaintext.
 */

const DEFAULT_BATCH_SIZE = 500;

export interface PiiBackfillResult {
  scanned: number;
  updated: number;
  /** Rows that still lack a name envelope after the run (should be 0). */
  remainingUnencrypted: number;
  batches: number;
}

export interface PiiBackfillOptions {
  batchSize?: number;
  /** Cap the number of batches (for a dry-run / canary). Unbounded by default. */
  maxBatches?: number;
}

export async function runPiiBackfill(
  options: PiiBackfillOptions = {},
): Promise<PiiBackfillResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? Infinity;

  let cursor: string | undefined;
  let scanned = 0;
  let updated = 0;
  let batches = 0;

  // Cursor scan over the full table by id. Done rows are skipped by the
  // per-row envelope check, so re-running is idempotent.
  for (;;) {
    if (batches >= maxBatches) break;

    const rows = await prisma.employee.findMany({
      take: batchSize,
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        fullName: true,
        salary: true,
        phone: true,
        fullNameEncrypted: true,
        salaryEncrypted: true,
        phoneHash: true,
      },
    });

    if (rows.length === 0) break;
    batches += 1;
    scanned += rows.length;

    for (const row of rows) {
      const data: {
        fullNameEncrypted?: string;
        salaryEncrypted?: string;
        phoneHash?: string;
      } = {};

      // Only write fields that are missing their envelope/hash — the
      // idempotency guard.
      if (!row.fullNameEncrypted && row.fullName) {
        const enc = encryptField(row.fullName);
        if (enc) data.fullNameEncrypted = enc;
      }
      if (!row.salaryEncrypted && row.salary !== null && row.salary !== undefined) {
        const enc = encryptNumber(row.salary);
        if (enc) data.salaryEncrypted = enc;
      }
      if (!row.phoneHash && row.phone) {
        data.phoneHash = hashIdentifier(row.phone);
      }

      if (Object.keys(data).length > 0) {
        await prisma.employee.update({ where: { id: row.id }, data });
        updated += 1;
      }
    }

    cursor = rows[rows.length - 1].id;
    logger.info('pii backfill batch complete', {
      batch: batches,
      scanned,
      updated,
      lastId: cursor,
    });
  }

  // Reconciliation: rows that have a name but no envelope. Must be 0
  // before the plaintext columns are dropped.
  const remainingUnencrypted = await prisma.employee.count({
    where: { fullNameEncrypted: null },
  });

  logger.info('pii backfill complete', {
    scanned,
    updated,
    batches,
    remainingUnencrypted,
  });

  return { scanned, updated, remainingUnencrypted, batches };
}
