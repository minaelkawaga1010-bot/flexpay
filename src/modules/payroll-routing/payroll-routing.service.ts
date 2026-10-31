import { createHash } from 'crypto';
import {
  Prisma,
  AdvanceStatus,
  PayrollCycleStatus,
  PayrollIntentStatus,
  LedgerEntryType,
  type Advance,
} from '@prisma/client';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import logger from '@shared/utils/logger';
import { BadRequest, NotFound, AppError } from '@shared/utils/errors';
import {
  InvariantViolation,
  checkAdvanceAgainstIntent,
  checkAdvanceFSM,
} from './invariants';
import { enforceComplianceForAdvance } from '@modules/compliance/compliance.guard';
import { acquireWorkerLockScoped, LockScope } from '@shared/utils/advisory-lock';
import { FAILSAFE_ACCRUED_CAP_FRACTION } from '@modules/ops-intel/cohort-failsafe.service';
import { CONSUMING_ADVANCE_WHERE, computeEligibility, normaliseBuffer, toFils } from './availability';
import { creditScoringService } from '@modules/scoring/scoring.service';

/**
 * Fixed EWA processing fee (AED) — FINANCIAL_MODEL §2.1. Single source;
 * the mobile controller imports this rather than re-declaring it.
 */
export const EWA_FIXED_FEE = 10;
/** DCSE artifact tag stamped on balance reads + advance snapshots. */
export const DCSE_MODEL_VERSION = 'dcse-v1.0.0';

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
      // TASK-009: lock the cycle row before reading any advance.
      // reserveAdvance holds it FOR SHARE until it commits, so an
      // in-flight reservation lands before the RESERVED advances are read
      // below, and none can start until this settlement commits (it then
      // sees SETTLED). Without this, an advance reserved mid-settlement
      // was left RESERVED in a SETTLED cycle — never recovered, while the
      // full residual was still paid.
      await tx.$queryRaw`SELECT 1 FROM payroll_cycles WHERE id = ${cycleId} FOR UPDATE`;
      const locked = await tx.payrollCycle.findUnique({
        where: { id: cycleId },
        select: { status: true },
      });
      if (locked?.status !== PayrollCycleStatus.INTENTS_READY) {
        throw BadRequest(`Cycle ${cycleId} is ${locked?.status ?? 'missing'}; expected INTENTS_READY`);
      }

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

/** Matches the HTTP idempotency window (src/shared/utils/idempotency.ts). */
const ADVANCE_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
/** How long an in-flight request blocks a duplicate; a crashed worker's claim lapses. */
const ADVANCE_IN_FLIGHT_LEASE_SECONDS = 120;

function hasAtMostTwoDecimals(aed: number): boolean {
  return Math.abs(aed * 100 - Math.round(aed * 100)) < 1e-6;
}

/**
 * At most one advance per (worker, Idempotency-Key). The key is claimed
 * atomically in Redis before the reservation runs: a concurrent duplicate
 * gets 409 and a later replay returns the original advance instead of
 * reserving again. A failed reservation releases the claim so a retry is
 * processed. Independently of keys, every reservation is bound by the
 * cumulative limit enforced in reserveAdvanceLocked.
 */
async function withAdvanceIdempotency(
  employeeId: string,
  idempotencyKey: string,
  reserve: () => Promise<Advance>,
): Promise<Advance> {
  const digest = createHash('sha256').update(`${employeeId}:${idempotencyKey}`).digest('hex');
  const marker = `ewa:advance:idem:${digest}`;
  if (!(await redisService.setIfAbsent(marker, 'processing', ADVANCE_IN_FLIGHT_LEASE_SECONDS))) {
    const state = await redisService.get(marker);
    const advanceId = state?.startsWith('done:') ? state.slice('done:'.length) : null;
    const original = advanceId
      ? await prisma.advance.findFirst({ where: { id: advanceId, employeeId } })
      : null;
    if (original) return original;
    throw new AppError(
      409,
      'ADVANCE_REQUEST_IN_PROGRESS',
      'An advance request with this Idempotency-Key is still in progress',
    );
  }

  let advance: Advance;
  try {
    advance = await reserve();
  } catch (err) {
    await redisService
      .del(marker)
      .catch(() => logger.warn('advance idempotency: claim release failed', { employeeId }));
    throw err;
  }
  await redisService
    .set(marker, `done:${advance.id}`, ADVANCE_IDEMPOTENCY_TTL_SECONDS)
    .catch(() => logger.warn('advance idempotency: record failed', { employeeId, advanceId: advance.id }));
  return advance;
}

