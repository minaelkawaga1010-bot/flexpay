import {
  Prisma,
  AdvanceStatus,
  PayrollCycleStatus,
  PayrollIntentStatus,
  LedgerEntryType,
} from '@prisma/client';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { BadRequest, NotFound, AppError } from '@shared/utils/errors';
import {
  InvariantViolation,
  checkAdvanceAgainstIntent,
  checkAdvanceFSM,
} from './invariants';
import { enforceComplianceForAdvance } from '@modules/compliance/compliance.guard';

/**
 * Settle a single advance against a single payroll intent inside a
 * Prisma `$transaction`. The Postgres tx provides A+I+D from ACID; the
 * explicit invariant checks provide the C (consistency at the business
 * level).
 *
 * Both the advance and the intent are re-read **inside the transaction**
 * to prevent TOCTOU drift between the caller's snapshot and the actual
 * row state. The function never reaches out to NymCard / external rails —
 * the rail call is the *next* step, gated on this function returning
 * cleanly.
 */
export async function settleAdvanceAgainstIntent(
  tx: Prisma.TransactionClient,
  args: { advanceId: string; intentId: string },
): Promise<void> {
  const [advance, intent] = await Promise.all([
    tx.advance.findUnique({ where: { id: args.advanceId } }),
    tx.payrollIntent.findUnique({ where: { id: args.intentId } }),
  ]);
  if (!advance) throw NotFound(`Advance ${args.advanceId} not found`);
  if (!intent) throw NotFound(`PayrollIntent ${args.intentId} not found`);

  // FSM gate: only RESERVED advances proceed to SETTLED.
  checkAdvanceFSM(advance.status, AdvanceStatus.SETTLED);

  // I1 + I2 + I4. Throws InvariantViolation; the surrounding transaction
  // is rolled back by Prisma on throw.
  checkAdvanceAgainstIntent(advance, intent);

  // ──────────────────────────────────────────────────────────────────
  // The atomic write set. Any failure here aborts the entire
  // transaction; no partial state can persist.
  // ──────────────────────────────────────────────────────────────────

  // 1. Mark the advance SETTLED.
  await tx.advance.update({
    where: { id: advance.id },
    data: { status: AdvanceStatus.SETTLED, settledAt: new Date() },
  });

  // 2. Write the ADVANCE_SETTLE ledger entry (debits the intent;
  //    delta is negative because we're removing from the intent pool).
  await tx.ledgerEntry.create({
    data: {
      type: LedgerEntryType.ADVANCE_SETTLE,
      employeeId: advance.employeeId,
      cycleId: advance.cycleId,
      intentId: intent.id,
      advanceId: advance.id,
      delta: -advance.amount,
      currency: advance.currency,
      description: `Settle advance ${advance.id} against intent ${intent.id}`,
    },
  });
}

/**
 * Settle every approved/reserved advance for a single payroll intent
 * and credit the residual to the employee wallet.
 *
 * After this function returns, the per-(employee, cycle) ledger sum
 * is zero (I3): the intent's grossAmount has been fully accounted for
 * as advance settlements + residual wallet credit.
 *
 * This is the *cycle-side* primitive — called by `settleCycle()` once
 * per intent in the cycle. It is itself wrapped in a Prisma transaction
 * by the caller, so all of its writes share that outer transaction.
 */
