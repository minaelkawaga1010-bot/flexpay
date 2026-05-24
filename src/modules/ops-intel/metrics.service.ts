import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { syncCohortFailsafesFromCanary } from './cohort-failsafe.service';

/**
 * Live board-deck metrics.
 *
 * Five primary KPIs:
 *
 *   1. GMV (Gross Merchandise Value) — Σ Advance.amount + Σ
 *      Remittance.amount + Σ Card spend in the window. The "money
 *      moved through FlexPay" denominator.
 *
 *   2. MAU (Monthly Active Users) — distinct employees with at least
 *      one EmployeeTransaction or Advance in the trailing 30 days.
 *
 *   3. Net marginal revenue — Σ Advance.fee + Σ FX-margin component
 *      on remittance + Σ interchange estimate on card spend (the last
 *      modelled at the IDC PWP 1.1% benchmark since real interchange
 *      lands T+2 via NymCard reconciliation files).
 *
 *   4. Default ratio — uncollectible / Σ disbursed in the window.
 *      "Uncollectible" = Advance.status = FAILED. This is the metric
 *      that the 1.5% Canary-Rollback trigger gates on.
 *
 *   5. Canary trigger flag — boolean: defaultRatio >= 0.015 in the
 *      trailing 30-day window across any company cohort. When true,
 *      the autonomous DCSE limit-raising must be stripped — see
 *      STRATEGY.md §F (Failsafe State) and FINANCIAL_MODEL.md §2.3.
 *
 * Time window is parameterised; the dashboard defaults to 30d.
 */

export const CANARY_DEFAULT_RATE = 0.015; // 1.5% — STRATEGY.md §F
export const DEFAULT_WINDOW_DAYS = 30;
export const CARD_INTERCHANGE_BPS = 110; // 1.10% — IDC PWP MENA benchmark (modelled, not booked)
export const FX_MARGIN_BPS = 50; // 0.5% — Nova Star corporate spread (env.REMITTANCE_FX_SPREAD canonical)

export interface ReportMetrics {
  generatedAt: Date;
  windowDays: number;
  /** Σ advance + remittance + card spend in AED. */
  gmvAED: number;
  /** Distinct employees with any monetary activity in the window. */
  mau: number;
  /** Σ fee + modelled interchange + modelled FX margin in AED. */
  netMarginalRevenueAED: number;
  revenueBreakdown: {
    advanceFeesAED: number;
    remittanceMarginAED: number; // modelled = 50 bps × Σ remittance
    cardInterchangeAED: number; // modelled = 110 bps × Σ card purchase
  };
  /** Uncollectible / disbursed across the full platform. */
  defaultRatio: number;
  /** Default ratio broken down per company cohort. */
  companyCohortDefaults: { companyId: string; companyName: string; defaultRatio: number; disbursedAED: number }[];
  /** True iff any single cohort breaches CANARY_DEFAULT_RATE. */
  canaryTripped: boolean;
  /** Identifiers of the breaching cohorts (empty when not tripped). */
  canaryCompanyIds: string[];
  /** Σ outstanding (RESERVED) — surfaced inline for treasury context. */
  outstandingAdvancesAED: number;
}

/**
 * GMV — single round-trip across three signed-amount sources.
 *
 * `EmployeeTransaction.totalAmount` is signed (negative for senders).
 * For GMV we want absolute moved amount, hence `ABS(totalAmount)` and
 * a HALF-IT correction below: a TRANSFER produces two rows
 * (sender, receiver), so the same AED is counted once on each side —
 * we filter to type='TRANSFER' senders only to dedupe, then add all
 * other types as-is.
 */