interface ReserveAdvanceArgs {
  employeeId: string;
  cycleId: string;
  amount: number;
  fee: number;
  currency?: string;
  dcseModelVersion: string;
  dcseLimitAtReq: number;
  dcseRiskScoreAtReq: number;
  /** Client Idempotency-Key: at most one advance is reserved per key. */
  idempotencyKey?: string;
}

/**
 * Reserve an advance: persist the Advance row in `RESERVED` state and
 * write the matching `ADVANCE_RESERVE` ledger entry crediting the wallet.
 *
 * Eligibility is CUMULATIVE per (worker, payroll cycle) — TASK-009. Every
 * advance already drawn against the cycle is re-read inside the locked
 * transaction and counted, so no number of requests — sequential,
 * concurrent, from several devices or under different Idempotency-Keys —
 * can draw more than the cycle's ceiling. Every input that bounds the
 * limit is server-side: accrued wages from the PayrollIntent, the
 * cohort's buffer and failsafe from the Company, and the DCSE limit and
 * fee from the caller's own server-side computation.
 *
 * Caller is expected to have already run DCSE → got an approval + a limit.
 */
export async function reserveAdvance(args: ReserveAdvanceArgs): Promise<Advance> {
  if (!Number.isFinite(args.amount) || args.amount <= 0 || !hasAtMostTwoDecimals(args.amount)) {
    throw BadRequest('Advance amount must be a positive AED amount with at most 2 decimals');
  }
  if (!Number.isFinite(args.fee) || args.fee < 0 || !hasAtMostTwoDecimals(args.fee)) {
    throw BadRequest('Advance fee must be a non-negative AED amount with at most 2 decimals');
  }
  if (!Number.isFinite(args.dcseLimitAtReq) || args.dcseLimitAtReq < 0) {
    throw BadRequest('DCSE limit must be a non-negative amount');
  }

  const { idempotencyKey, ...reservation } = args;
  return idempotencyKey
    ? withAdvanceIdempotency(args.employeeId, idempotencyKey, () => reserveAdvanceLocked(reservation))
    : reserveAdvanceLocked(reservation);
}

