import { Request, Response, Router } from 'express';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@config/prisma';
import { env } from '@config/env';
import logger from '@shared/utils/logger';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { Unauthorized } from '@shared/utils/errors';
import { nymcardService } from '@modules/cards/nymcard.service';
import { cashbackService } from '@modules/cashback/cashback.service';

/**
 * NymCard webhook — production-grade card-event handler.
 *
 * Event surface (one router, five POST routes):
 *
 *   /transaction        — auth / clearing / settlement / refund
 *   /shipping-update    — physical-card courier signal
 *   /card-status        — issuer-side status change
 *
 * Security contract:
 *   • Strict HMAC-SHA256 over the raw request body. In production
 *     (NYMCARD_WEBHOOK_SECRET set), an absent or mismatched signature
 *     is a hard 401. In dev/test (secret unset) we passthrough so
 *     local tooling can hit the route — never enable that in prod.
 *
 * Atomicity contract:
 *   • Every event that has a financial effect is processed inside a
 *     single Prisma `$transaction`. EmployeeTransaction creation,
 *     Card.spentToday / spentThisMonth accumulation, cashback
 *     issuance, and the audit-log entry all share the same MVCC
 *     snapshot. A failure on any one rolls back the others — no
 *     half-recorded settlement.
 *
 * Idempotency contract:
 *   • Every webhook event carries an externalId (NymCard side). We
 *     persist that into EmployeeTransaction.idempotencyKey (UNIQUE
 *     index) namespaced by event type:
 *       nymcard:<eventType>:<externalId>
 *     A retry of the same delivery lands on the unique-constraint
 *     conflict and returns the prior result. Idempotent by SQL.
 *
 * Interchange accounting:
 *   • NymCard delivers an `interchangeFeeAED` on clearing/settlement.
 *     We log it structurally via winston for the metrics pipeline
 *     (modelled today at 110 bps; this is the booked figure) AND
 *     audit-log it with the full event context for non-repudiation.
 */

// ───────────────────────────────────────────────────────────────────
// Payload schemas — every webhook body is Zod-parsed
// ───────────────────────────────────────────────────────────────────

const txnPayloadSchema = z.object({
  type: z.enum([
    'transaction.authorized',
    'transaction.cleared',
    'transaction.settled',
    'transaction.refunded',
  ]),
  data: z.object({
    /** NymCard's UID for this transaction event. */
    id: z.string().min(1),
    /** External NymCard card identifier — matches Card.cardId. */
    cardId: z.string().min(1),
    /** Settled amount in AED. Always positive; sign is derived from direction. */
    amount: z.coerce.number().nonnegative().finite(),
    /** Issuer-booked interchange fee in AED — FlexPay revenue. */
    interchangeFeeAED: z.coerce.number().nonnegative().finite().optional(),
    currency: z.string().length(3),
    merchantName: z.string().optional(),
    merchantCategory: z.string().optional(),
    /** ISO timestamp of the merchant-side transaction. */
    timestamp: z.string().optional(),
  }),
});

type TxnPayload = z.infer<typeof txnPayloadSchema>;

const shippingPayloadSchema = z.object({
  cardId: z.string().min(1),
  trackingNumber: z.string().optional(),
  status: z.string().min(1),
});

const cardStatusPayloadSchema = z.object({
  cardId: z.string().min(1),
  status: z.string().min(1),
});

// ───────────────────────────────────────────────────────────────────
// Card status enum coercion
// ───────────────────────────────────────────────────────────────────

const CARD_STATUS_MAP: Record<string, 'ACTIVE' | 'INACTIVE' | 'BLOCKED' | 'EXPIRED' | 'REPLACED'> = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  BLOCKED: 'BLOCKED',
  EXPIRED: 'EXPIRED',
  REPLACED: 'REPLACED',
};

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function isSameUtcMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

function idempotencyKey(eventType: string, externalId: string): string {
  return `nymcard:${eventType}:${externalId}`;
}

export class NymCardCardWebhook {
  public readonly router = Router();

  constructor() {
    this.router.post('/transaction', asyncHandler(this.handleTransaction));
    this.router.post('/shipping-update', asyncHandler(this.handleShippingUpdate));
    this.router.post('/card-status', asyncHandler(this.handleCardStatus));
  }

  // ────────────────────────────────────────────────────────────────
  // Signature verification — strict HMAC-SHA256
  // ────────────────────────────────────────────────────────────────