async function getGmv(windowDays: number): Promise<{
  gmvAED: number;
  advanceFeesAED: number;
  remittanceAED: number;
  cardSpendAED: number;
}> {
  const row = await prisma.$queryRaw<
    {
      advanceAED: number;
      advanceFeesAED: number;
      remittanceAED: number;
      cardSpendAED: number;
      p2pAED: number;
    }[]
  >`
    WITH advance_agg AS (
      SELECT
        COALESCE(SUM(amount), 0)::float8 AS amt,
        COALESCE(SUM(fee), 0)::float8    AS fee
      FROM advances
      WHERE "reservedAt" >= NOW() - (${windowDays} || ' days')::interval
        AND status IN ('RESERVED', 'SETTLED')
    ),
    txn_agg AS (
      SELECT
        COALESCE(SUM(CASE WHEN type = 'REMITTANCE'    THEN ABS("totalAmount") ELSE 0 END), 0)::float8 AS remittance,
        COALESCE(SUM(CASE WHEN type = 'CARD_PURCHASE' THEN ABS("totalAmount") ELSE 0 END), 0)::float8 AS card,
        -- P2P transfers: count sender side only (amount < 0) to avoid double-count.
        COALESCE(SUM(CASE WHEN type = 'TRANSFER' AND amount < 0 THEN ABS("totalAmount") ELSE 0 END), 0)::float8 AS p2p
      FROM employee_transactions
      WHERE "createdAt" >= NOW() - (${windowDays} || ' days')::interval
        AND status = 'COMPLETED'
    )
    SELECT
      advance_agg.amt   AS "advanceAED",
      advance_agg.fee   AS "advanceFeesAED",
      txn_agg.remittance AS "remittanceAED",
      txn_agg.card      AS "cardSpendAED",
      txn_agg.p2p       AS "p2pAED"
    FROM advance_agg, txn_agg
  `;

  const r = row[0];
  const advance = Number(r?.advanceAED ?? 0);
  const remittance = Number(r?.remittanceAED ?? 0);
  const card = Number(r?.cardSpendAED ?? 0);
  const p2p = Number(r?.p2pAED ?? 0);

  return {
    gmvAED: advance + remittance + card + p2p,
    advanceFeesAED: Number(r?.advanceFeesAED ?? 0),
    remittanceAED: remittance,
    cardSpendAED: card,
  };
}

async function getMau(windowDays: number): Promise<number> {
  const row = await prisma.$queryRaw<{ mau: bigint }[]>`
    SELECT COUNT(DISTINCT "employeeId") AS mau
    FROM (
      SELECT "employeeId" FROM employee_transactions
      WHERE "createdAt" >= NOW() - (${windowDays} || ' days')::interval
        AND status = 'COMPLETED'
      UNION ALL
      SELECT "employeeId" FROM advances
      WHERE "requestedAt" >= NOW() - (${windowDays} || ' days')::interval
    ) all_activity
  `;
  return Number(row[0]?.mau ?? 0);
}

async function getCompanyDefaultRatios(windowDays: number): Promise<{
  platformDefaultRatio: number;
  companyCohortDefaults: ReportMetrics['companyCohortDefaults'];
  canaryCompanyIds: string[];
}> {
  /**
   * Per-cohort default ratio + the rolled-up platform ratio. The
   * canary trigger fires on cohort-level, not platform-level — one
   * bad cohort is enough to strip autonomous limits per STRATEGY.md §F.
   */
  const cohortRows = await prisma.$queryRaw<
    { companyId: string; companyName: string; disbursedAED: number; uncollectibleAED: number }[]
  >`
    SELECT
      c.id                                                                AS "companyId",
      c.name                                                              AS "companyName",
      COALESCE(SUM(a.amount), 0)::float8                                  AS "disbursedAED",
      COALESCE(SUM(CASE WHEN a.status = 'FAILED' THEN a.amount ELSE 0 END), 0)::float8 AS "uncollectibleAED"
    FROM companies c
    INNER JOIN advances a
      ON a."cycleId" IN (SELECT id FROM payroll_cycles WHERE "companyId" = c.id)
      AND a."requestedAt" >= NOW() - (${windowDays} || ' days')::interval
    GROUP BY c.id, c.name
    HAVING COALESCE(SUM(a.amount), 0) > 0
    ORDER BY (
      COALESCE(SUM(CASE WHEN a.status = 'FAILED' THEN a.amount ELSE 0 END), 0)::float8 /
      NULLIF(COALESCE(SUM(a.amount), 0), 0)
    ) DESC
  `;

  let totalDisbursed = 0;
  let totalUncollectible = 0;
  const cohorts: ReportMetrics['companyCohortDefaults'] = [];
  const canary: string[] = [];

  for (const r of cohortRows) {
    const disbursed = Number(r.disbursedAED);
    const uncollectible = Number(r.uncollectibleAED);
    const ratio = disbursed > 0 ? uncollectible / disbursed : 0;
    cohorts.push({
      companyId: r.companyId,
      companyName: r.companyName,
      defaultRatio: ratio,
      disbursedAED: disbursed,
    });
    totalDisbursed += disbursed;
    totalUncollectible += uncollectible;
    if (ratio >= CANARY_DEFAULT_RATE) canary.push(r.companyId);
  }

  return {
    platformDefaultRatio: totalDisbursed > 0 ? totalUncollectible / totalDisbursed : 0,
    companyCohortDefaults: cohorts,
    canaryCompanyIds: canary,
  };
}

