import { z } from 'zod';
import redisService from '@config/redis';
import logger from '@shared/utils/logger';
import { apportionSettlement, MIN_NET_FLOOR_AED } from '@modules/payroll-routing/settlement-policy';

/**
 * FlexScore engine — Bible §2.2 event-sourced continuous underwriting.
 *
 * This module is the *contract* layer: the 37-feature builder, the
 * trigger enum, the formula glue, and the Redis cache topology. The
 * actual ML inference is delegated to a pluggable `FlexScoreModel`
 * implementation. Production wiring binds the SageMaker XGBoost +
 * Cox Survival endpoint; tests bind a deterministic stub.
 *
 * What lives here:
 *
 *   • TRIGGER_EVENTS enum — every behavioral event that recomputes
 *   • FeatureVector type — the 37-feature contract (Bible Table §2.2)
 *   • recalculate(workerId, trigger) — the public entrypoint
 *   • Redis cache write: flexscore:{worker_id} for 300s
 *   • Earned-wage cap: DL ≤ S_base × P_t × 0.50
 *   • AED 300 net floor: DL + outstanding ≤ S_base − 300
 *
 * What does NOT live here (intentionally):
 *
 *   • The XGBoost model itself — injected via setFlexScoreModel()
 *   • The Cox Survival 30d/60d/90d output — same plug-in interface
 *   • The Postgres flexscore_events insert — caller-side once the
 *     schema migration lands (see CTO Review note A.4)
 *
 * Schema dependency:
 *
 *   Requires a `flexscore_events` table per Bible §1.3. Until the
 *   migration is applied, calls to `persistEvent` no-op with a
 *   WARN-level log. Callers should still receive the response object
 *   so the UI binds correctly.
 */

// ───────────────────────────────────────────────────────────────────
// Trigger enum — Bible §2.2 TRIGGER_EVENTS list
// ───────────────────────────────────────────────────────────────────

export const FLEXSCORE_TRIGGERS = [
  'WPS_SALARY_CREDITED',
  'EWA_REPAYMENT',
  'CARD_SPEND_SPIKE',
  'BILL_PAYMENT',
  'ATM_WITHDRAWAL',
  'BALANCE_LOW_ALERT',
  'LOGIN_GAP_7D',
  'ATTENDANCE_UPDATE',
  'EMPLOYEE_TERMINATED',
] as const;
export type FlexScoreTrigger = (typeof FLEXSCORE_TRIGGERS)[number];

// ───────────────────────────────────────────────────────────────────
// Feature vector — Bible §2.2 + Table at end of §2.2
// ───────────────────────────────────────────────────────────────────

/**
 * The 37-feature input to the XGBoost model. Names mirror the Bible
 * Table (Income / Spend / Repayment / Activity).
 *
 * Decomposition note: the Bible's headline formula is
 *
 *   DL(t) = model.predict([ S_base × P_t × A_i × V_w, ...37 features ])
 *
 * So the *first* feature slot is the composite product and the
 * remaining 36 are the engineered features. We split them out
 * explicitly here.
 */
export interface FlexScoreFeatures {
  // --- Headline composite (Bible: feature #0) ---------------------
  /** Verified WPS gross salary (S_base) — never self-reported. */
  verifiedSalaryAED: number;
  /** P_t — month progress ∈ [0,1] = days_elapsed/days_in_month. */
  monthProgress: number;
  /** A_i — attendance reliability index, 90d rolling, ∈ [0,1]. */
  attendanceIndex: number;
  /** V_w — wallet behavioral velocity composite ∈ [0,1]. */
  walletVelocity: number;

  // --- Income signals (35%, Bible Table row 1) --------------------
  salaryConsistency12m: number;     // 0..1
  employerHealthScore: number;      // [0,1] — TFT output on Company.payrollHealthScore
  salaryGrowth6m: number;           // -1..+1
  salaryStandardDeviationPct: number;
  cyclesEmployerPaidOnTime: number;

  // --- Spend behavior (25%, Bible Table row 2) --------------------
  essentialSpendRatio30d: number;   // 0..1
  atmWithdrawalVelocity: number;    // withdrawals/week, 30d window
  merchantDiversity: number;        // distinct merchants / total tx
  cardSpendStdDev: number;
  discretionarySpendRatio: number;

  // --- Repayment history (30%, Bible Table row 3) -----------------
  ewaOnTimeRate: number;            // 0..1
  daysToRepayLastAdvance: number;
  partialRepaymentFlag: 0 | 1;
  defaultedAdvanceCount: number;
  cumulativeEwaRecoveredAED: number;