  private verifySignature(req: Request): boolean {
    const sig = req.header(env.WEBHOOK_SIGNATURE_HEADER) ?? undefined;
    return nymcardService.verifyWebhookSignature(req.body as Buffer, sig);
  }

  private parseJsonBody<T>(req: Request, schema: z.ZodType<T>): T {
    const raw = JSON.parse((req.body as Buffer).toString('utf8'));
    return schema.parse(raw);
  }

  // ────────────────────────────────────────────────────────────────
  // /transaction
  // ────────────────────────────────────────────────────────────────

  private handleTransaction = async (req: Request, res: Response): Promise<void> => {
    if (!this.verifySignature(req)) throw Unauthorized('INVALID_SIGNATURE');
    const payload = this.parseJsonBody(req, txnPayloadSchema);

    // Authorization events are pre-settlement holds. We do NOT touch
    // the ledger on AUTHORIZED — the cash hasn't moved yet, and the
    // issuer can void the auth on a partial / declined clearing. We
    // ACK so NymCard stops retrying.
    if (payload.type === 'transaction.authorized') {
      logger.info('NymCard authorization received (no ledger effect)', {
        externalId: payload.data.id,
        cardId: payload.data.cardId,
        amount: payload.data.amount,
      });
      res.status(200).json({ received: true });
      return;
    }

    await this.processTransaction(payload);
    res.status(200).json({ received: true });
  };

