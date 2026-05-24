import { Prisma } from '@prisma/client';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { AppError } from '@shared/utils/errors';

/**
 * Cohort canary failsafe — the circuit breaker mandated by
 * STRATEGY.md §C.3. Closes the audit finding that the 1.5% canary was
 * detection-only.
 *
 * Lifecycle:
 *
 *   1. The metrics canary detector (ops-intel/metrics.service.ts)
 *      computes per-cohort uncollectible rate. Any cohort ≥ 1.5%
 *      (CANARY_DEFAULT_RATE) is passed to `tripCohortFailsafe`.
 *
 *   2. `tripCohortFailsafe` sets Company.ewaFailsafeActive=true +
 *      audit metadata. Idempotent — re-tripping an already-tripped
 *      cohort just refreshes the ratio/reason.
 *
 *   3. `reserveAdvance` reads the flag INSIDE the atomic settlement
 *      transaction (snapshot-consistent with the I1 check) and caps
 *      the worker's advance at 20% of verifiable accrued wages
 *      (FAILSAFE_ACCRUED_CAP_FRACTION). The cap is independent of the
 *      DCSE's own output — even if the DCSE (or its cache) still says
 *      a higher limit, the failsafe overrides.
 *
 *   4. Clearing requires a two-person rule (`clearCohortFailsafe`):
 *      two distinct approver ids. This matches §C.3's "re-promoted by
 *      a two-person rule".
 *
 * Per-cohort by construction: the flag lives on the Company row, so a
 * single tripped employer caps only ITS workers. Every other cohort
 * keeps full autonomous limits — global uptime is preserved.
 */

/** STRATEGY §C.3 post-trip hard cap: 20% of verifiable accrued wages. */
export const FAILSAFE_ACCRUED_CAP_FRACTION = 0.2;

/**
 * Pure helper: the maximum advance a worker may take given their
 * accrued wages and whether their cohort's failsafe is active.
 *
 *   normal     → accruedAmount               (I1 ceiling)
 *   failsafe   → 0.20 × accruedAmount         (§C.3 hard cap)
 *
 * Rounded to 2dp (fils precision) to match the DECIMAL(12,2) ledger.
 */
export function effectiveAccruedCap(accruedAmount: number, failsafeActive: boolean): number {
  const cap = failsafeActive ? accruedAmount * FAILSAFE_ACCRUED_CAP_FRACTION : accruedAmount;
  return Math.round(cap * 100) / 100;
}

/**
 * Read the cohort failsafe flag for a company INSIDE a transaction.
 * Always pass the tx client from reserveAdvance so the read shares the
 * MVCC snapshot with the I1 check and the subsequent ledger writes.
 */
export async function isCohortFailsafeActive(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<boolean> {
  const company = await tx.company.findUnique({
    where: { id: companyId },
    select: { ewaFailsafeActive: true },
  });
  return company?.ewaFailsafeActive ?? false;
}

/**
 * Trip the failsafe for a single cohort. Idempotent. Writes an
 * append-only AuditLog entry on the first trip (not on idempotent
 * re-trips of an already-active cohort).
 */
export async function tripCohortFailsafe(
  companyId: string,
  opts: { reason: string; defaultRatio: number },
): Promise<{ tripped: boolean; alreadyActive: boolean }> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { ewaFailsafeActive: true },
  });
  if (!company) {
    throw new AppError(404, 'COMPANY_NOT_FOUND', `Company ${companyId} not found`);
  }
  if (company.ewaFailsafeActive) {
    // Refresh the observed ratio for ops visibility but don't re-log.
    await prisma.company.update({
      where: { id: companyId },
      data: { ewaFailsafeDefaultRatio: opts.defaultRatio, ewaFailsafeReason: opts.reason },
    });
    return { tripped: false, alreadyActive: true };
  }

  await prisma.$transaction(async (tx) => {
    await tx.company.update({
      where: { id: companyId },
      data: {
        ewaFailsafeActive: true,
        ewaFailsafeTrippedAt: new Date(),
        ewaFailsafeReason: opts.reason,
        ewaFailsafeDefaultRatio: opts.defaultRatio,
      },
    });
    await tx.auditLog.create({
      data: {
        actorType: 'system',
        actorId: 'canary:dcse',
        action: 'COHORT_FAILSAFE_TRIPPED',
        resourceType: 'Company',
        resourceId: companyId,
        metadata: {
          reason: opts.reason,
          defaultRatio: opts.defaultRatio,
          capFraction: FAILSAFE_ACCRUED_CAP_FRACTION,
        } as Prisma.InputJsonValue,
      },
    });
  });

  logger.warn('cohort failsafe TRIPPED — autonomous EWA limits capped at 20% accrued', {
    companyId,
    reason: opts.reason,
    defaultRatio: opts.defaultRatio,
  });
  return { tripped: true, alreadyActive: false };
}

/**
 * Clear the failsafe for a cohort. Two-person rule (STRATEGY §C.3):
 * `approverA` and `approverB` must be distinct, non-empty ids. Both
 * are recorded on the audit trail.
 */
export async function clearCohortFailsafe(
  companyId: string,
  opts: { approverA: string; approverB: string; note?: string },
): Promise<void> {
  if (!opts.approverA || !opts.approverB) {
    throw new AppError(400, 'TWO_PERSON_RULE', 'Two distinct approver ids are required to clear a failsafe');
  }
  if (opts.approverA === opts.approverB) {
    throw new AppError(400, 'TWO_PERSON_RULE', 'Failsafe clear requires two DIFFERENT approvers');
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { ewaFailsafeActive: true },
  });
  if (!company) throw new AppError(404, 'COMPANY_NOT_FOUND', `Company ${companyId} not found`);
  if (!company.ewaFailsafeActive) {
    return; // idempotent — already clear
  }

  await prisma.$transaction(async (tx) => {
    await tx.company.update({
      where: { id: companyId },
      data: {
        ewaFailsafeActive: false,
        ewaFailsafeTrippedAt: null,
        ewaFailsafeReason: null,
        ewaFailsafeDefaultRatio: null,
      },
    });
    await tx.auditLog.create({
      data: {
        actorType: 'admin',
        actorId: opts.approverA,
        action: 'COHORT_FAILSAFE_CLEARED',
        resourceType: 'Company',
        resourceId: companyId,
        metadata: {
          approverA: opts.approverA,
          approverB: opts.approverB,
          note: opts.note ?? null,
        } as Prisma.InputJsonValue,
      },
    });
  });

  logger.info('cohort failsafe CLEARED (two-person rule)', {
    companyId,
    approverA: opts.approverA,
    approverB: opts.approverB,
  });
}

/**
 * Trip every cohort the canary flagged. Called by the metrics
 * compiler after detection. Does NOT auto-clear cohorts that have
 * recovered — clearing is a deliberate two-person action per §C.3, so
 * a cohort that briefly dips back under 1.5% is not silently
 * un-tripped (avoids flapping the circuit breaker).
 */
export async function syncCohortFailsafesFromCanary(
  breaches: Array<{ companyId: string; defaultRatio: number }>,
): Promise<{ trippedCount: number }> {
  let trippedCount = 0;
  for (const b of breaches) {
    try {
      const r = await tripCohortFailsafe(b.companyId, {
        reason: 'CANARY_DEFAULT_RATE_BREACH',
        defaultRatio: b.defaultRatio,
      });
      if (r.tripped) trippedCount += 1;
    } catch (err) {
      logger.error('cohort failsafe trip failed', {
        companyId: b.companyId,
        error: (err as Error).message,
      });
    }
  }
  return { trippedCount };
}
