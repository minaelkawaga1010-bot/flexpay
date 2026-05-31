import { z } from 'zod';
import type { PlanType } from '@prisma/client';

/**
 * AI Offers personalisation — type surface.
 *
 * The personalisation service ranks the active Offer pool against a
 * worker-derived signal vector and (optionally) augments the pool
 * with LLM-generated category cues. The LLM never sees raw PII —
 * Tool 11's PII strip runs on every input that reaches it — and its
 * output is parsed against `personalisedOfferSchema` so a malformed
 * model response is a contract breach, not a runtime surprise.
 *
 * Categories: telecom, remittance, groceries — the three Phase-1 use
 * cases. Extending the union here is the single change required to
 * surface a new category through the pipeline.
 */

export const OFFER_CATEGORIES = ['telecom', 'remittance', 'groceries'] as const;
export type OfferCategory = (typeof OFFER_CATEGORIES)[number];

// ───────────────────────────────────────────────────────────────────
// Worker signal vector — the PII-free shape the personaliser reads.
// ───────────────────────────────────────────────────────────────────

/**
 * Derived feature vector for one employee. No name, phone, email,
 * Emirates ID — only the bands and counts needed to rank offers.
 * Built by `buildWorkerSignal` from the canonical Employee row +
 * recent EmployeeTransaction history.
 */
export interface WorkerSignal {
  employeeId: string;
  plan: PlanType;
  /** AED, monthly. Null when payroll has not yet posted. */
  monthlySalary: number | null;
  /** Last-30d totals by transaction category bucket. AED, positive. */
  spend30d: {
    telecom: number;
    remittance: number;
    groceries: number;
    other: number;
  };
  /** Total bill-payment volume in the last 30d. AED. */
  billPaymentVolume30d: number;
  /** Wallet balance at the snapshot point, in AED. */
  walletBalance: number;
  /** True if the worker has at least one COMPLETED remittance ever. */
  hasRemittanceHistory: boolean;
  /** Captured for audit / cache invalidation. */
  snapshotAt: string;
}

// ───────────────────────────────────────────────────────────────────
// Personalised offer — the post-rank shape returned to the client.
// ───────────────────────────────────────────────────────────────────

export const personalisedOfferSchema = z.object({
  offerId: z.string().min(1),
  category: z.enum(OFFER_CATEGORIES),
  /** 0–100. Higher = better match for the signal vector. */
  score: z.number().min(0).max(100),
  /** Short human-readable reason (no PII). Shown to the user. */
  reason: z.string().min(1).max(200),
});
export type PersonalisedOffer = z.infer<typeof personalisedOfferSchema>;

/** Schema the LLM is required to emit. */
export const llmPersonalisationOutputSchema = z.object({
  ranked: z
    .array(
      z.object({
        offerId: z.string().min(1),
        score: z.number().min(0).max(100),
        reason: z.string().min(1).max(200),
      }),
    )
    .max(50),
});
export type LlmPersonalisationOutput = z.infer<typeof llmPersonalisationOutputSchema>;

// ───────────────────────────────────────────────────────────────────
// Category inference — pure mapping from an Offer merchant string
// to one of our supported categories. Falls back to null when the
// merchant string is outside the Phase-1 surface.
// ───────────────────────────────────────────────────────────────────

const TELECOM_MERCHANTS = ['etisalat', 'du', 'virgin mobile', 'salam'];
const REMITTANCE_MERCHANTS = ['western union', 'wise', 'lulu exchange', 'al ansari', 'moneyhash', 'remit'];
const GROCERY_MERCHANTS = ['carrefour', 'lulu hypermarket', 'spinneys', 'union coop', 'choithrams', 'grocery'];

export function inferOfferCategory(merchant: string): OfferCategory | null {
  const m = merchant.toLowerCase();
  if (TELECOM_MERCHANTS.some((t) => m.includes(t))) return 'telecom';
  if (REMITTANCE_MERCHANTS.some((t) => m.includes(t))) return 'remittance';
  if (GROCERY_MERCHANTS.some((t) => m.includes(t))) return 'groceries';
  return null;
}