async function reserveAdvanceLocked(args: Omit<ReserveAdvanceArgs, 'idempotencyKey'>): Promise<Advance> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // -1. Per-worker advisory lock (Bible §1.4 / Review A.1). Serializes
    //     every EWA reservation for the worker, so the cumulative sum read
    //     in step 3 cannot change before this transaction commits.
    //     Released on tx commit/rollback. Scoped to EWA_RESERVATION so
    //     unrelated wallet debits don't block each other.
    await acquireWorkerLockScoped(tx, args.employeeId, LockScope.EWA_RESERVATION);

    // 0. Compliance gate. Runs FIRST and on the SAME tx so MVCC sees a
    //    consistent snapshot for both the open-incident lookup and the
    //    subsequent ledger writes. Throws ComplianceBlock (HTTP 451) if
    //    any blocking incident is open, or AppError for status states
    //    (BLOCKED/DEACTIVATED/PENDING_KYC). The throw aborts the
    //    transaction before any Advance/LedgerEntry row is created —
    //    preserving I3 by construction.
    await enforceComplianceForAdvance(tx, args.employeeId);

    // 1. The cycle must exist and be live (OPEN or INTENTS_READY). Its
    //    row is share-locked first: settleCycle takes it FOR UPDATE, so
    //    the cycle cannot settle between this check and our commit.
    await tx.$queryRaw`SELECT 1 FROM payroll_cycles WHERE id = ${args.cycleId} FOR SHARE`;
    const cycle = await tx.payrollCycle.findUnique({ where: { id: args.cycleId } });
    if (!cycle) throw NotFound(`PayrollCycle ${args.cycleId} not found`);
    if (cycle.status === PayrollCycleStatus.SETTLED) {
      throw BadRequest('Cycle already settled — request a new advance next cycle');
    }
    if (cycle.status === PayrollCycleStatus.FAILED) {
      throw BadRequest('Cycle is in FAILED state; ops review required');
    }

    // 2. There must be an intent for this employee in this cycle, not yet
    //    routed. For pre-WPS advances (HR-tech attendance-driven), the
    //    intent is materialised early from attendance data with
    //    accruedAmount only; grossAmount fills in when the WPS file lands.
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
    if (intent.status !== PayrollIntentStatus.PENDING) {
      throw new AppError(
        409,
        'WAGES_ALREADY_ROUTED',
        'Wages for this cycle were already routed — request a new advance next cycle',
      );
    }

    // 3. Everything already drawn against this cycle, plus the cohort's
    //    risk config — read inside the locked tx so the limit is
    //    snapshot-consistent with the writes below.
    const consumed = await tx.advance.findMany({
      where: { employeeId: args.employeeId, cycleId: args.cycleId, ...CONSUMING_ADVANCE_WHERE },
      select: { amount: true, fee: true },
    });
    const company = await tx.company.findUnique({
      where: { id: cycle.companyId },
      select: { ewaFailsafeActive: true, hrLagBufferPercent: true },
    });
    const failsafeActive = company?.ewaFailsafeActive ?? false;
    const hrLagBufferPercent = company?.hrLagBufferPercent ?? 0;

    // Cohort canary failsafe (STRATEGY §C.3): when the employer's cohort
    // has tripped the 1.5% uncollectible canary, exposure is hard-capped at
    // 20% of verifiable accrued wages, independent of DCSE output; the HR
    // data-lag buffer then haircuts what remains (absorbing the HR-sync
    // latency window), and each advance's fee is netted.
    const eligibility = computeEligibility({
      dcseLimit: args.dcseLimitAtReq,
      accruedAmount: intent.accruedAmount,
      accruedCapFraction: failsafeActive ? FAILSAFE_ACCRUED_CAP_FRACTION : 1,
      hrLagBufferPercent,
      fee: args.fee,
      consumed,
    });
    const requested = toFils(args.amount);
    const advancedSoFar = toFils(eligibility.advancedAmount);
    const drawn = { alreadyAdvanced: eligibility.advancedAmount, requested: args.amount };

    // 4a. I1, cumulatively: everything advanced this cycle ≤ accrued.
    if (advancedSoFar + requested > toFils(intent.accruedAmount)) {
      throw new AppError(
        409,
        'AMOUNT_EXCEEDS_ACCRUED',
        `Requested ${args.amount} + already advanced ${eligibility.advancedAmount} > accrued ${intent.accruedAmount}`,
        { accruedAmount: intent.accruedAmount, ...drawn },
      );
    }
    // 4b. The failsafe share, cumulatively.
    if (failsafeActive && advancedSoFar + requested > toFils(eligibility.accruedCap)) {
      throw new AppError(
        409,
        'COHORT_FAILSAFE_CAP',
        `Cohort failsafe active — advances capped at ${FAILSAFE_ACCRUED_CAP_FRACTION * 100}% of accrued (${eligibility.accruedCap})`,
        {
          accruedAmount: intent.accruedAmount,
          failsafeCap: eligibility.accruedCap,
          capFraction: FAILSAFE_ACCRUED_CAP_FRACTION,
          ...drawn,
        },
      );
    }
    // 4c. The buffered, fee-net ceiling (DCSE limit included) over every
    //     advance in the cycle, this one and its fee included.
    if (requested > toFils(eligibility.remaining)) {
      throw new AppError(
        409,
        'EXCEEDS_AVAILABLE_LIMIT',
        `Requested ${args.amount} > available limit ${eligibility.remaining} (drawn ${eligibility.drawnTotal} of ${eligibility.ceiling} this cycle)`,
        {
          availableLimit: eligibility.remaining,
          ceiling: eligibility.ceiling,
          alreadyDrawn: eligibility.drawnTotal,
          accruedAmount: intent.accruedAmount,
          dcseLimit: args.dcseLimitAtReq,
          hrLagBufferPercent,
          fee: args.fee,
          ...drawn,
        },
      );
    }

    // 5. Persist the advance + the ledger reserve entry + wallet credit.
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

