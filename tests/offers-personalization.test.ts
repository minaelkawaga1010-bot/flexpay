/**
 * AI Offers Personalisation — service tests.
 *
 * Three concerns:
 *   1. offer-eligibility — pure hard-gate functions (plan, salary,
 *      expiry, active flag).
 *   2. heuristic ranker — deterministic prior on (signal, offer).
 *   3. personalisation.service — buildWorkerSignal, eligibleOffersFor,
 *      rankOffers (including the LLM path through Tool 11's
 *      guardedLLMCall and the heuristic fallback on firewall failure).
 *
 * The Tool 11 firewall plug-ins are bound to in-test stubs via
 * setPromptFirewall so we exercise the full guard chain — PII strip
 * runs, injection classifier runs, output schema is parsed — without
 * spinning up Presidio or a real DistilBERT endpoint.
 */

jest.mock('@config/prisma', () => ({
  prisma: {
    employee: { findUnique: jest.fn() },
    employeeTransaction: { findMany: jest.fn() },
    offer: { findMany: jest.fn() },
  },
}));

import { BillerType, PlanType } from '@prisma/client';
import { prisma } from '@config/prisma';
import {
  buildWorkerSignal,
  eligibleOffersFor,
  personalisedOffersFor,
  rankOffers,
} from '../src/modules/offers/personalization.service';
import {
  heuristicReason,
  heuristicScore,
  isOfferEligible,
  planSatisfies,
} from '../src/modules/offers/offer-eligibility';
import {
  inferOfferCategory,
  type WorkerSignal,
} from '../src/modules/offers/offers.types';
import {
  setPromptFirewall,
  type LlmInvoker,
} from '../src/shared/security/prompt-firewall';

const mocked = prisma as unknown as {
  employee: { findUnique: jest.Mock };
  employeeTransaction: { findMany: jest.Mock };
  offer: { findMany: jest.Mock };
};

// Bind permissive firewall stubs for tests that exercise the LLM
// path. Specific tests rebind to exercise the injection / output-
// schema branches.
const passingStripper = {
  async anonymize(text: string) {
    return { text, detectedEntityCount: 0 };
  },
};
const passingClassifier = { async score() { return 0; } };

beforeEach(() => {
  jest.clearAllMocks();
  setPromptFirewall({
    piiStripper: passingStripper,
    injectionClassifier: passingClassifier,
  });
});

function baseSignal(over: Partial<WorkerSignal> = {}): WorkerSignal {
  return {
    employeeId: 'emp-1',
    plan: PlanType.BASIC,
    monthlySalary: 5000,
    spend30d: { telecom: 0, remittance: 0, groceries: 0, other: 0 },
    billPaymentVolume30d: 0,
    walletBalance: 1000,
    hasRemittanceHistory: false,
    snapshotAt: new Date().toISOString(),
    ...over,
  };
}

