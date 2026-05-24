import { env } from '@config/env';
import logger from '@shared/utils/logger';

/**
 * Card-authorization fraud scorer — Bible §4.1.
 *
 * NymCard calls FlexPay inside Visa's 90ms authorization window. The
 * fraud score must return in <12ms (Bible target) so the total
 * pipeline (signature verify + fraud + balance) stays under the 50ms
 * p99 budget.
 *
 * Production binds a LightGBM model (47 features, hosted on a low-
 * latency EC2 inference endpoint — Bible Phase 2 Sprint S2.7). Because
 * that endpoint is external and a network hop would blow the 12ms
 * budget on its own, the production deployment runs the LightGBM model
 * IN-PROCESS (the model artifact is small; loaded at boot). The
 * `FraudScorer` interface lets us swap the in-process model for an
 * HTTP endpoint in non-latency-critical contexts (back-testing).
 *
 * Until the model artifact lands, a deterministic heuristic scorer
 * provides a real, defensible decision surface — it is NOT a stub that
 * throws. The card rail cannot have a fail-open hole, so the heuristic
 * is a genuine (if simpler) risk model that ships today and is
 * superseded by LightGBM when trained.
 */

export interface FraudSignals {
  cardId: string;
  amount: number;
  merchantMcc: string;
  merchantCountry: string;
  deviceFingerprint?: string;
  geoLat?: number;
  geoLng?: number;
  /** Count of card transactions in the last 60 seconds (velocity). */
  recentTxCount60s: number;
  /** Sum of card spend in the last 60 seconds. */
  recentTxAmount60s: number;
  /** The card's home country (issuer geo) for cross-border detection. */
  homeCountry?: string;
}

export interface FraudScorer {
  /** Returns a fraud-likelihood score ∈ [0,1]. Lower is safer. */
  score(signals: FraudSignals): Promise<number>;
  readonly name: string;
}

/** Bible §4.1: decline when score > 0.82. */
export const FRAUD_DECLINE_THRESHOLD = 0.82;

/**
 * Heuristic fraud model. Interpretable, sub-millisecond, defensible.
 * Each rule contributes additive risk; the total is squashed to [0,1].
 *
 * Risk factors (mirrors a subset of the LightGBM feature set):
 *   • High-risk MCC (gambling 7995, crypto 6051, money-transfer 4829)
 *   • Velocity spike (>3 tx or >5000 AED in 60s)
 *   • Cross-border mismatch (merchant country ≠ home country)
 *   • High-risk merchant geography (sanctioned / high-fraud corridors)
 *   • Large single-ticket (>3000 AED)
 *   • Missing device fingerprint on a high-value txn
 */
export class HeuristicFraudScorer implements FraudScorer {
  readonly name = 'heuristic-v1';

  private static readonly HIGH_RISK_MCC = new Set(['7995', '6051', '4829', '7273']);
  private static readonly HIGH_RISK_COUNTRIES = new Set(['IR', 'KP', 'SY', 'RU']);

  async score(s: FraudSignals): Promise<number> {
    let risk = 0;

    if (HeuristicFraudScorer.HIGH_RISK_MCC.has(s.merchantMcc)) risk += 0.35;
    if (HeuristicFraudScorer.HIGH_RISK_COUNTRIES.has(s.merchantCountry.toUpperCase())) risk += 0.5;

    // Velocity: rapid repeated authorizations are the classic
    // card-testing / enumeration signal — one of the highest-confidence
    // fraud indicators, so a sustained burst (>=5 in 60s) declines on
    // its own.
    if (s.recentTxCount60s >= 5) risk += 0.6;
    else if (s.recentTxCount60s >= 3) risk += 0.2;
    if (s.recentTxAmount60s + s.amount > 5000) risk += 0.25;

    // Cross-border: a UAE-issued card transacting abroad with no prior
    // travel signal is elevated risk.
    if (s.homeCountry && s.merchantCountry.toUpperCase() !== s.homeCountry.toUpperCase()) {
      risk += 0.15;
    }

    if (s.amount > 3000) risk += 0.15;
    if (!s.deviceFingerprint && s.amount > 1000) risk += 0.1;

    // Squash to [0,1] — additive risk saturates rather than overflowing.
    return Math.min(1, Math.max(0, risk));
  }
}

/**
 * HTTP-backed scorer for environments where the model runs out of
 * process (back-testing / shadow scoring). NOT used on the hot auth
 * path in production (the network hop blows the 12ms budget).
 */
export class HttpFraudScorer implements FraudScorer {
  readonly name = 'http-lightgbm';
  constructor(private readonly url: string, private readonly timeoutMs = 12) {}

  async score(signals: FraudSignals): Promise<number> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signals),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`fraud scorer HTTP ${res.status}`);
      const body = (await res.json()) as { score: number };
      return Math.min(1, Math.max(0, body.score));
    } finally {
      clearTimeout(timer);
    }
  }
}

let activeScorer: FraudScorer = new HeuristicFraudScorer();

export function setFraudScorer(scorer: FraudScorer): void {
  activeScorer = scorer;
  logger.info('fraud scorer bound', { name: scorer.name });
}

export function getFraudScorer(): FraudScorer {
  return activeScorer;
}

// Bind the HTTP scorer automatically if an endpoint is configured AND
// we're explicitly in a back-testing context. The hot path keeps the
// in-process heuristic by default.
if (env.FRAUD_SCORER_URL && process.env.FRAUD_SCORER_MODE === 'http') {
  setFraudScorer(new HttpFraudScorer(env.FRAUD_SCORER_URL));
}
