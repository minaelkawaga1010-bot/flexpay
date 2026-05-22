import { Request, Response, Router } from 'express';
import crypto from 'crypto';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { z } from 'zod';
import { env } from '@config/env';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { Unauthorized } from '@shared/utils/errors';

/**
 * MoneyHash webhook — production-grade cross-border remittance handler.
 *
 * Lifecycle the handler implements:
 *
 *   PENDING → COMPLETED   on `transfer.succeeded`
 *   PENDING → FAILED      on `transfer.failed`  (+ append-only REFUND
 *                                                 row + atomic wallet
 *                                                 credit-back)
 *
 *   Any state → status reported again ⇒ idempotent no-op (no double-
 *                                       refund, no double-credit)
 *
 * Security:
 *   • Strict HMAC-SHA256 over the raw body using
 *     env.MONEYHASH_WEBHOOK_SECRET. Production with secret unset is a
 *     deploy-time configuration error; we passthrough in non-prod so
 *     local tooling and CI can hit the route without forcing a key.
 *
 * Atomicity:
 *   • On failure, the original `EmployeeTransaction` is marked FAILED,
 *     a NEW EmployeeTransaction of type REFUND is appended (immutable
 *     double-entry — we never mutate amounts on the original), and the
 *     employee's wallet is credited back, ALL inside one Prisma
 *     transaction.
 *
 *   • The REFUND row's idempotency key is the original transferId
 *     (UNIQUE on EmployeeTransaction.idempotencyKey). A redelivered
 *     failure webhook cannot create a second refund — the SQL unique
 *     constraint is the second line of defence under the in-handler
 *     "already-refunded" check.
 *
 * Audit:
 *   • Both success and failure paths emit an AuditLog row with the
 *     full event payload + the resolved counterparts (txn id, refund
 *     id where applicable). Used by the dashboard remittance view
 *     and by the compliance officer's transaction-graph reconciler.
 */

// ───────────────────────────────────────────────────────────────────
// Schemas
// ───────────────────────────────────────────────────────────────────

const STATUS_VALUES = ['succeeded', 'failed', 'pending', 'reversed'] as const;

/**
 * MoneyHash sends both new-style (`type` + `data`) and legacy
 * (`status` + `transferId`) payloads depending on the integration
 * version. We accept either — the handler unifies them downstream.
 */
const statusPayloadSchema = z.union([
  z.object({
    type: z.enum([
      'transfer.succeeded',
      'transfer.failed',
      'transfer.pending',
      'transfer.reversed',
    ]),
    data: z.object({
      transferId: z.string().min(1),
      failureReason: z.string().optional(),
      providerReference: z.string().optional(),
      timestamp: z.string().optional(),
    }),
  }),
  z.object({
    transferId: z.string().min(1),
    status: z.enum(STATUS_VALUES),
    failureReason: z.string().optional(),
    providerReference: z.string().optional(),
  }),
]);

type StatusEvent = {
  transferId: string;
  status: (typeof STATUS_VALUES)[number];
  failureReason?: string;
  providerReference?: string;
};

function normaliseEvent(raw: z.infer<typeof statusPayloadSchema>): StatusEvent {
  if ('type' in raw) {
    const status = raw.type.replace(/^transfer\./, '') as (typeof STATUS_VALUES)[number];
    return {
      transferId: raw.data.transferId,
      status,
      failureReason: raw.data.failureReason,
      providerReference: raw.data.providerReference,
    };
  }
  return {
    transferId: raw.transferId,
    status: raw.status,
    failureReason: raw.failureReason,
    providerReference: raw.providerReference,
  };
}

// ───────────────────────────────────────────────────────────────────
// Signature
// ───────────────────────────────────────────────────────────────────

function verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
  // In production the secret MUST be set — deploys without it cannot
  // legitimately receive webhooks. Outside production (test/dev) we
  // passthrough so tooling and CI can hit the route.
  if (!env.MONEYHASH_WEBHOOK_SECRET) return env.NODE_ENV !== 'production';
  if (!signature) return false;

  const expected = crypto
    .createHmac('sha256', env.MONEYHASH_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  // Strip an optional `sha256=` scheme prefix so we accept both
  // schemes-tagged and bare-hex signatures.
  const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// ───────────────────────────────────────────────────────────────────
// Idempotency key namespacing for the rollback refund row
// ───────────────────────────────────────────────────────────────────

function refundIdempotencyKey(transferId: string): string {
  return `moneyhash:refund:${transferId}`;
}

// ───────────────────────────────────────────────────────────────────
// Handler class
// ───────────────────────────────────────────────────────────────────

export class MoneyHashRemittanceWebhook {
  public readonly router = Router();

  constructor() {
    this.router.post('/status', asyncHandler(this.handleStatus));
  }

  private handleStatus = async (req: Request, res: Response): Promise<void> => {
    const ok = verifySignature(req.body as Buffer, req.header('x-moneyhash-signature') ?? undefined);
    if (!ok) throw Unauthorized('INVALID_SIGNATURE');

    let raw: unknown;
    try {
      raw = JSON.parse((req.body as Buffer).toString('utf8'));
    } catch (err) {
      logger.warn('moneyhash webhook: invalid JSON', { error: (err as Error).message });
      res.status(400).json({ error: 'INVALID_JSON' });
      return;
    }

    const parseResult = statusPayloadSchema.safeParse(raw);
    if (!parseResult.success) {
      logger.warn('moneyhash webhook: payload validation failed', {
        issues: parseResult.error.flatten(),
      });
      res.status(400).json({ error: 'INVALID_PAYLOAD', details: parseResult.error.flatten() });
      return;
    }

    const event = normaliseEvent(parseResult.data);

    // Locate the original remittance EmployeeTransaction by reference.
    // `reference` is non-unique by index, but the remittance service
    // writes one row per transferId, so findFirst is correct.
    const original = await prisma.employeeTransaction.findFirst({
      where: { reference: event.transferId, type: TransactionType.REMITTANCE },
    });

    if (!original) {
      // Unknown transferId. ACK so MoneyHash stops retrying; surface
      // for ops investigation. Don't 4xx — that triggers MH retry
      // storms.
      logger.warn('moneyhash webhook: unknown transferId', { transferId: event.transferId });
      res.status(202).json({ received: true });
      return;
    }

    switch (event.status) {
      case 'succeeded':
        await this.markSucceeded(original, event);
        break;
      case 'failed':
      case 'reversed':
        await this.markFailedAndRollback(original, event);
        break;
      case 'pending':
        // No-op: PENDING is the initial state. We log so ops sees the
        // wire signal but don't touch state.
        logger.info('moneyhash webhook: pending status received (no-op)', {
          transferId: event.transferId,
        });
        break;
    }

    res.status(200).json({ received: true });
  };

  // ────────────────────────────────────────────────────────────────
  // Success path
  // ────────────────────────────────────────────────────────────────

  private async markSucceeded(
    original: {
      id: string;
      employeeId: string;
      status: TransactionStatus;
      totalAmount: number;
      reference: string | null;
    },
    event: StatusEvent,
  ): Promise<void> {
    if (original.status === TransactionStatus.COMPLETED) {
      logger.info('moneyhash webhook: already COMPLETED (replay no-op)', {
        transferId: event.transferId,
      });
      return;
    }
    if (original.status === TransactionStatus.FAILED || original.status === TransactionStatus.REVERSED) {
      // The provider reported success on a previously-refunded txn.
      // This is a contract violation on their side; surface loudly,
      // do NOT auto-reconcile (that would create a phantom credit).
      logger.error('moneyhash webhook: success after terminal failure — ops review required', {
        transferId: event.transferId,
        currentStatus: original.status,
      });
      await prisma.auditLog.create({
        data: {
          actorType: 'system',
          actorId: 'webhook:moneyhash',
          action: 'REMITTANCE_SUCCESS_AFTER_FAILURE_CONFLICT',
          resourceType: 'EmployeeTransaction',
          resourceId: original.id,
          metadata: {
            transferId: event.transferId,
            providerReference: event.providerReference ?? null,
            currentStatus: original.status,
          } as Prisma.InputJsonValue,
        },
      });
      return;
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.employeeTransaction.update({
        where: { id: original.id },
        data: { status: TransactionStatus.COMPLETED, processedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'system',
          actorId: 'webhook:moneyhash',
          action: 'REMITTANCE_COMPLETED',
          resourceType: 'EmployeeTransaction',
          resourceId: original.id,
          metadata: {
            transferId: event.transferId,
            providerReference: event.providerReference ?? null,
          } as Prisma.InputJsonValue,
        },
      });
    });

    logger.info('moneyhash remittance completed', {
      transferId: event.transferId,
      employeeId: original.employeeId,
    });
  }

  // ────────────────────────────────────────────────────────────────
  // Failure path — append-only refund + atomic wallet credit-back
  // ────────────────────────────────────────────────────────────────

  private async markFailedAndRollback(
    original: {
      id: string;
      employeeId: string;
      status: TransactionStatus;
      totalAmount: number;
      fee: number;
      currency: string;
      reference: string | null;
    },
    event: StatusEvent,
  ): Promise<void> {
    if (original.status === TransactionStatus.FAILED || original.status === TransactionStatus.REVERSED) {
      logger.info('moneyhash webhook: already FAILED/REVERSED (replay no-op)', {
        transferId: event.transferId,
      });
      return;
    }

    // Refund-idempotency second line of defence: if a refund row
    // already exists for this transferId, do not create another.
    const refundKey = refundIdempotencyKey(event.transferId);
    const existingRefund = await prisma.employeeTransaction.findUnique({
      where: { idempotencyKey: refundKey },
    });
    if (existingRefund) {
      logger.info('moneyhash webhook: refund already issued (no-op)', {
        transferId: event.transferId,
        refundId: existingRefund.id,
      });
      return;
    }

    // The remittance service writes `totalAmount` as a positive AED
    // number representing what was debited from the wallet. The refund
    // credits the same magnitude back. We do NOT mutate the original
    // row's amounts — that is the append-only invariant.
    const refundAmount = Math.abs(original.totalAmount);

    await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // 1. Mark original FAILED. Status is the only mutable field;
        //    amount / fee / reference / type are all immutable.
        await tx.employeeTransaction.update({
          where: { id: original.id },
          data: {
            status: TransactionStatus.FAILED,
            processedAt: new Date(),
          },
        });

        // 2. Append the refund row. Type REFUND, positive amount,
        //    idempotency key derived from the transferId so a retried
        //    failure webhook can never create a second refund.
        const refund = await tx.employeeTransaction.create({
          data: {
            employeeId: original.employeeId,
            type: TransactionType.REFUND,
            amount: refundAmount,
            fee: 0,
            totalAmount: refundAmount,
            currency: original.currency,
            status: TransactionStatus.COMPLETED,
            description: `Refund for failed remittance ${event.transferId}${
              event.failureReason ? `: ${event.failureReason}` : ''
            }`,
            reference: event.transferId,
            idempotencyKey: refundKey,
            processedAt: new Date(),
          },
        });

        // 3. Credit the wallet back. Atomic with the rows above —
        //    nothing leaves the txn boundary half-done.
        await tx.employee.update({
          where: { id: original.employeeId },
          data: { walletBalance: { increment: refundAmount } },
        });

        // 4. Compliance/ops trail.
        await tx.auditLog.create({
          data: {
            actorType: 'system',
            actorId: 'webhook:moneyhash',
            action: 'REMITTANCE_FAILED_AND_REFUNDED',
            resourceType: 'EmployeeTransaction',
            resourceId: original.id,
            metadata: {
              transferId: event.transferId,
              refundId: refund.id,
              refundAmount,
              failureReason: event.failureReason ?? null,
              providerReference: event.providerReference ?? null,
            } as Prisma.InputJsonValue,
          },
        });
      },
      { timeout: 30_000 },
    );

    logger.info('moneyhash remittance failed → wallet rolled back', {
      transferId: event.transferId,
      employeeId: original.employeeId,
      refundAmount,
      failureReason: event.failureReason ?? null,
    });
  }
}

export const moneyHashRemittanceWebhook = new MoneyHashRemittanceWebhook();
