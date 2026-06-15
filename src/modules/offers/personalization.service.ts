import type { Offer } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@config/prisma';
import { NotFound } from '@shared/utils/errors';
import logger from '@shared/utils/logger';
import {
  guardedLLMCall,
  FirewallError,
  type LlmInvoker,
} from '@shared/security/prompt-firewall';
import {
  heuristicReason,
  heuristicScore,
  isOfferEligible,
} from './offer-eligibility';
import {
  inferOfferCategory,
  llmPersonalisationOutputSchema,
  type LlmPersonalisationOutput,
  type OfferCategory,
  type PersonalisedOffer,
  type WorkerSignal,
} from './offers.types';

/**
 * AI Offers personalisation service.
 *
 * Pipeline:
 *
 *   1. buildWorkerSignal(employeeId)
 *      Reads the Employee row + last-30d EmployeeTransactions and
 *      collapses them into a PII-free signal vector (plan, salary
 *      band, spend-by-category, remittance history). The signal
 *      vector is the only worker-derived data that leaves the
 *      service boundary.
 *
 *   2. eligibleOffersFor(signal)
 *      Filters the active offer pool through the deterministic
 *      hard-gates (plan, salary, expiry). The LLM never authorises
 *      offers — it only re-ranks an already-eligible pool.
 *
 *   3. rankOffers(signal, offers, { llm? })
 *      Computes a heuristic prior on every offer, then (if an LLM
 *      driver was passed) invokes the model THROUGH guardedLLMCall
 *      for a re-rank + reason string. If the LLM path throws
 *      (FirewallError, output schema breach, network failure) the
 *      heuristic ranking is returned unchanged — the user-visible
 *      offer surface degrades gracefully, never empty.
 *
 * All public functions are free functions, no class wrapper, mirroring
 * the rest of `src/modules/*`.
 */

// ───────────────────────────────────────────────────────────────────
// Signal vector
// ───────────────────────────────────────────────────────────────────

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const CATEGORY_FROM_MERCHANT_CAT: Record<string, OfferCategory | null> = {
  TELECOM: 'telecom',
  UTILITY: null,
  GROCERY: 'groceries',
  REMITTANCE: 'remittance',
};

function bucketTxn(merchantCategory: string | null | undefined): keyof WorkerSignal['spend30d'] {
  if (!merchantCategory) return 'other';
  const mapped = CATEGORY_FROM_MERCHANT_CAT[merchantCategory.toUpperCase()];
  if (mapped) return mapped;
  return 'other';
}

/**
 * Build the worker signal vector. Reads the Employee row plus a
 * 30-day transaction window — both bounded queries, no joins outside
 * the row scope.
 */
export async function buildWorkerSignal(employeeId: string): Promise<WorkerSignal> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      plan: true,
      salary: true,
      walletBalance: true,
    },
  });
  if (!employee) throw NotFound('Employee not found');

  const since = new Date(Date.now() - THIRTY_DAYS_MS);
  const recent = await prisma.employeeTransaction.findMany({
    where: {
      employeeId,
      createdAt: { gte: since },
      status: { in: ['COMPLETED', 'PENDING'] },
    },
    select: {
      type: true,
      merchantCategory: true,
      totalAmount: true,
    },
  });

  const spend30d = { telecom: 0, remittance: 0, groceries: 0, other: 0 };
  let billPaymentVolume = 0;
  let hasRemittanceHistory = false;

  for (const t of recent) {
    // We measure outflow — the wallet-statement convention is to
    // record debits as a negative magnitude, so take the absolute
    // value of debits only.
    const magnitude = Math.abs(t.totalAmount);
    if (t.type === 'REMITTANCE') {
      hasRemittanceHistory = true;
      spend30d.remittance += magnitude;
      continue;
    }
    if (t.type === 'BILL_PAYMENT') {
      billPaymentVolume += magnitude;
      const bucket = bucketTxn(t.merchantCategory);
      spend30d[bucket] += magnitude;
      continue;
    }
    if (t.type === 'CARD_PURCHASE') {
      const bucket = bucketTxn(t.merchantCategory);
      spend30d[bucket] += magnitude;
      continue;
    }
  }

  return {
    employeeId: employee.id,
    plan: employee.plan,
    monthlySalary: employee.salary,
    spend30d,
    billPaymentVolume30d: billPaymentVolume,
    walletBalance: employee.walletBalance,
    hasRemittanceHistory,
    snapshotAt: new Date().toISOString(),
  };
}

// ───────────────────────────────────────────────────────────────────
// Eligibility
// ───────────────────────────────────────────────────────────────────

/**
 * Read the active offer pool and filter through the deterministic
 * hard-gates. Returns the eligible-only subset, in DB order — the
 * ranker reorders.
 */
export async function eligibleOffersFor(
  signal: WorkerSignal,
  now: Date = new Date(),
): Promise<Offer[]> {
  const pool = await prisma.offer.findMany({
    where: { isActive: true, expiresAt: { gt: now } },
  });
  return pool.filter((o) => isOfferEligible(o, signal, now));
}

// ───────────────────────────────────────────────────────────────────
// Ranking — heuristic prior + optional LLM re-rank through Tool 11
// ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  'You are FlexPay\'s offer personaliser.',
  'You receive a JSON object: { signal, candidates }.',
  'signal is a PII-free worker feature vector.',
  'candidates is an array of pre-eligible offers, each with offerId, category, merchant, discountPercentage, and a heuristicScore prior.',
  'Re-rank by relevance to the signal.',
  'Output ONLY valid JSON of the shape { "ranked": [{ "offerId": string, "score": 0..100, "reason": string }] }.',
  'reason MUST be a short user-facing sentence with no PII.',
  'Do not invent offerIds. Use only those from candidates.',
].join(' ');

