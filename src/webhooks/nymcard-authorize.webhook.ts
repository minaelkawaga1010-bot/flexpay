import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { prisma } from '@config/prisma';
import { env } from '@config/env';
import redisService from '@config/redis';
import logger from '@shared/utils/logger';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { nymcardService } from '@modules/cards/nymcard.service';
import {
  FRAUD_DECLINE_THRESHOLD,
  getFraudScorer,
  type FraudSignals,
} from '@modules/cards/fraud-scorer.service';

/**
 * NymCard synchronous authorization webhook — Bible §4.1. Closes A.8.
 *
 * NymCard calls FlexPay inside Visa's 90ms authorization window. We
 * must return { decision: "APPROVE" | "DECLINE" } fast — Bible target
 * p95 < 35ms, p99 < 50ms. The pipeline is:
 *
 *   1. HMAC-SHA256 signature verify (constant-time)
 *   2. LightGBM/heuristic fraud score (<12ms target)
 *   3. Balance check (Redis 30s cache → NymCard API on miss)
 *   4. Decision
 *
 * Hard budget: a `AUTH_BUDGET_MS` deadline guards the whole pipeline.
 * If we can't decide in time we FAIL SAFE by declining — a late
 * APPROVE is worse than a clean DECLINE because Visa will have already
 * timed out and the issuer stand-in may have approved anyway, but a
 * FlexPay late-APPROVE that races a stand-in DECLINE creates a
 * phantom hold. Declining on timeout keeps us consistent.
 *
 * This endpoint is mounted on the raw-body parser like the other
 * webhooks so the HMAC is computed over the exact received bytes.
 */

const AUTH_BUDGET_MS = 50; // total pipeline deadline (Bible p99 target)

const authPayloadSchema = z.object({
  card_id: z.string().min(1),
  amount: z.coerce.number().positive().finite(),
  currency: z.string().length(3).optional(),
  merchant_mcc: z.string().min(1),
  merchant_country: z.string().min(2).max(3),
  device_fingerprint: z.string().optional(),
  geo_lat: z.coerce.number().optional(),
  geo_lng: z.coerce.number().optional(),
});

type AuthDecision = { decision: 'APPROVE' } | { decision: 'DECLINE'; reason: string };

/** Redis key + TTL per Bible §1.5: nymcard_balance:{card_id} 30s. */
const balanceKey = (cardId: string) => `nymcard_balance:${cardId}`;
const BALANCE_TTL_SECONDS = 30;
/** Velocity tracking key — rolling 60s window of card auth events. */
const velocityKey = (cardId: string) => `card_velocity:${cardId}`;
const VELOCITY_WINDOW_SECONDS = 60;

export class NymCardAuthorizeWebhook {
  public readonly router = Router();

  constructor() {
    this.router.post('/authorize', asyncHandler(this.handleAuthorize));
  }

  private handleAuthorize = async (req: Request, res: Response): Promise<void> => {
    const startedAt = Date.now();

    // 1. Signature. Reuses the same HMAC verifier as the settlement
    //    webhook. A bad signature is a hard 401 — never score it.
    const sig = req.header(env.WEBHOOK_SIGNATURE_HEADER) ?? undefined;
    if (!nymcardService.verifyWebhookSignature(req.body as Buffer, sig)) {
      res.status(401).json({ error: 'invalid_signature' });
      return;
    }

    let parsed: z.infer<typeof authPayloadSchema>;
    try {
      parsed = authPayloadSchema.parse(JSON.parse((req.body as Buffer).toString('utf8')));
    } catch {
      // Malformed auth payload → decline (fail safe).
      res.status(200).json({ decision: 'DECLINE', reason: 'MALFORMED_REQUEST' });
      return;
    }

    const decision = await this.decide(parsed, startedAt);

    // Record the auth in the velocity window regardless of decision —
    // an attacker testing cards generates velocity even on declines.
    void this.recordVelocity(parsed.card_id, parsed.amount);

    const elapsedMs = Date.now() - startedAt;
    logger.info('nymcard authorize decided', {
      cardId: parsed.card_id,
      decision: decision.decision,
      reason: 'reason' in decision ? decision.reason : undefined,
      elapsedMs,
      withinBudget: elapsedMs <= AUTH_BUDGET_MS,
    });

    res.status(200).json(decision);
  };

