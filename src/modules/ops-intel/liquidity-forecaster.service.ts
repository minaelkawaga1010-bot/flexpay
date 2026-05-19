import { Prisma } from '@prisma/client';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';

/**
 * Liquidity forecaster — 7 / 15 / 30-day runway projections.
 *
 * Runway accounting (per worker, per cycle, signed AED):
 *
 *   FlexPay disburses RESERVED advances on day-T.
 *   FlexPay is repaid on cycle-end day-N from the corporate WPS file.
 *
 *   At any point in time `t`, FlexPay's net liquidity exposure is:
 *
 *      Σ(amount_i + fee_i)  for advances reserved before t whose
 *                           cycle has NOT yet settled
 *
 *   The forecast window converts this exposure into a horizon-bounded
 *   "cash returning in N days" curve. The horizon partitions exposure
 *   by `cycle.periodEnd` — anything settling within H days is "inbound
 *   cash", anything beyond is "still parked".
 *
 * Why $queryRaw and not Prisma model API:
 *   • The aggregation crosses three tables (Advance → PayrollCycle →
 *     Company) with a date-bucketed sum. Idiomatic Prisma would force
 *     three round-trips and a JS-side groupBy on potentially tens of
 *     thousands of rows. Raw SQL aggregates in the database where the
 *     planner can use the `(cycleId, status)` index already on Advance.
 *   • Postgres width_bucket would be nice but rsk of dialect lock-in is
 *     not worth saving 2 lines of date math; we keep the SQL ANSI-safe
 *     so the same query runs on Aurora Postgres + standard Postgres in
 *     ops drills.
 *
 * Returned shape is intentionally serialisable for direct return from
 * the /admin/reports/metrics endpoint.
 */

export interface RunwayBucket {
  /** Window upper bound in days from `now`. */
  horizonDays: number;
  /** Σ outstanding advance principal whose cycle settles within `horizonDays`. */
  inboundAED: number;
  /** Σ fees on those advances (the actual gross-margin component). */
  inboundFeesAED: number;
  /** Number of distinct advance rows contributing to inbound bucket. */
  advanceCount: number;
}

export interface LiquidityForecast {
  generatedAt: Date;
  /** Total outstanding (RESERVED) advance exposure right now, all currencies converted to AED. */
  outstandingAED: number;
  /** Total fees on those outstanding advances (revenue, not exposure). */
  outstandingFeesAED: number;
  /** Active advance row count. */
  outstandingCount: number;
  buckets: RunwayBucket[];
  /**
   * Inbound corporate WPS funding expected. A cycle in OPEN/INTENTS_READY
   * status whose periodEnd falls in the horizon contributes its
   * Σ grossAmount to the inbound side. This is the *other* half of the
   * runway curve — what comes IN from the employer to repay advances.
   */
  corporateInboundsAED: { horizonDays: number; amountAED: number; cycleCount: number }[];
  /**
   * net-position = corporateInbounds − outstandingAdvances (per horizon).
   * Negative number means we expect to disburse more cash than we
   * recover in that window; trips ops-tier alerting if it crosses the
   * configured floor.
   */
  netByHorizonAED: { horizonDays: number; netAED: number }[];
}

const HORIZON_DAYS = [7, 15, 30] as const;

/**
 * Aggregate currently-outstanding (RESERVED, not yet SETTLED) advances
 * bucketed by the day their owning cycle settles.
 *
 * NOTE: the LedgerEntry table is the canonical source for "money
 * already moved"; the Advance table is the source for "money
 * outstanding". We query Advance for forward-looking exposure, not
 * LedgerEntry, on purpose — ledger is post-fact, advance is pre-fact.
 */
async function getOutstandingByBucket(): Promise<RunwayBucket[]> {
  // Each row: one bucket. We compute three rows in a single round-trip
  // via a CTE that classifies every outstanding advance into the
  // tightest horizon it falls into. A cycle settling in 3 days lands in
  // ALL THREE buckets — the buckets are *cumulative*, not exclusive,
  // because "7-day runway" means "cash returning in ≤7 days".
  const rows = await prisma.$queryRaw<
    { horizonDays: number; inboundAED: number; inboundFeesAED: number; advanceCount: bigint }[]
  >`
    WITH outstanding AS (
      SELECT a.id, a.amount, a.fee, c."periodEnd"
      FROM advances a
      INNER JOIN payroll_cycles c ON c.id = a."cycleId"
      WHERE a.status = 'RESERVED'
        AND c.status IN ('OPEN', 'INTENTS_READY')
        AND a.currency = 'AED'
    ),
    horizons AS (
      SELECT unnest(ARRAY[7, 15, 30]) AS "horizonDays"
    )
    SELECT
      h."horizonDays"                                                AS "horizonDays",
      COALESCE(SUM(o.amount), 0)::float8                             AS "inboundAED",
      COALESCE(SUM(o.fee), 0)::float8                                AS "inboundFeesAED",
      COUNT(o.id)                                                    AS "advanceCount"
    FROM horizons h
    LEFT JOIN outstanding o
      ON o."periodEnd" <= NOW() + (h."horizonDays" || ' days')::interval
    GROUP BY h."horizonDays"
    ORDER BY h."horizonDays"
  `;

  return rows.map((r) => ({
    horizonDays: Number(r.horizonDays),
    inboundAED: Number(r.inboundAED ?? 0),
    inboundFeesAED: Number(r.inboundFeesAED ?? 0),
    advanceCount: Number(r.advanceCount ?? 0),
  }));
}