  // --- Activity signals (10%, Bible Table row 4) ------------------
  loginFrequency7d: number;
  billPaymentConsistency: number;   // 0..1
  p2pTransferFreq: number;
  notificationOpenRate30d: number;
  lastLoginDaysAgo: number;

  // --- Outstanding state (used by floor enforcement) --------------
  outstandingEwaAED: number;

  // --- Additional features (pads to 37 total) ---------------------
  daysSinceWalletCreated: number;
  daysOnCurrentEmployer: number;
  emiratesIdAgeYears: number;
  isLuxuryPlan: 0 | 1;
  hasPhysicalCard: 0 | 1;
  hasAppleGooglePay: 0 | 1;
  failedAuthLast24h: number;
  deviceCount: number;
  inSanctionsWatchlist: 0 | 1;
  cohortDefaultRate: number;
  cohortAverageEwaUtilisation: number;
  thirtyDayWalletInflowAED: number;
}

export const FEATURE_COUNT = 37;

// ───────────────────────────────────────────────────────────────────
// Model contract — pluggable so production swaps in SageMaker, tests
// swap in a deterministic stub. The Bible's two outputs are bundled
// into one inference call to share feature extraction cost.
// ───────────────────────────────────────────────────────────────────

export interface FlexScoreModelOutput {
  /** XGBoost raw output — interpreted as a per-worker AED limit ceiling before caps. */
  rawDynamicLimitAED: number;
  /** Cox Survival probability of default in 30 days, ∈ [0,1]. */
  pDefault30d: number;
  pDefault60d: number;
  pDefault90d: number;
}

export interface FlexScoreModel {
  modelVersion: string;
  predict(features: FlexScoreFeatures): Promise<FlexScoreModelOutput>;
}

/**
 * Stub model — refuses to run in production (env detection). The real
 * binding lives in `infra/flexscore-sagemaker.ts` (Phase 2 Sprint S2.1
 * deliverable; not in scope here).
 */
class StubFlexScoreModel implements FlexScoreModel {
  modelVersion = 'stub-v0.0.0';
  async predict(): Promise<FlexScoreModelOutput> {
    throw new Error(
      'FlexScore: production model not configured. Bind via setFlexScoreModel() at boot.',
    );
  }
}

let activeModel: FlexScoreModel = new StubFlexScoreModel();
export function setFlexScoreModel(model: FlexScoreModel): void {
  activeModel = model;
  logger.info('FlexScore model bound', { version: model.modelVersion });
}

// ───────────────────────────────────────────────────────────────────
// Result + caching
// ───────────────────────────────────────────────────────────────────

const flexScoreCachePayloadSchema = z.object({
  rawDynamicLimitAED: z.number(),
  dynamicLimitAED: z.number(),
  pDefault30d: z.number(),
  pDefault60d: z.number(),
  pDefault90d: z.number(),
  modelVersion: z.string(),
  computedAt: z.number(),
});

export interface FlexScoreResult {
  /** Unbounded raw model output before caps. Logged for model-drift detection. */
  rawDynamicLimitAED: number;
  /** Final available EWA limit after the earned-wage cap and AED-300 floor. */
  dynamicLimitAED: number;
  pDefault30d: number;
  pDefault60d: number;
  pDefault90d: number;
  modelVersion: string;
  computedAt: Date;
}

const REDIS_KEY = (workerId: string) => `flexscore:${workerId}`;
const REDIS_TTL_SECONDS = 300; // Bible §1.5 — exactly 300s

// ───────────────────────────────────────────────────────────────────
// Engine
// ───────────────────────────────────────────────────────────────────

export interface FlexScoreEngineDeps {
  buildFeatureVector: (workerId: string) => Promise<FlexScoreFeatures>;
  persistEvent?: (event: {
    workerId: string;
    trigger: FlexScoreTrigger;
    result: FlexScoreResult;
    features: FlexScoreFeatures;
  }) => Promise<void>;
}

export class FlexScoreEngine {
  constructor(private readonly deps: FlexScoreEngineDeps) {}