interface RankOptions {
  /** Optional LLM driver. When omitted, heuristic ranking is returned directly. */
  llm?: LlmInvoker;
  /** Truncate the candidate pool before model invocation. Default 25. */
  maxLlmCandidates?: number;
  correlationId?: string;
}

/**
 * Rank a pre-eligible offer pool against a signal vector.
 *
 * Always returns at least the heuristic ranking. If `llm` is passed,
 * we route through Tool 11 (guardedLLMCall) for a re-rank; any
 * firewall / parse failure logs and falls back to the heuristic
 * ranking — the user surface never goes empty because the model is
 * down.
 */
export async function rankOffers(
  signal: WorkerSignal,
  offers: Offer[],
  options: RankOptions = {},
): Promise<PersonalisedOffer[]> {
  if (offers.length === 0) return [];

  const heuristic = offers.map((o) => buildHeuristicRanked(o, signal));

  if (!options.llm) {
    return sortDesc(heuristic);
  }

  const maxCandidates = options.maxLlmCandidates ?? 25;
  const candidatesForLlm = sortDesc(heuristic).slice(0, maxCandidates);
  const byOfferId = new Map(offers.map((o) => [o.id, o] as const));

  // The model input is built JSON-style from PII-free fields only.
  // Passed through guardedLLMCall as the user input so Tool 11's
  // PII strip + injection scan run before any model invocation.
  const userInput = JSON.stringify({
    signal: {
      plan: signal.plan,
      monthlySalaryBand: salaryBand(signal.monthlySalary),
      spend30d: signal.spend30d,
      hasRemittanceHistory: signal.hasRemittanceHistory,
    },
    candidates: candidatesForLlm.map((c) => {
      const offer = byOfferId.get(c.offerId)!;
      return {
        offerId: c.offerId,
        category: c.category,
        merchant: offer.merchant,
        discountPercentage: offer.discountPercentage,
        heuristicScore: c.score,
      };
    }),
  });

  let llmOutput: LlmPersonalisationOutput;
  try {
    llmOutput = await guardedLLMCall<LlmPersonalisationOutput>({
      systemPrompt: SYSTEM_PROMPT,
      userInput,
      llm: options.llm,
      outputSchema: llmPersonalisationOutputSchema,
      correlationId: options.correlationId,
    });
  } catch (err) {
    if (err instanceof FirewallError) {
      logger.warn('offers: prompt firewall rejected — falling back to heuristic ranking', {
        reason: err.reason,
        correlationId: options.correlationId,
      });
    } else {
      logger.warn('offers: LLM rank failed — falling back to heuristic ranking', {
        error: (err as Error).message,
        correlationId: options.correlationId,
      });
    }
    return sortDesc(heuristic);
  }

  // Merge LLM verdict onto the heuristic pool. We discard any
  // offerId the LLM invented (defensive — Tool 11's output-schema
  // gate already constrains the shape but not the membership).
  const llmByOfferId = new Map(llmOutput.ranked.map((r) => [r.offerId, r] as const));
  const merged: PersonalisedOffer[] = heuristic.map((h) => {
    const fromLlm = llmByOfferId.get(h.offerId);
    if (!fromLlm) return h; // LLM omitted this — keep heuristic seat
    return {
      offerId: h.offerId,
      category: h.category,
      score: clampScore(fromLlm.score),
      reason: fromLlm.reason,
    };
  });
  return sortDesc(merged);
}

// ───────────────────────────────────────────────────────────────────
// Public top-level entrypoint
// ───────────────────────────────────────────────────────────────────

/**
 * End-to-end personalised offer feed for one worker. Composes the
 * three pipeline stages so the controller layer can call once.
 */
export async function personalisedOffersFor(
  employeeId: string,
  options: RankOptions = {},
): Promise<PersonalisedOffer[]> {
  const signal = await buildWorkerSignal(employeeId);
  const eligible = await eligibleOffersFor(signal);
  return rankOffers(signal, eligible, options);
}

// ───────────────────────────────────────────────────────────────────
// Internals
// ───────────────────────────────────────────────────────────────────

function buildHeuristicRanked(offer: Offer, signal: WorkerSignal): PersonalisedOffer {
  const category = inferOfferCategory(offer.merchant) ?? 'groceries';
  return {
    offerId: offer.id,
    category,
    score: heuristicScore(offer, category, signal),
    reason: heuristicReason(offer, category, signal),
  };
}

function sortDesc(list: PersonalisedOffer[]): PersonalisedOffer[] {
  return [...list].sort((a, b) => b.score - a.score);
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function salaryBand(salary: number | null): string {
  if (salary == null) return 'unknown';
  if (salary < 4_000) return 'lt_4k';
  if (salary < 8_000) return '4k_8k';
  if (salary < 15_000) return '8k_15k';
  if (salary < 30_000) return '15k_30k';
  return 'gte_30k';
}

// Output schema re-export for callers that want to assert the shape
// at the controller boundary as well. Re-exported as a value so
// downstream code uses one canonical reference, not a duplicate.
export { llmPersonalisationOutputSchema };
export type { z };
