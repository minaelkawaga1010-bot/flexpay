import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { BillPaymentStatus } from '@prisma/client';
import { env } from '@config/env';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { Unauthorized } from '@shared/utils/errors';
import { refundFailedBill, settleBillPayment } from '@modules/bill-payment/bill-payment.service';

/**
 * Biller webhook — inbound rail confirmation for bill payments.
 *
 * Lifecycle implemented:
 *
 *   PENDING → COMPLETED   on bill.completed   (status update + tied
 *                                              wallet txn COMPLETED)
 *   PENDING → FAILED      on bill.failed      (append-only refund +
 *                                              wallet credit-back)
 *   Any terminal state    on replay           → no-op (idempotent)
 *
 * Security:
 *   • Strict HMAC-SHA256 over the raw body using
 *     env.BILLER_WEBHOOK_SECRET. In non-prod with secret unset, we
 *     passthrough so CI and local tooling can hit the route. In
 *     production with secret unset the gate refuses (deploy error).
 *
 * Idempotency:
 *   • Lookup is keyed off external_ref (the rail-side reference set
 *     at adapter dispatch). A duplicate webhook for a row already in
 *     a terminal state short-circuits before any DB write.
 *   • The append-only refund row uses idempotencyKey
 *     `bill:refund:<bill-idempotency-key>` — the SQL unique
 *     constraint is the second line of defence.
 *
 * Unknown external_ref returns 202 (rail-side error or race —
 * acknowledge so the rail stops retrying; surface for ops).
 */

// ───────────────────────────────────────────────────────────────────
// Schemas
// ───────────────────────────────────────────────────────────────────

const eventTypeValues = ['bill.completed', 'bill.failed', 'bill.reversed'] as const;

const webhookPayloadSchema = z.union([
  z.object({
    type: z.enum(eventTypeValues),
    data: z.object({
      externalRef: z.string().min(1),
      failureReason: z.string().optional(),
      providerReference: z.string().optional(),
      timestamp: z.string().optional(),
    }),
  }),
  z.object({
    externalRef: z.string().min(1),
    status: z.enum(['completed', 'failed', 'reversed']),
    failureReason: z.string().optional(),
    providerReference: z.string().optional(),
  }),
]);

type BillerEvent = {
  externalRef: string;
  status: 'completed' | 'failed' | 'reversed';
  failureReason?: string;
  providerReference?: string;
};

function normaliseEvent(raw: z.infer<typeof webhookPayloadSchema>): BillerEvent {
  if ('type' in raw) {
    const status = raw.type.replace(/^bill\./, '') as BillerEvent['status'];
    return {
      externalRef: raw.data.externalRef,
      status,
      failureReason: raw.data.failureReason,
      providerReference: raw.data.providerReference,
    };
  }
  return {
    externalRef: raw.externalRef,
    status: raw.status,
    failureReason: raw.failureReason,
    providerReference: raw.providerReference,
  };
}

// ───────────────────────────────────────────────────────────────────
// Signature
// ───────────────────────────────────────────────────────────────────

function verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!env.BILLER_WEBHOOK_SECRET) return env.NODE_ENV !== 'production';
  if (!signature) return false;

  const expected = crypto
    .createHmac('sha256', env.BILLER_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// ───────────────────────────────────────────────────────────────────
// Handler
// ───────────────────────────────────────────────────────────────────

export class BillerWebhook {
  public readonly router = Router();

  constructor() {
    this.router.post('/status', asyncHandler(this.handleStatus));
  }

  private handleStatus = async (req: Request, res: Response): Promise<void> => {
    const ok = verifySignature(req.body as Buffer, req.header('x-biller-signature') ?? undefined);
    if (!ok) throw Unauthorized('INVALID_SIGNATURE');

    let raw: unknown;
    try {
      raw = JSON.parse((req.body as Buffer).toString('utf8'));
    } catch (err) {
      logger.warn('biller webhook: invalid JSON', { error: (err as Error).message });
      res.status(400).json({ error: 'INVALID_JSON' });
      return;
    }

    const parseResult = webhookPayloadSchema.safeParse(raw);
    if (!parseResult.success) {
      logger.warn('biller webhook: payload validation failed', {
        issues: parseResult.error.flatten(),
      });
      res.status(400).json({ error: 'INVALID_PAYLOAD', details: parseResult.error.flatten() });
      return;
    }

    const event = normaliseEvent(parseResult.data);

    const bill = await prisma.billPayment.findFirst({
      where: { externalRef: event.externalRef },
    });
    if (!bill) {
      // Unknown ref — ACK so the rail stops retrying; surface for ops.
      logger.warn('biller webhook: unknown externalRef', { externalRef: event.externalRef });
      res.status(202).json({ received: true });
      return;
    }

    switch (event.status) {
      case 'completed':
        await settleBillPayment(bill, event.externalRef);
        break;
      case 'failed':
      case 'reversed':
        await refundFailedBill(
          bill,
          event.failureReason ?? `rail_reported_${event.status}`,
          event.externalRef,
        );
        break;
    }

    // After a terminal-status transition, the next replay finds the
    // row in a terminal state and the service-layer guard short-
    // circuits — we never write twice for the same event.
    if (bill.status === BillPaymentStatus.COMPLETED ||
        bill.status === BillPaymentStatus.FAILED ||
        bill.status === BillPaymentStatus.REVERSED) {
      logger.info('biller webhook: replay on terminal row (no-op)', {
        billPaymentId: bill.id,
        currentStatus: bill.status,
      });
    }

    res.status(200).json({ received: true });
  };
}

export const billerWebhook = new BillerWebhook();