  /**
   * Recalculate the FlexScore for a worker on a behavioral event.
   * Writes the Redis cache, optionally persists an append-only
   * flexscore_events row, returns the bounded result for caller use.
   *
   * Bible §2.2 composition:
   *   1. Build 37-feature vector from PostgreSQL state
   *   2. Run XGBoost → raw limit + Cox survival probabilities
   *   3. Cap at S_base × P_t × 0.50 (earned wages only)
   *   4. Enforce AED 300 floor: outstanding + DL ≤ S_base − 300
   *   5. Persist append-only event + cache 300s in Redis
   */
  async recalculate(workerId: string, trigger: FlexScoreTrigger): Promise<FlexScoreResult> {
    const features = await this.deps.buildFeatureVector(workerId);
    const modelOutput = await activeModel.predict(features);

    const bounded = this.applyBounds(features, modelOutput);

    const result: FlexScoreResult = {
      rawDynamicLimitAED: modelOutput.rawDynamicLimitAED,
      dynamicLimitAED: bounded,
      pDefault30d: modelOutput.pDefault30d,
      pDefault60d: modelOutput.pDefault60d,
      pDefault90d: modelOutput.pDefault90d,
      modelVersion: activeModel.modelVersion,
      computedAt: new Date(),
    };

    // Cache writes are fire-and-forget — a Redis outage must not
    // block the underwriting path. The caller still has the result.
    void this.writeCache(workerId, result);
    if (this.deps.persistEvent) {
      try {
        await this.deps.persistEvent({ workerId, trigger, result, features });
      } catch (err) {
        logger.warn('FlexScore: event persist failed (result still returned)', {
          workerId,
          trigger,
          error: (err as Error).message,
        });
      }
    } else {
      logger.warn('FlexScore: persistEvent not configured — flexscore_events not written', {
        workerId,
        trigger,
      });
    }
    return result;
  }

  /**
   * Apply Bible §2.2 hard caps:
   *
   *   max_earned     = S_base × P_t × 0.50              (earned-wage cap)
   *   floor_residual = S_base − MIN_NET_FLOOR_AED       (post-recovery floor)
   *   DL = MIN(model_raw, max_earned, floor_residual − outstanding)
   *   DL = MAX(0, DL)
   *
   * Returns the bounded DL.
   */
  private applyBounds(features: FlexScoreFeatures, output: FlexScoreModelOutput): number {
    const maxEarned = features.verifiedSalaryAED * features.monthProgress * 0.5;
    const headroomToFloor =
      features.verifiedSalaryAED - MIN_NET_FLOOR_AED - features.outstandingEwaAED;

    const bounded = Math.min(output.rawDynamicLimitAED, maxEarned, headroomToFloor);
    return Math.max(0, Math.round(bounded * 100) / 100);
  }

  private async writeCache(workerId: string, result: FlexScoreResult): Promise<void> {
    try {
      const payload = JSON.stringify({
        rawDynamicLimitAED: result.rawDynamicLimitAED,
        dynamicLimitAED: result.dynamicLimitAED,
        pDefault30d: result.pDefault30d,
        pDefault60d: result.pDefault60d,
        pDefault90d: result.pDefault90d,
        modelVersion: result.modelVersion,
        computedAt: result.computedAt.getTime(),
      });
      await redisService.set(REDIS_KEY(workerId), payload, REDIS_TTL_SECONDS);
    } catch (err) {
      logger.warn('FlexScore: cache write failed', {
        workerId,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Read-only fast path. Returns the cached result without
   * recalculating. Used by the mobile balance endpoint and the EWA
   * preflight check.
   */
  async peek(workerId: string): Promise<FlexScoreResult | null> {
    try {
      const raw = await redisService.get(REDIS_KEY(workerId));
      if (!raw) return null;
      const parsed = flexScoreCachePayloadSchema.parse(JSON.parse(raw));
      return {
        rawDynamicLimitAED: parsed.rawDynamicLimitAED,
        dynamicLimitAED: parsed.dynamicLimitAED,
        pDefault30d: parsed.pDefault30d,
        pDefault60d: parsed.pDefault60d,
        pDefault90d: parsed.pDefault90d,
        modelVersion: parsed.modelVersion,
        computedAt: new Date(parsed.computedAt),
      };
    } catch (err) {
      logger.warn('FlexScore: cache read failed', {
        workerId,
        error: (err as Error).message,
      });
      return null;
    }
  }

  /** Invalidate the cache on out-of-band state changes (employee terminated, etc). */
  async invalidate(workerId: string): Promise<void> {
    try {
      await redisService.del(REDIS_KEY(workerId));
    } catch {
      /* idempotent best-effort */
    }
  }
}

// Helper for FlexScore consumers that don't want to thread the engine
// through every call site: produce a per-call previewable apportionment
// of a hypothetical settlement using the current feature snapshot.
export function previewSettlementImpact(
  features: FlexScoreFeatures,
  projectedGrossAED: number,
) {
  return apportionSettlement(projectedGrossAED, features.outstandingEwaAED);
}