export async function settleIntent(
  tx: Prisma.TransactionClient,
  intentId: string,
): Promise<{ employeeId: string; residual: number; settledAdvances: number }> {
  const intent = await tx.payrollIntent.findUnique({ where: { id: intentId } });
  if (!intent) throw NotFound(`PayrollIntent ${intentId} not found`);
  if (intent.status !== PayrollIntentStatus.PENDING) {
    throw BadRequest(`Intent ${intentId} already in status ${intent.status}`);
  }

  // 1. Settle every RESERVED advance for this employee+cycle.
  const reserved = await tx.advance.findMany({
    where: {
      employeeId: intent.employeeId,
      cycleId: intent.cycleId,
      status: AdvanceStatus.RESERVED,
    },
    orderBy: { reservedAt: 'asc' },
  });

  let totalSettled = 0;
  for (const advance of reserved) {
    await settleAdvanceAgainstIntent(tx, { advanceId: advance.id, intentId: intent.id });
    totalSettled += advance.amount;
  }

  // 2. Credit the wallet with the residual.
  const residual = intent.grossAmount - totalSettled;
  if (residual < 0) {
    // This is structurally impossible if I1 held for every advance, but
    // we re-check at the cycle boundary as a defence-in-depth: it's the
    // last gate before the rail call.
    throw new InvariantViolation('I1', {
      intentId: intent.id,
      grossAmount: intent.grossAmount,
      totalSettled,
    });
  }

  if (residual > 0) {
    await tx.employee.update({
      where: { id: intent.employeeId },
      data: { walletBalance: { increment: residual } },
    });
    await tx.ledgerEntry.create({
      data: {
        type:
          totalSettled === 0
            ? LedgerEntryType.PAYROLL_FULL
            : LedgerEntryType.PAYROLL_RESIDUAL,
        employeeId: intent.employeeId,
        cycleId: intent.cycleId,
        intentId: intent.id,
        delta: residual,
        currency: intent.currency,
        description:
          totalSettled === 0
            ? `Full payroll credit (no advance taken)`
            : `Residual after settling ${reserved.length} advance(s)`,
      },
    });
  }

  // 3. Mark intent ROUTED.
  await tx.payrollIntent.update({
    where: { id: intent.id },
    data: { status: PayrollIntentStatus.ROUTED, routedAt: new Date() },
  });

  return {
    employeeId: intent.employeeId,
    residual,
    settledAdvances: reserved.length,
  };
}

/**
 * Cycle-level settlement orchestrator. Wraps every intent's settlement
 * in a single Prisma transaction so the cycle either settles entirely
 * or not at all.
 *
 * For Phase 1 we run cycles sequentially per company. Phase 2 will
 * shard by intent and parallelise — see CTOGuidanceLayer in §12.
 */
export async function settleCycle(cycleId: string) {
  const cycle = await prisma.payrollCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw NotFound(`PayrollCycle ${cycleId} not found`);
  if (cycle.status !== PayrollCycleStatus.INTENTS_READY) {
    throw BadRequest(
      `Cycle ${cycleId} is ${cycle.status}; expected INTENTS_READY`,
    );
  }

  const summary = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const intents = await tx.payrollIntent.findMany({
        where: { cycleId, status: PayrollIntentStatus.PENDING },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });

      let totalEmployees = 0;
      let totalAdvances = 0;
      let totalResidual = 0;

      for (const { id } of intents) {
        const r = await settleIntent(tx, id);
        totalEmployees += 1;
        totalAdvances += r.settledAdvances;
        totalResidual += r.residual;
      }

      await tx.payrollCycle.update({
        where: { id: cycleId },
        data: {
          status: PayrollCycleStatus.SETTLED,
          settledAt: new Date(),
        },
      });

      return { totalEmployees, totalAdvances, totalResidual };
    },
    {
      // Long-running cycles can take several minutes for large companies.
      // Postgres default is 5s for statement timeout; this raises the
      // Prisma client-side max so the transaction itself doesn't abort.
      maxWait: 30_000,
      timeout: 600_000,
    },
  );

  logger.info('payroll cycle settled', { cycleId, ...summary });
  return summary;
}

// ───────────────────────────────────────────────────────────────────
// Advance request / approval (the *worker-side* entry point)
// ───────────────────────────────────────────────────────────────────