function baseOffer(over: Record<string, unknown> = {}) {
  return {
    id: 'off-1',
    title: 'x',
    description: null,
    discountPercentage: 20,
    merchant: 'Carrefour',
    affiliateLink: 'https://x.test',
    imageUrl: null,
    terms: null,
    planRequired: null,
    minSalary: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    isActive: true,
    clicks: 0,
    conversions: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as any;
}

// ═══════════════════════════════════════════════════════════════════
// inferOfferCategory + planSatisfies
// ═══════════════════════════════════════════════════════════════════

describe('inferOfferCategory', () => {
  it('classifies known telecom merchants', () => {
    expect(inferOfferCategory('Etisalat')).toBe('telecom');
    expect(inferOfferCategory('du')).toBe('telecom');
  });
  it('classifies known remittance merchants', () => {
    expect(inferOfferCategory('Lulu Exchange')).toBe('remittance');
  });
  it('classifies known grocery merchants', () => {
    expect(inferOfferCategory('Carrefour')).toBe('groceries');
  });
  it('returns null for unknown merchants', () => {
    expect(inferOfferCategory('Unknown Brand')).toBeNull();
  });
});

describe('planSatisfies', () => {
  it('LUXURY satisfies BASIC and LUXURY', () => {
    expect(planSatisfies(PlanType.LUXURY, PlanType.BASIC)).toBe(true);
    expect(planSatisfies(PlanType.LUXURY, PlanType.LUXURY)).toBe(true);
  });
  it('BASIC does not satisfy LUXURY', () => {
    expect(planSatisfies(PlanType.BASIC, PlanType.LUXURY)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Eligibility hard-gates
// ═══════════════════════════════════════════════════════════════════

describe('isOfferEligible', () => {
  it('rejects an inactive offer', () => {
    expect(
      isOfferEligible(baseOffer({ isActive: false }), baseSignal()),
    ).toBe(false);
  });
  it('rejects an expired offer', () => {
    expect(
      isOfferEligible(
        baseOffer({ expiresAt: new Date(Date.now() - 60_000) }),
        baseSignal(),
      ),
    ).toBe(false);
  });
  it('rejects when plan does not meet planRequired', () => {
    expect(
      isOfferEligible(
        baseOffer({ planRequired: PlanType.LUXURY }),
        baseSignal({ plan: PlanType.BASIC }),
      ),
    ).toBe(false);
  });
  it('rejects when salary unknown but minSalary set (under-surface beats over-surface)', () => {
    expect(
      isOfferEligible(
        baseOffer({ minSalary: 4000 }),
        baseSignal({ monthlySalary: null }),
      ),
    ).toBe(false);
  });
  it('accepts when every gate passes', () => {
    expect(isOfferEligible(baseOffer(), baseSignal())).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Heuristic ranker
// ═══════════════════════════════════════════════════════════════════

describe('heuristicScore', () => {
  it('lifts the score when category matches the worker\'s dominant spend bucket', () => {
    const sig = baseSignal({
      spend30d: { telecom: 800, remittance: 0, groceries: 200, other: 0 },
    });
    const telecom = heuristicScore(baseOffer({ merchant: 'Etisalat' }), 'telecom', sig);
    const grocery = heuristicScore(baseOffer({ merchant: 'Carrefour' }), 'groceries', sig);
    expect(telecom).toBeGreaterThan(grocery);
  });

  it('adds the remittance kicker when the worker has remittance history', () => {
    const sig = baseSignal({ hasRemittanceHistory: true });
    const remit = heuristicScore(baseOffer({ merchant: 'Lulu Exchange' }), 'remittance', sig);
    const noKicker = heuristicScore(baseOffer({ merchant: 'Lulu Exchange' }), 'remittance', baseSignal());
    expect(remit).toBeGreaterThan(noKicker);
  });

  it('caps at 100 for an extreme combination', () => {
    const sig = baseSignal({
      spend30d: { telecom: 0, remittance: 10_000, groceries: 0, other: 0 },
      hasRemittanceHistory: true,
    });
    const s = heuristicScore(baseOffer({ discountPercentage: 75 }), 'remittance', sig);
    expect(s).toBeLessThanOrEqual(100);
  });

  it('returns a sensible reason string', () => {
    const sig = baseSignal({
      spend30d: { telecom: 500, remittance: 0, groceries: 0, other: 0 },
    });
    const r = heuristicReason(baseOffer({ merchant: 'Etisalat', discountPercentage: 15 }), 'telecom', sig);
    expect(r).toMatch(/15% off/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// buildWorkerSignal
// ═══════════════════════════════════════════════════════════════════

describe('buildWorkerSignal', () => {
  it('reads salary + plan + buckets 30-day spend by merchant category', async () => {
    mocked.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      plan: PlanType.LUXURY,
      salary: 12_000,
      walletBalance: 800,
    });
    mocked.employeeTransaction.findMany.mockResolvedValue([
      // Bill-payment to a telecom — counted as telecom spend AND in
      // the bill-payment volume aggregate.
      { type: 'BILL_PAYMENT', merchantCategory: 'TELECOM', totalAmount: -150 },
      // Card purchase at a grocery.
      { type: 'CARD_PURCHASE', merchantCategory: 'GROCERY', totalAmount: -240 },
      // Remittance — moves into remittance bucket AND flips the flag.
      { type: 'REMITTANCE', merchantCategory: null, totalAmount: -500 },
      // Refund — type-filtered out of the spend buckets.
      { type: 'REFUND', merchantCategory: null, totalAmount: 50 },
    ]);

    const sig = await buildWorkerSignal('emp-1');
    expect(sig.plan).toBe(PlanType.LUXURY);
    expect(sig.monthlySalary).toBe(12_000);
    expect(sig.spend30d.telecom).toBe(150);
    expect(sig.spend30d.groceries).toBe(240);
    expect(sig.spend30d.remittance).toBe(500);
    expect(sig.spend30d.other).toBe(0);
    expect(sig.billPaymentVolume30d).toBe(150);
    expect(sig.hasRemittanceHistory).toBe(true);
  });

  it('throws 404 when the employee row is missing', async () => {
    mocked.employee.findUnique.mockResolvedValue(null);
    await expect(buildWorkerSignal('missing')).rejects.toMatchObject({ status: 404 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// eligibleOffersFor — pool filter
// ═══════════════════════════════════════════════════════════════════

describe('eligibleOffersFor', () => {
  it('passes the eligible subset through the hard-gates', async () => {
    mocked.offer.findMany.mockResolvedValue([
      baseOffer({ id: 'a', merchant: 'Etisalat' }),
      baseOffer({ id: 'b', merchant: 'LUXURY only', planRequired: PlanType.LUXURY }),
    ]);
    const out = await eligibleOffersFor(baseSignal({ plan: PlanType.BASIC }));
    expect(out.map((o) => o.id)).toEqual(['a']);
  });
});

// ═══════════════════════════════════════════════════════════════════
// rankOffers — heuristic-only path
// ═══════════════════════════════════════════════════════════════════

describe('rankOffers — heuristic-only', () => {
  it('returns the heuristic ranking sorted desc when no LLM is supplied', async () => {
    const sig = baseSignal({
      spend30d: { telecom: 800, remittance: 0, groceries: 100, other: 0 },
    });
    const offers = [
      baseOffer({ id: 'o1', merchant: 'Carrefour', discountPercentage: 5 }),
      baseOffer({ id: 'o2', merchant: 'Etisalat', discountPercentage: 25 }),
    ];
    const ranked = await rankOffers(sig, offers);
    expect(ranked[0].offerId).toBe('o2'); // telecom + bigger discount + dominant spend
    expect(ranked.length).toBe(2);
  });

  it('returns [] for an empty pool', async () => {
    const ranked = await rankOffers(baseSignal(), []);
    expect(ranked).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// rankOffers — LLM path through Tool 11
// ═══════════════════════════════════════════════════════════════════

describe('rankOffers — LLM path via guardedLLMCall', () => {
  function makeLlm(output: unknown): { llm: LlmInvoker; invoke: jest.Mock } {
    const invoke = jest.fn().mockResolvedValue(JSON.stringify(output));
    return { llm: { invoke }, invoke };
  }

  it('routes through the firewall and merges the LLM verdict over the heuristic', async () => {
    const sig = baseSignal();
    const offers = [
      baseOffer({ id: 'o1', merchant: 'Etisalat', discountPercentage: 10 }),
      baseOffer({ id: 'o2', merchant: 'Carrefour', discountPercentage: 10 }),
    ];

    const { llm, invoke } = makeLlm({
      ranked: [
        { offerId: 'o2', score: 95, reason: 'Top groceries pick this month.' },
        { offerId: 'o1', score: 40, reason: 'Telecom — minor relevance.' },
      ],
    });

    const out = await rankOffers(sig, offers, { llm });

    expect(invoke).toHaveBeenCalledTimes(1);
    // System prompt + sanitized input shape — Tool 11 routed the call.
    const passed = invoke.mock.calls[0][0];
    expect(passed.systemPrompt).toMatch(/personaliser/i);
    expect(passed.sanitizedUserInput).toMatch(/candidates/);
    // LLM verdict applied — o2 first, with the LLM-authored reason.
    expect(out[0].offerId).toBe('o2');
    expect(out[0].reason).toMatch(/Top groceries/);
  });

  it('falls back to heuristic ranking if the firewall rejects the input', async () => {
    setPromptFirewall({
      piiStripper: passingStripper,
      // Score 0.99 > 0.85 threshold → PROMPT_INJECTION_DETECTED
      injectionClassifier: { async score() { return 0.99; } },
    });
    const offers = [
      baseOffer({ id: 'o1', merchant: 'Etisalat', discountPercentage: 10 }),
    ];
    const { llm, invoke } = makeLlm({ ranked: [] });
    const out = await rankOffers(baseSignal(), offers, { llm });

    // The LLM was never reached — the firewall rejected first.
    expect(invoke).not.toHaveBeenCalled();
    // But we still returned the heuristic ranking, not [].
    expect(out.length).toBe(1);
    expect(out[0].offerId).toBe('o1');
  });

  it('falls back to heuristic ranking if the LLM emits an output that fails the schema', async () => {
    const invoke = jest.fn().mockResolvedValue('{"ranked": [{"offerId": 123}]}'); // wrong shape
    const out = await rankOffers(
      baseSignal(),
      [baseOffer({ id: 'o1', merchant: 'Etisalat' })],
      { llm: { invoke } },
    );
    expect(invoke).toHaveBeenCalled();
    expect(out.length).toBe(1);
    expect(out[0].offerId).toBe('o1');
  });

  it('discards LLM-invented offerIds — only candidates from the pool survive', async () => {
    const offers = [baseOffer({ id: 'real-1', merchant: 'Etisalat' })];
    const { llm } = makeLlm({
      ranked: [
        { offerId: 'phantom', score: 100, reason: 'made-up' },
        { offerId: 'real-1', score: 80, reason: 'authentic' },
      ],
    });
    const out = await rankOffers(baseSignal(), offers, { llm });
    expect(out.map((r) => r.offerId)).toEqual(['real-1']);
    expect(out[0].reason).toBe('authentic');
  });
});

// ═══════════════════════════════════════════════════════════════════
// personalisedOffersFor — end-to-end composition
// ═══════════════════════════════════════════════════════════════════

describe('personalisedOffersFor', () => {
  it('composes signal → eligibility → ranking and returns a list', async () => {
    mocked.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      plan: PlanType.BASIC,
      salary: 6000,
      walletBalance: 500,
    });
    mocked.employeeTransaction.findMany.mockResolvedValue([
      { type: 'CARD_PURCHASE', merchantCategory: 'GROCERY', totalAmount: -300 },
    ]);
    mocked.offer.findMany.mockResolvedValue([
      baseOffer({ id: 'o1', merchant: 'Carrefour', discountPercentage: 12 }),
    ]);

    const out = await personalisedOffersFor('emp-1');
    expect(out.length).toBe(1);
    expect(out[0].offerId).toBe('o1');
    expect(out[0].category).toBe('groceries');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Constants sanity (keeps BillerType import alive for tooling)
// ═══════════════════════════════════════════════════════════════════

describe('BillerType reference (sanity)', () => {
  it('is enumerable', () => {
    expect(Object.values(BillerType).length).toBeGreaterThan(0);
  });
});
