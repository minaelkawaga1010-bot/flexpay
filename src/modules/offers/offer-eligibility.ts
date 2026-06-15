import type { Offer, PlanType } from '@prisma/client';
import type { WorkerSignal, OfferCategory } from './offers.types';

/**
 * Offer eligibility & scoring — pure functions.
 *
 * Kept side-effect-free so the personaliser can call them inside any
 * transaction or LLM-fallback path without widening DB / network
 * surface area. Every public function takes (offer | category | signal)
 * and returns a primitive — no I/O, no time, no Math.random.
 *
 * Why pre-LLM eligibility:
 *   We never ask the LLM to enforce hard gates (plan, salary, expiry,
 *   active flag). Those are deterministic guards run on the server so
 *   a model that hallucinates a banned offer cannot leak past us.
 *   The LLM only sees the post-eligibility pool — its job is ranking
 *   and reason-string composition, not authorisation.
 */

// ───────────────────────────────────────────────────────────────────
// Hard gates
// ───────────────────────────────────────────────────────────────────

/**
 * Returns true iff the offer is currently servable AND the signal-
 * carrying worker is allowed to see it. The check is conjunctive:
 * any failed gate eliminates the offer regardless of LLM ranking.
 */
export function isOfferEligible(
  offer: Pick<Offer, 'isActive' | 'expiresAt' | 'planRequired' | 'minSalary'>,
  signal: Pick<WorkerSignal, 'plan' | 'monthlySalary'>,
  now: Date = new Date(),
): boolean {
  if (!offer.isActive) return false;
  if (offer.expiresAt.getTime() <= now.getTime()) return false;
  if (offer.planRequired && !planSatisfies(signal.plan, offer.planRequired)) return false;
  if (offer.minSalary != null) {
    // A null monthlySalary is "unknown income" — we deliberately gate
    // out salary-conditioned offers in that case rather than assuming
    // satisfaction. Better to under-surface than to surface offers a
    // worker cannot actually take advantage of.
    if (signal.monthlySalary == null) return false;
    if (signal.monthlySalary < offer.minSalary) return false;
  }
  return true;
}

/**
 * Plan dominance. LUXURY satisfies a LUXURY or BASIC requirement;
 * BASIC only satisfies BASIC. The schema only defines two plans, but
 * keeping the dominance check explicit means a third plan slots in
 * by amending the table — no scattered ternaries to chase.
 */
const PLAN_RANK: Record<PlanType, number> = {
  BASIC: 0,
  LUXURY: 1,
};

export function planSatisfies(workerPlan: PlanType, requiredPlan: PlanType): boolean {
  return PLAN_RANK[workerPlan] >= PLAN_RANK[requiredPlan];
}

// ───────────────────────────────────────────────────────────────────
// Heuristic scoring — used as the deterministic fallback when the
// LLM is unavailable, and as the seed prior the LLM re-ranks against.
// Score ∈ [0, 100].
// ───────────────────────────────────────────────────────────────────

/**
 * Heuristic score for a (signal, category, offer) triple.
 *
 *   • Base 40 — every eligible offer is at least surfaced.
 *   • + up to 35 — category alignment with the worker's last-30d spend
 *     bucket (proportional to spend share).
 *   • + up to 15 — discount magnitude (linear, capped at 75% off).
 *   • + 10 — remittance kicker for workers with remittance history.
 *
 * Capped at 100. Used to assemble the seed ranking the LLM re-ranks,
 * and as the standalone ranker when the LLM path is bypassed.
 */
export function heuristicScore(
  offer: Pick<Offer, 'discountPercentage' | 'merchant'>,
  category: OfferCategory | null,
  signal: WorkerSignal,
): number {
  let score = 40;

  if (category) {
    const totalSpend =
      signal.spend30d.telecom +
      signal.spend30d.remittance +
      signal.spend30d.groceries +
      signal.spend30d.other;
    if (totalSpend > 0) {
      const share = signal.spend30d[category] / totalSpend;
      score += Math.round(share * 35);
    }
  }

  const discount = Math.max(0, Math.min(offer.discountPercentage, 75));
  score += Math.round((discount / 75) * 15);

  if (category === 'remittance' && signal.hasRemittanceHistory) {
    score += 10;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Deterministic reason string for the heuristic ranker. The LLM
 * normally writes a better one; this is the fallback the user sees
 * when the LLM path is bypassed.
 */
export function heuristicReason(
  offer: Pick<Offer, 'discountPercentage' | 'merchant'>,
  category: OfferCategory | null,
  signal: WorkerSignal,
): string {
  if (category && signal.spend30d[category] > 0) {
    return `Matches your recent ${category} spend (${offer.discountPercentage}% off).`;
  }
  if (category === 'remittance' && signal.hasRemittanceHistory) {
    return `Save on transfers like the ones you sent recently (${offer.discountPercentage}% off).`;
  }
  return `${offer.discountPercentage}% off at ${offer.merchant}.`;
}
