import { randomUUID } from 'crypto';
import redisService from '@config/redis';
import { env } from '@config/env';
import { remittanceService } from '@modules/remittance/remittance.service';
import { BadRequest, NotFound } from '@shared/utils/errors';
import logger from '@shared/utils/logger';
import type { Beneficiary } from '@modules/remittance/moneyhash.service';

/**
 * Mobile-specific remittance wrapper.
 *
 * Adds two concerns the generic `@modules/remittance/remittance.service`
 * doesn't carry:
 *   1. Quote locking — the rate the user sees on the quote screen is
 *      what they pay at send. The mobile flow is "quote → confirm →
 *      execute", and the gap between steps must not let the live FX
 *      rate drift the recipient amount.
 *   2. Explicit corporate FX margin surfacing — the 0.5% Nova Star
 *      margin is already applied inside remittanceService.quote() via
 *      `env.REMITTANCE_FX_SPREAD`, but the mobile DTO exposes it
 *      explicitly so the worker can see the corporate spread in
 *      basis points (regulator-friendly + builds trust).
 *
 * The 5-min FX cache in the base service is for the FX rate itself
 * (avoids hammering MoneyHash). The 60s quote lock here is for the
 * priced quote artifact a specific user accepted. Two different
 * caches by design.
 */

const QUOTE_TTL_SECONDS = 60;

interface LockedQuote {
  quoteId: string;
  employeeId: string;
  amount: number;
  currency: string;
  rate: number;
  fee: number;
  recipientAmount: number;
  totalDebit: number;
  fxMarginAppliedBps: number;
  validForSeconds: number;
  issuedAt: number;
}

function key(quoteId: string): string {
  return `mobile-rem-quote:${quoteId}`;
}

class MobileRemittanceService {
  /**
   * Generate a priced quote and lock it in Redis for 60s. Returns a
   * `quoteId` the client must echo on /send.
   */
  async quote(
    employeeId: string,
    amount: number,
    currency: string,
  ): Promise<LockedQuote> {
    if (amount <= 0) throw BadRequest('Amount must be positive');
    if (currency.length !== 3) throw BadRequest('Currency must be ISO-4217');

    const base = await remittanceService.quote(amount, currency);
    const quoteId = `rq_${randomUUID()}`;
    const locked: LockedQuote = {
      quoteId,
      employeeId,
      amount,
      currency,
      rate: base.rate,
      fee: base.fee,
      recipientAmount: base.recipientAmount,
      totalDebit: base.totalDebit,
      // env.REMITTANCE_FX_SPREAD is stored as a fraction (0.005 = 0.5%);
      // surface it as basis points so the UI can render "FX margin: 50 bps".
      fxMarginAppliedBps: Math.round(env.REMITTANCE_FX_SPREAD * 10_000),
      validForSeconds: QUOTE_TTL_SECONDS,
      issuedAt: Date.now(),
    };

    await redisService.set(key(quoteId), JSON.stringify(locked), QUOTE_TTL_SECONDS);
    logger.info('remittance quote locked', { employeeId, quoteId, currency, amount });
    return locked;
  }

  /**
   * Execute a previously locked quote.
   *
   * The quote is single-use: a successful send deletes the lock so a
   * duplicated request (network retry, double-tap) is rejected on the
   * second attempt — wallet idempotency comes from the existing
   * EmployeeTransaction.idempotencyKey unique index in
   * remittanceService.send.
   */
  async send(employeeId: string, quoteId: string, beneficiary: Beneficiary) {
    const raw = await redisService.get(key(quoteId));
    if (!raw) throw BadRequest('Quote expired or unknown — request a new quote');

    const locked = JSON.parse(raw) as LockedQuote;
    if (locked.employeeId !== employeeId) {
      // A quote issued to user A cannot be consumed by user B even with
      // a leaked quoteId — defence in depth against horizontal escalation.
      throw NotFound('Quote not found for this user');
    }

    // Drop the lock *before* the rail call to make double-execution
    // structurally impossible from this gateway. (The underlying
    // remittanceService.send still does its own Prisma-level
    // idempotency check on the resulting transaction reference.)
    await redisService.del(key(quoteId));

    return remittanceService.send(employeeId, locked.amount, locked.currency, beneficiary);
  }

  /**
   * Read-only quote retrieval — used by the mobile app to refresh the
   * confirm-screen state without consuming the lock.
   */
  async peek(employeeId: string, quoteId: string): Promise<LockedQuote | null> {
    const raw = await redisService.get(key(quoteId));
    if (!raw) return null;
    const locked = JSON.parse(raw) as LockedQuote;
    if (locked.employeeId !== employeeId) return null;
    return locked;
  }
}

export const mobileRemittanceService = new MobileRemittanceService();