  /**
   * Core decision pipeline. Wrapped in a budget race so a slow
   * downstream (Redis miss → NymCard API) can't blow the Visa window:
   * if the deadline elapses we DECLINE (fail safe).
   */
  private async decide(
    p: z.infer<typeof authPayloadSchema>,
    startedAt: number,
  ): Promise<AuthDecision> {
    const deadline = new Promise<AuthDecision>((resolve) => {
      const remaining = AUTH_BUDGET_MS - (Date.now() - startedAt);
      setTimeout(
        () => resolve({ decision: 'DECLINE', reason: 'AUTH_TIMEOUT' }),
        Math.max(0, remaining),
      );
    });
    return Promise.race([this.runPipeline(p), deadline]);
  }

  private async runPipeline(p: z.infer<typeof authPayloadSchema>): Promise<AuthDecision> {
    // 2. Fraud score. Heuristic in-process by default (<1ms), LightGBM
    //    when bound. Pull the velocity window first (single Redis read).
    const velocity = await this.readVelocity(p.card_id);
    const signals: FraudSignals = {
      cardId: p.card_id,
      amount: p.amount,
      merchantMcc: p.merchant_mcc,
      merchantCountry: p.merchant_country,
      deviceFingerprint: p.device_fingerprint,
      geoLat: p.geo_lat,
      geoLng: p.geo_lng,
      recentTxCount60s: velocity.count,
      recentTxAmount60s: velocity.amount,
      homeCountry: 'AE',
    };
    const fraudScore = await getFraudScorer().score(signals);
    if (fraudScore > FRAUD_DECLINE_THRESHOLD) {
      return { decision: 'DECLINE', reason: 'FRAUD_RISK' };
    }

    // 3. Balance check. Redis 30s cache → NymCard API on miss.
    const balance = await this.getBalance(p.card_id);
    if (balance === null) {
      // Could not resolve a balance in time/at all → fail safe.
      return { decision: 'DECLINE', reason: 'BALANCE_UNAVAILABLE' };
    }
    if (balance < p.amount) {
      return { decision: 'DECLINE', reason: 'INSUFFICIENT_FUNDS' };
    }

    return { decision: 'APPROVE' };
  }

  // ── Balance: Redis cache → NymCard API fallback ──────────────────

  private async getBalance(cardId: string): Promise<number | null> {
    try {
      const cached = await redisService.get(balanceKey(cardId));
      if (cached !== null && cached !== undefined) {
        const n = Number(cached);
        if (Number.isFinite(n)) return n;
      }
    } catch (err) {
      logger.warn('nymcard authorize: balance cache read failed', {
        cardId,
        error: (err as Error).message,
      });
    }

    // Cache miss → resolve the wallet balance from our own ledger view.
    // (The Bible fetches NymCard's API; we hold the authoritative wallet
    // balance locally, so we read it directly and warm the cache.)
    try {
      const card = await prisma.card.findUnique({
        where: { cardId },
        select: { employee: { select: { walletBalance: true } } },
      });
      if (!card?.employee) return null;
      const balance = card.employee.walletBalance;
      void redisService.set(balanceKey(cardId), String(balance), BALANCE_TTL_SECONDS);
      return balance;
    } catch (err) {
      logger.error('nymcard authorize: balance resolve failed', {
        cardId,
        error: (err as Error).message,
      });
      return null;
    }
  }

  // ── Velocity window (rolling 60s) ────────────────────────────────

  private async readVelocity(cardId: string): Promise<{ count: number; amount: number }> {
    try {
      const raw = await redisService.get(velocityKey(cardId));
      if (!raw) return { count: 0, amount: 0 };
      const parsed = JSON.parse(raw) as { count: number; amount: number };
      return { count: parsed.count ?? 0, amount: parsed.amount ?? 0 };
    } catch {
      return { count: 0, amount: 0 };
    }
  }

  private async recordVelocity(cardId: string, amount: number): Promise<void> {
    try {
      const current = await this.readVelocity(cardId);
      const next = { count: current.count + 1, amount: current.amount + amount };
      // setex resets the 60s window on each write — a continuous burst
      // keeps the window alive; a quiet card decays to zero.
      await redisService.set(velocityKey(cardId), JSON.stringify(next), VELOCITY_WINDOW_SECONDS);
    } catch (err) {
      logger.warn('nymcard authorize: velocity record failed', {
        cardId,
        error: (err as Error).message,
      });
    }
  }
}

export const nymCardAuthorizeWebhook = new NymCardAuthorizeWebhook();
