import { Request, Response, Router } from 'express';
import crypto from 'crypto';
import { LoanStatus } from '@prisma/client';
import { z } from 'zod';
import { env } from '@config/env';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { Unauthorized } from '@shared/utils/errors';

/**
 * FlexxPay (EWA rail) status webhook.
 *
 * Mounted on express.raw() so `req.body` is the exact bytes the HMAC
 * was computed over. This endpoint MUTATES loan state (APPROVED /
 * ACTIVE / REPAID / DEFAULTED), so it is gated identically to the
 * NymCard / MoneyHash webhooks:
 *   1. HMAC-SHA256 signature verification (constant-time)
 *   2. Zod-validated payload (reject malformed / corrupt input)
 *   3. Guarded JSON parse (no unhandled throw on bad bytes)
 */

const STATUS_TO_LOAN: Record<string, LoanStatus> = {
  approved: LoanStatus.APPROVED,
  disbursed: LoanStatus.ACTIVE,
  repaid: LoanStatus.REPAID,
  defaulted: LoanStatus.DEFAULTED,
  rejected: LoanStatus.REJECTED,
};

const statusPayloadSchema = z.object({
  partnerReference: z.string().min(1),
  status: z.enum(['approved', 'disbursed', 'repaid', 'defaulted', 'rejected']),
  disbursedAmount: z.coerce.number().nonnegative().finite().optional(),
  disbursementTxnId: z.string().optional(),
});

function verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
  // Production MUST have the secret; absent secret outside production
  // passes through so local tooling / CI can exercise the route.
  if (!env.FLEXXPAY_WEBHOOK_SECRET) return env.NODE_ENV !== 'production';
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', env.FLEXXPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export class FlexxPayWebhook {
  public readonly router = Router();

  constructor() {
    this.router.post('/status', asyncHandler(this.handleStatus));
  }

  private handleStatus = async (req: Request, res: Response): Promise<void> => {
    if (!verifySignature(req.body as Buffer, req.header('x-flexxpay-signature') ?? undefined)) {
      throw Unauthorized('INVALID_SIGNATURE');
    }

    let raw: unknown;
    try {
      raw = JSON.parse((req.body as Buffer).toString('utf8'));
    } catch (err) {
      logger.warn('flexxpay webhook: invalid JSON', { error: (err as Error).message });
      res.status(400).json({ error: 'INVALID_JSON' });
      return;
    }

    const parsed = statusPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn('flexxpay webhook: payload validation failed', {
        issues: parsed.error.flatten(),
      });
      res.status(400).json({ error: 'INVALID_PAYLOAD' });
      return;
    }
    const { partnerReference, status, disbursedAmount, disbursementTxnId } = parsed.data;

    const loan = await prisma.loan.findFirst({ where: { partnerReference } });
    if (!loan) {
      logger.warn('flexxpay webhook: unknown partnerReference', { partnerReference });
      res.status(202).json({ received: true });
      return;
    }

    const next: LoanStatus = STATUS_TO_LOAN[status] ?? loan.status;

    await prisma.loan.update({
      where: { id: loan.id },
      data: {
        status: next,
        disbursedAmount: disbursedAmount ?? loan.disbursedAmount,
        disbursedAt: disbursedAmount !== undefined ? new Date() : loan.disbursedAt,
        disbursementTxnId: disbursementTxnId ?? loan.disbursementTxnId,
      },
    });
    res.status(200).json({ received: true });
  };
}

export const flexxpayWebhook = new FlexxPayWebhook();
