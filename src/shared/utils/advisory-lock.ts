import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { prisma } from '@config/prisma';
import logger from './logger';

/**
 * Postgres advisory-lock helper for serializing per-worker financial
 * operations.
 *
 * Required by FlexPay CTO Bible §1.4. Without this lock, two concurrent
 * EWA requests for the same worker can both pass the
 * `amount ≤ accruedAmount` gate at READ COMMITTED isolation (each one
 * sees the not-yet-committed advance of the other as nonexistent),
 * producing a double-advance that violates Invariant I1. The lock is
 * `pg_advisory_xact_lock` — held by the transaction, released
 * automatically on COMMIT or ROLLBACK.
 *
 * The lock key is a deterministic 32-bit signed integer derived from
 * the worker UUID. Postgres takes a `bigint` argument so we widen the
 * 32-bit hash safely.
 *
 * Usage (inside any Prisma $transaction):
 *
 *   await prisma.$transaction(async (tx) => {
 *     await acquireWorkerLock(tx, workerId);
 *     // ... read intent / advance / wallet ...
 *     // ... write ledger entries ...
 *   });
 *
 * IMPORTANT: the lock is per-transaction and must be taken on the `tx`
 * of the operation it protects. On the global prisma client the
 * statement runs as its own autocommit transaction on an arbitrary
 * pooled connection, so the lock is released the moment it is granted
 * and serializes nothing. The `TransactionClient` parameter type does
 * not prevent that (the global client is structurally assignable), so
 * the helpers check at runtime and throw instead.
 */

/**
 * Deterministic 32-bit signed integer hash of a UUID. Stable across
 * processes — two API instances hashing the same UUID produce the same
 * key, so contention is correctly serialised cluster-wide.
 *
 * Uses SHA-256 truncated to 4 bytes, then re-interpreted as a signed
 * int32. The collision space is 2^32 (~4B) — for the worker count we
 * support (<= 10M), false-collision contention is statistically
 * negligible and the failure mode is "two unrelated workers serialise
 * briefly" which is harmless.
 */
export function workerLockKey(workerId: string): number {
  const digest = createHash('sha256').update(workerId, 'utf8').digest();
  // Read first 4 bytes as a signed big-endian int32. Postgres'
  // pg_advisory_xact_lock(bigint) accepts either a single bigint or
  // a (int4, int4) pair. We use the single-bigint form by sign-
  // extending the int32 into a bigint via Number.
  return digest.readInt32BE(0);
}

/**
 * Fail closed unless `tx` is an interactive-transaction client. Those
 * clients do not expose `$transaction`; the global client does.
 */
function assertInteractiveTransaction(tx: Prisma.TransactionClient): void {
  if (typeof (tx as { $transaction?: unknown }).$transaction === 'function') {
    throw new Error('Advisory locks must be acquired inside prisma.$transaction(async (tx) => ...)');
  }
}

/**
 * Acquire the per-worker advisory lock inside the given transaction.
 * Held until the transaction commits or rolls back.
 *
 * pg_advisory_xact_lock returns `void`, which Prisma cannot deserialize
 * from $queryRaw ("Failed to deserialize column of type 'void'") — that
 * error rolled back every locked transaction (TASK-008). The `::text`
 * cast yields one deserializable row and changes nothing else: the
 * VOLATILE call still runs on `tx`'s connection inside its transaction
 * and blocks until granted. Any failure (lock_timeout, transaction
 * timeout, lost connection) propagates — nothing continues unlocked.
 */
export async function acquireWorkerLock(
  tx: Prisma.TransactionClient,
  workerId: string,
): Promise<void> {
  assertInteractiveTransaction(tx);
  const key = workerLockKey(workerId);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key}::bigint)::text AS locked`;
  logger.debug('worker advisory lock acquired', { workerId, key });
}

/**
 * Composite key variant: serializes on (workerId, scope) so an EWA
 * reservation and an unrelated card-spend write don't block each
 * other when both touch the same worker but different invariants.
 *
 * Scope is a 32-bit signed int derived from a string label. Reserved
 * scopes:
 *   1  EWA_RESERVATION    — reserveAdvance
 *   2  EWA_RECOVERY       — WPS settlement recovery
 *   3  WALLET_DEBIT       — card / remittance debit
 *   4  COMPLIANCE_REVIEW  — incident open/resolve
 */
export const LockScope = {
  EWA_RESERVATION: 1,
  EWA_RECOVERY: 2,
  WALLET_DEBIT: 3,
  COMPLIANCE_REVIEW: 4,
} as const;
export type LockScope = (typeof LockScope)[keyof typeof LockScope];

export async function acquireWorkerLockScoped(
  tx: Prisma.TransactionClient,
  workerId: string,
  scope: LockScope,
): Promise<void> {
  assertInteractiveTransaction(tx);
  const key = workerLockKey(workerId);
  // The two-int form: pg_advisory_xact_lock(key1, key2), with the same
  // void-safe cast as acquireWorkerLock.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key}::int4, ${scope}::int4)::text AS locked`;
  logger.debug('worker advisory lock acquired (scoped)', { workerId, key, scope });
}

/**
 * Convenience wrapper for the common case: open a transaction and
 * acquire the lock as the first statement. Use this when the entire
 * scope of the transaction is "do an EWA-touching thing for one
 * worker."
 */
export async function withWorkerLock<T>(
  workerId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { timeout?: number; maxWait?: number } = {},
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await acquireWorkerLock(tx, workerId);
      return fn(tx);
    },
    {
      maxWait: options.maxWait ?? 5_000,
      timeout: options.timeout ?? 30_000,
    },
  );
}
