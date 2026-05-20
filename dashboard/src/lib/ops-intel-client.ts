import { z } from 'zod';

/**
 * Typed client for the Ops-Intel proxy routes:
 *
 *   GET  /api/ops-intel/metrics?windowDays=30
 *   GET  /api/ops-intel/liquidity
 *   POST /api/ops-intel/fraud-scan
 *
 * Schemas mirror the backend services in src/modules/ops-intel/ exactly;
 * a parse failure means the contract has drifted and we want to fail
 * loud, not silently render NaN cards. The schemas live in the
 * dashboard codebase rather than being imported across surfaces
 * because the dashboard and backend ship to different runtimes and we
 * keep the seam at the JSON boundary.
 */

// ───────────────────────────────────────────────────────────────────
// Constants — these MUST stay in sync with the backend.
// ───────────────────────────────────────────────────────────────────

/** STRATEGY.md §F failsafe trigger. */
export const CANARY_DEFAULT_RATE = 0.015;

/** Visual warning band — cohorts above this but below the canary
 *  are surfaced to ops as "approaching freeze" without firing. */
export const CANARY_WARN_RATE = 0.0125;

// ───────────────────────────────────────────────────────────────────
// Metrics
// ───────────────────────────────────────────────────────────────────

const cohortDefaultSchema = z.object({
  companyId: z.string(),
  companyName: z.string(),
  defaultRatio: z.number(),
  disbursedAED: z.number(),
});

const reportMetricsSchema = z.object({
  generatedAt: z.union([z.string(), z.date()]),
  windowDays: z.number(),
  gmvAED: z.number(),
  mau: z.number(),
  netMarginalRevenueAED: z.number(),
  revenueBreakdown: z.object({
    advanceFeesAED: z.number(),
    remittanceMarginAED: z.number(),
    cardInterchangeAED: z.number(),
  }),
  defaultRatio: z.number(),
  companyCohortDefaults: z.array(cohortDefaultSchema),
  canaryTripped: z.boolean(),
  canaryCompanyIds: z.array(z.string()),
  outstandingAdvancesAED: z.number(),
});
export type ReportMetrics = z.infer<typeof reportMetricsSchema>;
export type CohortDefault = z.infer<typeof cohortDefaultSchema>;

// ───────────────────────────────────────────────────────────────────
// Liquidity forecast
// ───────────────────────────────────────────────────────────────────

const runwayBucketSchema = z.object({
  horizonDays: z.number(),
  inboundAED: z.number(),
  inboundFeesAED: z.number(),
  advanceCount: z.number(),
});

const liquidityForecastSchema = z.object({
  generatedAt: z.union([z.string(), z.date()]),
  outstandingAED: z.number(),
  outstandingFeesAED: z.number(),
  outstandingCount: z.number(),
  buckets: z.array(runwayBucketSchema),
  corporateInboundsAED: z.array(
    z.object({
      horizonDays: z.number(),
      amountAED: z.number(),
      cycleCount: z.number(),
    }),
  ),
  netByHorizonAED: z.array(
    z.object({ horizonDays: z.number(), netAED: z.number() }),
  ),
});
export type LiquidityForecast = z.infer<typeof liquidityForecastSchema>;
export type RunwayBucket = z.infer<typeof runwayBucketSchema>;

// ───────────────────────────────────────────────────────────────────
// Fraud monitor
// ───────────────────────────────────────────────────────────────────

const velocityAlertSchema = z.object({
  employeeId: z.string(),
  windowCount: z.number(),
  baselineMean: z.number(),
  multiple: z.number(),
  totalAEDInWindow: z.number(),
});

const attendanceDropAlertSchema = z.object({
  companyId: z.string(),
  companyName: z.string(),
  todayAccruedAED: z.number(),
  baselineMeanAED: z.number(),
  dropFraction: z.number(),
  affectedIntentCount: z.number(),
});

const fraudScanResultSchema = z.object({
  scannedAt: z.union([z.string(), z.date()]),
  velocityAlerts: z.array(velocityAlertSchema),
  attendanceDropAlerts: z.array(attendanceDropAlertSchema),
});
export type FraudScanResult = z.infer<typeof fraudScanResultSchema>;
export type VelocityAlert = z.infer<typeof velocityAlertSchema>;
export type AttendanceDropAlert = z.infer<typeof attendanceDropAlertSchema>;

// ───────────────────────────────────────────────────────────────────
// Client
// ───────────────────────────────────────────────────────────────────

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (body as { error?: string; message?: string }).error ??
      (body as { error?: string; message?: string }).message ??
      `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return body;
}

export const opsIntelClient = {
  async fetchMetrics(windowDays: number = 30): Promise<ReportMetrics> {
    const raw = await fetchJson(`/api/ops-intel/metrics?windowDays=${windowDays}`);
    return reportMetricsSchema.parse(raw);
  },

  async fetchLiquidity(): Promise<LiquidityForecast> {
    const raw = await fetchJson('/api/ops-intel/liquidity');
    return liquidityForecastSchema.parse(raw);
  },

  async runFraudScan(): Promise<FraudScanResult> {
    const raw = await fetchJson('/api/ops-intel/fraud-scan', { method: 'POST' });
    return fraudScanResultSchema.parse(raw);
  },
};

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

export type CohortStatus = 'tripped' | 'warning' | 'healthy';

/**
 * Classify a cohort's default ratio against the canary thresholds.
 *
 *   ratio >= 0.015 → tripped   (autonomous DCSE limit-raising stripped)
 *   ratio >= 0.0125 → warning  (within 25bps of the canary; ops should look)
 *   else           → healthy
 */
export function classifyCohort(ratio: number): CohortStatus {
  if (ratio >= CANARY_DEFAULT_RATE) return 'tripped';
  if (ratio >= CANARY_WARN_RATE) return 'warning';
  return 'healthy';
}

/** AED currency formatter, 2 decimals, en-AE locale. */
export function formatAED(n: number): string {
  return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Default ratio renderer — three decimal places as a percentage. */
export function formatRatio(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}