async function getOutstandingAdvanceTotal(): Promise<number> {
  const row = await prisma.$queryRaw<{ outstandingAED: number }[]>`
    SELECT COALESCE(SUM(amount), 0)::float8 AS "outstandingAED"
    FROM advances
    WHERE status = 'RESERVED' AND currency = 'AED'
  `;
  return Number(row[0]?.outstandingAED ?? 0);
}

export class MetricsService {
  /**
   * Compile board-deck metrics.
   *
   * `enforceFailsafe` is OFF by default so dashboard reads stay
   * side-effect-free. The dedicated canary worker (`runCanarySweep`)
   * calls it with `enforceFailsafe: true` to actually trip the
   * per-cohort circuit breaker (STRATEGY §C.3) — detection alone never
   * mutates state on a read path.
   */
  async compile(
    windowDays: number = DEFAULT_WINDOW_DAYS,
    opts: { enforceFailsafe?: boolean } = {},
  ): Promise<ReportMetrics> {
    const startedAt = Date.now();

    const [gmv, mau, defaults, outstanding] = await Promise.all([
      getGmv(windowDays),
      getMau(windowDays),
      getCompanyDefaultRatios(windowDays),
      getOutstandingAdvanceTotal(),
    ]);

    const remittanceMarginAED = gmv.remittanceAED * (FX_MARGIN_BPS / 10_000);
    const cardInterchangeAED = gmv.cardSpendAED * (CARD_INTERCHANGE_BPS / 10_000);
    const netMarginalRevenueAED = gmv.advanceFeesAED + remittanceMarginAED + cardInterchangeAED;

    const result: ReportMetrics = {
      generatedAt: new Date(),
      windowDays,
      gmvAED: gmv.gmvAED,
      mau,
      netMarginalRevenueAED,
      revenueBreakdown: {
        advanceFeesAED: gmv.advanceFeesAED,
        remittanceMarginAED,
        cardInterchangeAED,
      },
      defaultRatio: defaults.platformDefaultRatio,
      companyCohortDefaults: defaults.companyCohortDefaults,
      canaryTripped: defaults.canaryCompanyIds.length > 0,
      canaryCompanyIds: defaults.canaryCompanyIds,
      outstandingAdvancesAED: outstanding,
    };

    if (result.canaryTripped) {
      // 1.5% breach on any cohort is the explicit failsafe trigger
      // (STRATEGY.md §F / FINANCIAL_MODEL.md §2.3). Surface at WARN so
      // ops routing catches it; the autonomous DCSE limit-raising
      // should be stripped on this signal — pager-tier event.
      logger.warn('CANARY TRIPPED — cohort default ratio breach', {
        canaryCompanyIds: defaults.canaryCompanyIds,
        threshold: CANARY_DEFAULT_RATE,
        platformDefaultRatio: defaults.platformDefaultRatio,
      });
    }

    // Enforcement (canary worker only): persist the per-cohort
    // failsafe trip so reserveAdvance caps EWA at 20% accrued for the
    // breaching cohorts. Reads (dashboard) never reach this branch.
    if (opts.enforceFailsafe && result.canaryTripped) {
      const breaches = result.companyCohortDefaults
        .filter((c) => c.defaultRatio >= CANARY_DEFAULT_RATE)
        .map((c) => ({ companyId: c.companyId, defaultRatio: c.defaultRatio }));
      const { trippedCount } = await syncCohortFailsafesFromCanary(breaches);
      logger.warn('canary sweep enforced cohort failsafes', {
        breachCount: breaches.length,
        newlyTripped: trippedCount,
      });
    }

    logger.info('report metrics compiled', {
      windowDays,
      durationMs: Date.now() - startedAt,
      gmvAED: result.gmvAED,
      mau: result.mau,
      canaryTripped: result.canaryTripped,
    });
    return result;
  }

  /**
   * Canary worker entrypoint. Compiles the rolling-30d metrics and
   * trips the per-cohort failsafe for any cohort ≥ 1.5%. Registered on
   * a cron alongside the reconciliation worker.
   */
  async runCanarySweep(): Promise<{ canaryTripped: boolean; canaryCompanyIds: string[] }> {
    const result = await this.compile(DEFAULT_WINDOW_DAYS, { enforceFailsafe: true });
    return { canaryTripped: result.canaryTripped, canaryCompanyIds: result.canaryCompanyIds };
  }
}

export const metricsService = new MetricsService();
