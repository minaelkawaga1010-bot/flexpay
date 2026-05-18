import { Prisma, PayrollCycleStatus } from '@prisma/client';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { cron } from '@shared/utils/cron';

/**
 * Reconciliation worker.
 *
 * Runs twice daily at 14:00 and 22:00 UAE time — the windows that
 * bracket the two CBUAE / clearing-bank SIF settlement passes (Appendix
 * C.1 of docs/STRATEGY.md). Augmented by the real-time NymCard webhook
 * listener for per-card failure states.
 *
 * For each SETTLED cycle, the invariant `Σ LedgerEntry.delta per
 * (employee, cycle) === 0` must hold (I3). Any non-zero residual is
 * ledger drift — we surface it via the AuditLog, raise an ops alert,
 * and pause the bin-sponsor rail for the affected cycle until cleared.
 */

const DRIFT_TOLERANCE = 0.01; // 1 fil — for floating-point noise only

export interface DriftReport {
  cycleId: string;
  employeeId: string;
  expected: 0;
  actual: number;
}

export async function reconcileSettledCycles(): Promise<DriftReport[]> {
  // Net per (employeeId, cycleId) for every cycle in SETTLED state.
  const rows = await prisma.$queryRaw<
    Array<{ cycleId: string; employeeId: string; net: Prisma.Decimal | number }>
  >(Prisma.sql`
    SELECT
      "cycleId"      AS "cycleId",
      "employeeId"   AS "employeeId",
      SUM("delta")::float AS "net"
    FROM ledger_entries
    WHERE "cycleId" IN (
      SELECT id FROM payroll_cycles WHERE status = ${PayrollCycleStatus.SETTLED}::text
    )
    GROUP BY "cycleId", "employeeId"
  `);

  const drift = rows
    .map((r) => ({
      cycleId: r.cycleId,
      employeeId: r.employeeId,
      actual: typeof r.net === 'number' ? r.net : Number(r.net),
    }))
    .filter((r) => Math.abs(r.actual) > DRIFT_TOLERANCE)
    .map((r) => ({ ...r, expected: 0 as const }));

  if (drift.length === 0) {
    logger.info('reconciliation: no drift detected');
    return [];
  }

  logger.error('reconciliation: drift detected', { count: drift.length });

  // Mark the affected cycles FAILED so the rail circuit-breaker trips.
  // Real-time advance requests against a FAILED cycle are rejected
  // upstream in reserveAdvance().
  const affectedCycles = Array.from(new Set(drift.map((d) => d.cycleId)));
  await prisma.payrollCycle.updateMany({
    where: { id: { in: affectedCycles } },
    data: {
      status: PayrollCycleStatus.FAILED,
      failureReason: `Ledger drift detected by reconciliation at ${new Date().toISOString()}`,
    },
  });

  // Append an immutable audit record so ops + regulators can trace.
  await prisma.auditLog.create({
    data: {
      actorType: 'system',
      actorId: 'reconciliation-worker',
      action: 'LEDGER_DRIFT_DETECTED',
      resourceType: 'PayrollCycle',
      metadata: { drift } as Prisma.InputJsonValue,
    },
  });

  return drift;
}

/**
 * Register the cron schedules with the centralised CronManager. Called
 * once at boot from `savings.job#registerCronJobs` (or its successor).
 *
 * The cron expressions are interpreted in `Asia/Dubai` via the
 * CronManager defaults — see `src/shared/utils/cron.ts`.
 */
export function registerReconciliationCrons(): void {
  cron.register({
    name: 'payroll-reconciliation-14:00',
    expression: '0 14 * * *',
    handler: async () => {
      const drift = await reconcileSettledCycles();
      return { driftEntries: drift.length };
    },
  });
  cron.register({
    name: 'payroll-reconciliation-22:00',
    expression: '0 22 * * *',
    handler: async () => {
      const drift = await reconcileSettledCycles();
      return { driftEntries: drift.length };
    },
  });
}