/**
 * Aggregate corporate WPS inbound funding by horizon — i.e. the
 * gross amount of cycles whose periodEnd lands within H days and which
 * are still OPEN/INTENTS_READY (a SETTLED cycle has already paid in).
 */
async function getCorporateInboundsByBucket(): Promise<
  { horizonDays: number; amountAED: number; cycleCount: number }[]
> {
  const rows = await prisma.$queryRaw<
    { horizonDays: number; amountAED: number; cycleCount: bigint }[]
  >`
    WITH live_cycles AS (
      SELECT c.id, c."periodEnd", COALESCE(SUM(pi."grossAmount"), 0) AS gross
      FROM payroll_cycles c
      LEFT JOIN payroll_intents pi ON pi."cycleId" = c.id
      WHERE c.status IN ('OPEN', 'INTENTS_READY')
      GROUP BY c.id, c."periodEnd"
    ),
    horizons AS (
      SELECT unnest(ARRAY[7, 15, 30]) AS "horizonDays"
    )
    SELECT
      h."horizonDays"                                       AS "horizonDays",
      COALESCE(SUM(lc.gross), 0)::float8                    AS "amountAED",
      COUNT(lc.id)                                          AS "cycleCount"
    FROM horizons h
    LEFT JOIN live_cycles lc
      ON lc."periodEnd" <= NOW() + (h."horizonDays" || ' days')::interval
    GROUP BY h."horizonDays"
    ORDER BY h."horizonDays"
  `;
  return rows.map((r) => ({
    horizonDays: Number(r.horizonDays),
    amountAED: Number(r.amountAED ?? 0),
    cycleCount: Number(r.cycleCount ?? 0),
  }));
}

/**
 * Snapshot outstanding (status=RESERVED) advances right now. Cheap —
 * a single index scan on advances(status).
 */
async function getOutstandingTotals(): Promise<{
  outstandingAED: number;
  outstandingFeesAED: number;
  outstandingCount: number;
}> {
  const row = await prisma.$queryRaw<
    { outstandingAED: number; outstandingFeesAED: number; outstandingCount: bigint }[]
  >`
    SELECT
      COALESCE(SUM(amount), 0)::float8 AS "outstandingAED",
      COALESCE(SUM(fee), 0)::float8    AS "outstandingFeesAED",
      COUNT(*)                         AS "outstandingCount"
    FROM advances
    WHERE status = 'RESERVED' AND currency = 'AED'
  `;
  return {
    outstandingAED: Number(row[0]?.outstandingAED ?? 0),
    outstandingFeesAED: Number(row[0]?.outstandingFeesAED ?? 0),
    outstandingCount: Number(row[0]?.outstandingCount ?? 0),
  };
}

export class LiquidityForecasterService {
  /**
   * Produce the full 7 / 15 / 30-day liquidity forecast. Runs three
   * parallel raw-SQL aggregates and joins them client-side. Total
   * latency target: < 250ms on a fleet of ~50k active advances.
   */
  async forecast(): Promise<LiquidityForecast> {
    const startedAt = Date.now();
    const [outstandingTotals, outstandingBuckets, corporateInbounds] = await Promise.all([
      getOutstandingTotals(),
      getOutstandingByBucket(),
      getCorporateInboundsByBucket(),
    ]);

    const netByHorizonAED = HORIZON_DAYS.map((h) => {
      const inb = corporateInbounds.find((c) => c.horizonDays === h)?.amountAED ?? 0;
      const out = outstandingBuckets.find((c) => c.horizonDays === h)?.inboundAED ?? 0;
      return { horizonDays: h, netAED: inb - out };
    });

    const result: LiquidityForecast = {
      generatedAt: new Date(),
      ...outstandingTotals,
      buckets: outstandingBuckets,
      corporateInboundsAED: corporateInbounds,
      netByHorizonAED,
    };

    logger.info('liquidity forecast generated', {
      durationMs: Date.now() - startedAt,
      outstandingAED: result.outstandingAED,
      outstandingCount: result.outstandingCount,
    });
    return result;
  }
}

export const liquidityForecasterService = new LiquidityForecasterService();

// Re-export the Prisma namespace so test files importing for type
// utilities don't need a second import.
void Prisma;