/**
 * Reserve an advance: persist the Advance row in `RESERVED` state and
 * write the matching `ADVANCE_RESERVE` ledger entry crediting the wallet.
 *
 * Caller is expected to have already:
 *   • run DCSE → got an approval + a limit
 *   • verified advance.amount ≤ accruedAmount for the *current* intent
 *     (we re-check inside the transaction, but failing fast at the
 *     controller produces a cleaner UX)
 */
export async function reserveAdvance(args: {
  employeeId: string;
  cycleId: string;
  amount: number;
  fee: number;
  currency?: string;
  dcseModelVersion: string;
  dcseLimitAtReq: number;
  dcseRiskScoreAtReq: number;
}) {
  if (args.amount <= 0) throw BadRequest('Advance amount must be positive');

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // 0. Compliance gate. Runs FIRST and on the SAME tx so MVCC sees a
    //    consistent snapshot for both the open-incident lookup and the
    //    subsequent ledger writes. Throws ComplianceBlock (HTTP 451) if
    //    any blocking incident is open, or AppError for status states
    //    (BLOCKED/DEACTIVATED/PENDING_KYC). The throw aborts the
    //    transaction before any Advance/LedgerEntry row is created —
    //    preserving I3 by construction.
    await enforceComplianceForAdvance(tx, args.employeeId);

    // 1. The cycle must exist and be live (OPEN or INTENTS_READY).
    const cycle = await tx.payrollCycle.findUnique({ where: { id: args.cycleId } });
    if (!cycle) throw NotFound(`PayrollCycle ${args.cycleId} not found`);
    if (cycle.status === PayrollCycleStatus.SETTLED) {
      throw BadRequest('Cycle already settled — request a new advance next cycle');
    }
    if (cycle.status === PayrollCycleStatus.FAILED) {
      throw BadRequest('Cycle is in FAILED state; ops review required');
    }

    // 2. There must be an intent for this employee in this cycle.
    //    For pre-WPS advances (HR-tech attendance-driven), the intent
    //    is materialised early from attendance data with accruedAmount
    //    only; grossAmount fills in when the WPS file lands.
    const intent = await tx.payrollIntent.findUnique({
      where: { cycleId_employeeId: { cycleId: args.cycleId, employeeId: args.employeeId } },
    });
    if (!intent) {
      throw new AppError(
        409,
        'NO_ACCRUED_WAGES',
        'No accrued wages on record for this cycle — HR-tech attendance feed required',
      );
    }

    // 3. Enforce I1 against the *currently-accrued* amount, before any
    //    of the advance state has been written.
    if (args.amount > intent.accruedAmount) {
      throw new AppError(
        409,
        'AMOUNT_EXCEEDS_ACCRUED',
        `Requested ${args.amount} > accrued ${intent.accruedAmount}`,
        { accruedAmount: intent.accruedAmount, requested: args.amount },
      );
    }

    // 4. Persist the advance + the ledger reserve entry + wallet credit.
    const advance = await tx.advance.create({
      data: {
        employeeId: args.employeeId,
        cycleId: args.cycleId,
        amount: args.amount,
        fee: args.fee,
        currency: args.currency ?? intent.currency,
        status: AdvanceStatus.RESERVED,
        approvedAt: new Date(),
        reservedAt: new Date(),
        dcseModelVersion: args.dcseModelVersion,
        dcseLimitAtReq: args.dcseLimitAtReq,
        dcseRiskScoreAtReq: args.dcseRiskScoreAtReq,
      },
    });

    await tx.ledgerEntry.create({
      data: {
        type: LedgerEntryType.ADVANCE_RESERVE,
        employeeId: args.employeeId,
        cycleId: args.cycleId,
        intentId: intent.id,
        advanceId: advance.id,
        delta: args.amount,
        currency: advance.currency,
        description: `Advance reserve (DCSE v${args.dcseModelVersion}, limit ${args.dcseLimitAtReq})`,
      },
    });

    await tx.employee.update({
      where: { id: args.employeeId },
      data: { walletBalance: { increment: args.amount } },
    });

    return advance;
  });
}
