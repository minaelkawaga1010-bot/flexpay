import { Request, Response, Router } from 'express';
import { createHash } from 'crypto';
import { LoanStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { AppError } from '@shared/utils/errors';
import {
  assertWebhookAuthenticated,
  processDeliveryOnce,
  verifyRawBodyHmacRequest,
} from './webhook-security';

/**
 * FlexxPay (EWA rail) status webhook.
 *
 * Mounted on express.raw() so `req.body` is the exact bytes the HMAC
 * was computed over. This endpoint MUTATES loan state (APPROVED /
 * ACTIVE / REPAID / DEFAULTED), so it is gated identically to the
 * NymCard / MoneyHash webhooks:
 *   1. HMAC-SHA256 signature verification (constant-time), fail closed
 *      in every environment; each signed delivery is single-use
 *      (TASK-007)
 *   2. Zod-validated payload (reject malformed / corrupt input)
 *   3. Guarded JSON parse (no unhandled throw on bad bytes)
 *   4. Forward-only status transitions applied with compare-and-set, so
 *      a replayed, stale or out-of-order event can never move a loan
 *      backwards (e.g. REPAID → ACTIVE, or erase a DEFAULTED status)
 */

const STATUS_TO_LOAN: Record<string, LoanStatus> = {
  approved: LoanStatus.APPROVED,
  disbursed: LoanStatus.ACTIVE,
  repaid: LoanStatus.REPAID,
  defaulted: LoanStatus.DEFAULTED,
  rejected: LoanStatus.REJECTED,
};

/** Transitions a FlexxPay event may apply. REPAID and REJECTED are terminal. */
const NEXT_STATUSES: Record<LoanStatus, readonly LoanStatus[]> = {
  [LoanStatus.PENDING]: [LoanStatus.APPROVED, LoanStatus.ACTIVE, LoanStatus.REJECTED],
  [LoanStatus.APPROVED]: [LoanStatus.ACTIVE, LoanStatus.REJECTED],
  [LoanStatus.ACTIVE]: [LoanStatus.REPAID, LoanStatus.DEFAULTED],
  [LoanStatus.DEFAULTED]: [LoanStatus.REPAID],
  [LoanStatus.REPAID]: [],
  [LoanStatus.REJECTED]: [],
};

function reachable(from: LoanStatus, to: LoanStatus): boolean {
  return NEXT_STATUSES[from].some((step) => step === to || reachable(step, to));
}

const statusPayloadSchema = z.object({
  partnerReference: z.string().min(1),
  status: z.enum(['approved', 'disbursed', 'repaid', 'defaulted', 'rejected']),
  disbursedAmount: z.coerce.number().nonnegative().finite().optional(),
  disbursementTxnId: z.string().optional(),
});

/** partnerReference is FlexxPay's redirect URL — log a fingerprint, never the URL. */
const referenceFingerprint = (ref: string) => createHash('sha256').update(ref).digest('hex').slice(0, 16);

export class FlexxPayWebhook {
  public readonly router = Router();

  constructor() {
    this.router.post('/status', asyncHandler(this.handleStatus));
  }

  private handleStatus = async (req: Request, res: Response): Promise<void> => {
    const auth = verifyRawBodyHmacRequest(req, 'flexxpay');
    assertWebhookAuthenticated(auth, 'flexxpay');
    await processDeliveryOnce(
      res,
      'flexxpay',
      { key: auth.deliveryKey, ttlSeconds: auth.deliveryTtlSeconds },
      () => this.processStatus(req, res),
    );
  };

  private async processStatus(req: Request, res: Response): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse((req.body as Buffer).toString('utf8'));
    } catch {
      logger.warn('flexxpay webhook: invalid JSON');
      res.status(400).json({ error: 'INVALID_JSON' });
      return;
    }

    const parsed = statusPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      // Field paths only — never payload values.
      logger.warn('flexxpay webhook: payload validation failed', {
        fields: parsed.error.issues.map((issue) => issue.path.join('.')),
      });
      res.status(400).json({ error: 'INVALID_PAYLOAD' });
      return;
    }
    const { partnerReference, status, disbursedAmount, disbursementTxnId } = parsed.data;

    const loan = await prisma.loan.findFirst({ where: { partnerReference } });
    if (!loan) {
      logger.warn('flexxpay webhook: unknown partnerReference', {
        reference: referenceFingerprint(partnerReference),
      });
      res.status(202).json({ received: true });
      return;
    }

    const next: LoanStatus = STATUS_TO_LOAN[status] ?? loan.status;

    if (next === loan.status) {
      // Re-delivery of an applied event — no write.
      res.status(200).json({ received: true });
      return;
    }
    if (!NEXT_STATUSES[loan.status].includes(next)) {
      const transition = { loanId: loan.id, from: loan.status, to: next };
      if (reachable(loan.status, next)) {
        // Arrived ahead of an event it depends on (e.g. `repaid` before
        // `disbursed`). Not applied; a non-2xx releases the delivery so
        // the provider's retry is processed once the earlier event lands.
        logger.warn('flexxpay webhook: event ahead of loan state — retry expected', transition);
        throw new AppError(409, 'EVENT_OUT_OF_ORDER', 'Loan is not yet in a state this event applies to');
      }
      logger.warn('flexxpay webhook: stale or invalid transition ignored', transition);
      res.status(200).json({ received: true, ignored: 'STALE_OR_INVALID_TRANSITION' });
      return;
    }

    // Compare-and-set on the status read above: a concurrent delivery
    // that already moved the loan makes this a 409 the provider retries.
    const { count } = await prisma.loan.updateMany({
      where: { id: loan.id, status: loan.status },
      data: {
        status: next,
        disbursedAmount: disbursedAmount ?? loan.disbursedAmount,
        disbursedAt: disbursedAmount !== undefined ? new Date() : loan.disbursedAt,
        disbursementTxnId: disbursementTxnId ?? loan.disbursementTxnId,
      },
    });
    if (count === 0) {
      throw new AppError(409, 'CONCURRENT_UPDATE', 'Loan status changed while processing');
    }
    res.status(200).json({ received: true });
  }
}

export const flexxpayWebhook = new FlexxPayWebhook();