// ───────────────────────────────────────────────────────────────────
// Read-only balance view (single source for "what can this worker take")
// ───────────────────────────────────────────────────────────────────

export interface WalletBalanceView {
  walletBalance: number;
  currency: 'AED';
  accruedWages: number;
  /** DCSE per-worker ceiling (score.maxEWAAmount). */
  dcseLimit: number;
  hrLagBufferPercent: number;
  failsafeActive: boolean;
  transactionFee: number;
  /**
   * What the worker can still draw this cycle: the buffered, failsafe-
   * capped, fee-net ceiling minus every advance already drawn —
   * identical math to the reserveAdvance gates (computeEligibility). The
   * UI binds to this; reserveAdvance re-derives it under the lock.
   */
  availableLimit: number;
  dcse: {
    score: number;
    eligibleForEWA: boolean;
    modelVersion: string;
    nextReviewAt: Date | null;
  };
  plan: 'BASIC' | 'LUXURY';
  cycle: { id: string | null; status: 'ACTIVE' | 'NO_ACTIVE_CYCLE' };
}

/**
 * Canonical read-only balance for a worker. `reserveAdvance` (write path)
 * and every client read flow through the same cumulative
 * `computeEligibility`, so a figure shown to the worker can never exceed
 * what the locked reservation transaction will allow.
 *
 * `cycleId` is optional: when omitted, the active cycle
 * (OPEN/INTENTS_READY) is resolved server-side — the client never
 * supplies or pins a cycle (that would be a staleness/authz hole).
 */
export async function getEmployeeBalance(
  employeeId: string,
  cycleId?: string | null,
): Promise<WalletBalanceView> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      walletBalance: true,
      companyId: true,
      plan: true,
      company: { select: { hrLagBufferPercent: true, ewaFailsafeActive: true } },
    },
  });
  if (!employee) throw NotFound('Employee record not found');

  // Resolve the active cycle's intent. When the caller passed a
  // cycleId we honour it; otherwise we resolve the live cycle from the
  // DB (never from client input).
  const intent = await prisma.payrollIntent.findFirst({
    where: {
      employeeId,
      ...(cycleId
        ? { cycleId }
        : {
            cycle: {
              companyId: employee.companyId ?? undefined,
              status: { in: [PayrollCycleStatus.OPEN, PayrollCycleStatus.INTENTS_READY] },
            },
          }),
    },
    orderBy: { createdAt: 'desc' },
    select: { cycleId: true, accruedAmount: true },
  });
  const consumed = intent
    ? await prisma.advance.findMany({
        where: { employeeId, cycleId: intent.cycleId, ...CONSUMING_ADVANCE_WHERE },
        select: { amount: true, fee: true },
      })
    : [];

  const score = await creditScoringService.computeScore(employeeId);
  const accruedWages = intent?.accruedAmount ?? 0;
  const dcseLimit = score.maxEWAAmount;
  const hrLagBufferPercent = normaliseBuffer(employee.company?.hrLagBufferPercent ?? 0);
  const failsafeActive = employee.company?.ewaFailsafeActive ?? false;

  // Same cumulative math reserveAdvance enforces under the lock: the
  // failsafe caps the accrued base at 20% BEFORE the buffer, everything
  // already drawn this cycle is subtracted, and the next fee is netted.
  const { remaining: availableLimit } = computeEligibility({
    dcseLimit,
    accruedAmount: accruedWages,
    accruedCapFraction: failsafeActive ? FAILSAFE_ACCRUED_CAP_FRACTION : 1,
    hrLagBufferPercent,
    fee: EWA_FIXED_FEE,
    consumed,
  });

  return {
    walletBalance: employee.walletBalance,
    currency: 'AED',
    accruedWages,
    dcseLimit,
    hrLagBufferPercent,
    failsafeActive,
    transactionFee: EWA_FIXED_FEE,
    availableLimit,
    dcse: {
      score: score.score,
      eligibleForEWA: score.eligibleForEWA,
      modelVersion: DCSE_MODEL_VERSION,
      nextReviewAt: score.nextReviewAt ?? null,
    },
    plan: employee.plan,
    cycle: intent
      ? { id: intent.cycleId, status: 'ACTIVE' }
      : { id: null, status: 'NO_ACTIVE_CYCLE' },
  };
}