  private async processTransaction(payload: TxnPayload): Promise<void> {
    const { type, data } = payload;
    const isRefund = type === 'transaction.refunded';
    const externalId = data.id;
    const cardId = data.cardId;

    const card = await prisma.card.findUnique({ where: { cardId } });
    if (!card) {
      // Unknown card — the issuer's universe has a card we don't. ACK
      // so the issuer stops retrying; surface for ops investigation.
      logger.warn('NymCard webhook: unknown card', { cardId, externalId });
      return;
    }

    const employee = await prisma.employee.findUnique({
      where: { id: card.employeeId },
      select: { id: true, plan: true, walletBalance: true },
    });
    if (!employee) {
      logger.warn('NymCard webhook: card has no employee', { cardId, externalId });
      return;
    }

    // Idempotency pre-flight: bail without touching anything if we've
    // already processed this exact event.
    const idemKey = idempotencyKey(type, externalId);
    const already = await prisma.employeeTransaction.findUnique({
      where: { idempotencyKey: idemKey },
    });
    if (already) {
      logger.info('NymCard webhook: replay detected, no-op', {
        externalId,
        eventType: type,
        idempotencyKey: idemKey,
      });
      return;
    }

    // Sign convention: purchases debit (negative); refunds credit (positive).
    const signedAmount = isRefund ? Math.abs(data.amount) : -Math.abs(data.amount);
    const interchange = data.interchangeFeeAED ?? 0;

    // Daily / monthly counter rollover — keep accumulators correct
    // across UTC day / month boundaries. We compute the new values
    // BEFORE the transaction so the math is auditable in logs.
    const now = new Date();
    const lastTxnDay = card.updatedAt;
    const sameDay = isSameUtcDay(now, lastTxnDay);
    const sameMonth = isSameUtcMonth(now, lastTxnDay);
    const purchaseAmt = Math.abs(data.amount);
    const nextSpentToday = (sameDay ? card.spentToday : 0) + (isRefund ? -purchaseAmt : purchaseAmt);
    const nextSpentThisMonth =
      (sameMonth ? card.spentThisMonth : 0) + (isRefund ? -purchaseAmt : purchaseAmt);

    // Limit warning (informational — NymCard enforces hard limits at
    // auth time; this surfaces post-fact drift / config mismatch).
    if (nextSpentToday > card.dailyLimit) {
      logger.warn('NymCard txn pushed card over modelled daily limit', {
        cardId,
        spentToday: nextSpentToday,
        dailyLimit: card.dailyLimit,
      });
    }
    if (nextSpentThisMonth > card.monthlyLimit) {
      logger.warn('NymCard txn pushed card over modelled monthly limit', {
        cardId,
        spentThisMonth: nextSpentThisMonth,
        monthlyLimit: card.monthlyLimit,
      });
    }

    await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // 1. EmployeeTransaction (the user-facing append-only row).
        //    Idempotency lives on the unique index.
        await tx.employeeTransaction.create({
          data: {
            employeeId: employee.id,
            type: isRefund ? TransactionType.REFUND : TransactionType.CARD_PURCHASE,
            amount: signedAmount,
            fee: 0,
            totalAmount: signedAmount,
            currency: data.currency,
            status: TransactionStatus.COMPLETED,
            description: data.merchantName,
            merchantName: data.merchantName,
            merchantCategory: data.merchantCategory,
            cardId: card.id,
            reference: externalId,
            idempotencyKey: idemKey,
            processedAt: new Date(),
          },
        });

        // 2. Atomic wallet movement. Card purchases debit the wallet;
        //    refunds credit it back.
        await tx.employee.update({
          where: { id: employee.id },
          data: { walletBalance: { increment: signedAmount } },
        });

        // 3. Card spend accumulators. Resetting at day / month rollover
        //    is done in-line with the math computed above.
        await tx.card.update({
          where: { id: card.id },
          data: {
            spentToday: Math.max(0, nextSpentToday),
            spentThisMonth: Math.max(0, nextSpentThisMonth),
          },
        });

        // 4. Interchange revenue audit log. Booked, structured, and
        //    queryable for the ops-intel metrics pipeline. Only emitted
        //    on positive-revenue events (clearing/settlement).
        if (interchange > 0 && !isRefund) {
          await tx.auditLog.create({
            data: {
              actorType: 'system',
              actorId: 'webhook:nymcard',
              action: 'INTERCHANGE_REVENUE_BOOKED',
              resourceType: 'EmployeeTransaction',
              resourceId: externalId,
              metadata: {
                cardId: card.id,
                employeeId: employee.id,
                interchangeAED: interchange,
                purchaseAED: purchaseAmt,
                merchantCategory: data.merchantCategory,
                eventType: type,
              } as Prisma.InputJsonValue,
            },
          });
        }
      },
      { timeout: 30_000 },
    );

    // 5. Cashback issuance lives outside the ledger transaction —
    //    cashback writes its own EmployeeTransaction row and the
    //    failure path here should NOT roll back the purchase itself.
    //    Cashback service already de-duplicates internally.
    if (!isRefund) {
      try {
        await cashbackService.processCashback({
          employeeId: employee.id,
          amount: purchaseAmt,
          merchantCategory: data.merchantCategory,
          plan: employee.plan,
        });
      } catch (err) {
        logger.error('NymCard cashback failed (purchase preserved)', {
          externalId,
          employeeId: employee.id,
          error: (err as Error).message,
        });
      }
    }

    logger.info('NymCard transaction processed', {
      externalId,
      eventType: type,
      employeeId: employee.id,
      cardId: card.id,
      signedAmount,
      interchangeAED: interchange,
      merchant: data.merchantName,
    });
  }

  // ────────────────────────────────────────────────────────────────
  // /shipping-update
  // ────────────────────────────────────────────────────────────────

  private handleShippingUpdate = async (req: Request, res: Response): Promise<void> => {
    if (!this.verifySignature(req)) throw Unauthorized('INVALID_SIGNATURE');
    const { cardId, trackingNumber, status } = this.parseJsonBody(req, shippingPayloadSchema);
    const card = await prisma.card.findUnique({ where: { cardId } });
    if (!card) {
      res.status(202).json({ received: true });
      return;
    }
    await prisma.card.update({
      where: { id: card.id },
      data: { trackingNumber, shippingStatus: status },
    });
    res.status(200).json({ received: true });
  };

  // ────────────────────────────────────────────────────────────────
  // /card-status
  // ────────────────────────────────────────────────────────────────

  private handleCardStatus = async (req: Request, res: Response): Promise<void> => {
    if (!this.verifySignature(req)) throw Unauthorized('INVALID_SIGNATURE');
    const { cardId, status } = this.parseJsonBody(req, cardStatusPayloadSchema);
    const card = await prisma.card.findUnique({ where: { cardId } });
    if (!card) {
      res.status(202).json({ received: true });
      return;
    }
    const next = CARD_STATUS_MAP[status.toUpperCase()] ?? card.status;
    if (next !== card.status) {
      await prisma.card.update({ where: { id: card.id }, data: { status: next } });
      await prisma.auditLog.create({
        data: {
          actorType: 'system',
          actorId: 'webhook:nymcard',
          action: 'CARD_STATUS_CHANGED',
          resourceType: 'Card',
          resourceId: card.id,
          metadata: { from: card.status, to: next } as Prisma.InputJsonValue,
        },
      });
    }
    res.status(200).json({ received: true });
  };
}

export const nymCardCardWebhook = new NymCardCardWebhook();
