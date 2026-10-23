import { Request, Response, Router } from 'express';
import { TransactionType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { confirmRemittance, failRemittance } from '@modules/remittance/remittance-lifecycle';
import {
  assertWebhookAuthenticated,
  processDeliveryOnce,
  verifyMoneyHashRequest,
} from './webhook-security';

/**
 * MoneyHash webhook — production-grade cross-border remittance handler.
 *
 * Lifecycle the handler implements:
 *
 *   PENDING → COMPLETED   on `transfer.succeeded`
 *   PENDING → FAILED      on `transfer.failed` / `transfer.reversed`
 *                         (+ append-only REFUND row + atomic wallet
 *                         credit-back)
 *
 *   Any state → status reported again ⇒ idempotent no-op (no double-
 *                                       refund, no double-credit)
 *   COMPLETED → failed / reversed, FAILED → succeeded ⇒ contradictory:
 *                         no status or balance change, *_CONFLICT audit
 *                         (TASK-011; see remittance-lifecycle.ts)
 *
 * Security (TASK-007):
 *   • MoneyHash's documented v3 signature (`MoneyHash-Signature:
 *     t=…,v3=…`, HMAC-SHA256 over base64(raw body) + t) with the signed
 *     timestamp inside MONEYHASH_WEBHOOK_TOLERANCE_SECONDS. Each
 *     signature is single-use. Missing or weak configuration is a 503 in
 *     EVERY environment — there is no non-production passthrough.
 *
 * Atomicity:
 *   • Every transition is decided on the row re-read under the
 *     employee's WALLET_DEBIT advisory lock, in the transaction that
 *     writes it. On failure, the original `EmployeeTransaction` is marked
 *     FAILED, a NEW EmployeeTransaction of type REFUND is appended
 *     (immutable double-entry — we never mutate amounts on the
 *     original), and the employee's wallet is credited back, ALL inside
 *     one Prisma transaction.
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
// Handler class
// ───────────────────────────────────────────────────────────────────

export class MoneyHashRemittanceWebhook {
  public readonly router = Router();

  constructor() {
    this.router.post('/status', asyncHandler(this.handleStatus));
  }

  private handleStatus = async (req: Request, res: Response): Promise<void> => {
    const auth = verifyMoneyHashRequest(req);
    assertWebhookAuthenticated(auth, 'moneyhash');
    await processDeliveryOnce(
      res,
      'moneyhash',
      { key: auth.deliveryKey, ttlSeconds: auth.deliveryTtlSeconds },
      () => this.processStatus(req, res),
    );
  };

  private async processStatus(req: Request, res: Response): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse((req.body as Buffer).toString('utf8'));
    } catch {
      logger.warn('moneyhash webhook: invalid JSON');
      res.status(400).json({ error: 'INVALID_JSON' });
      return;
    }

    const parseResult = statusPayloadSchema.safeParse(raw);
    if (!parseResult.success) {
      // Field paths only — never payload values.
      logger.warn('moneyhash webhook: payload validation failed', {
        fields: parseResult.error.issues.map((issue) => issue.path.join('.')),
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

    const outcome = {
      transferId: event.transferId,
      providerReference: event.providerReference,
      failureReason: event.failureReason,
    };
    switch (event.status) {
      case 'succeeded':
        await confirmRemittance(original.id, original.employeeId, { ...outcome, event: 'succeeded' }, 'webhook:moneyhash');
        break;
      case 'failed':
      case 'reversed':
        await failRemittance(original.id, original.employeeId, { ...outcome, event: event.status }, 'webhook:moneyhash');
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
  }
}

export const moneyHashRemittanceWebhook = new MoneyHashRemittanceWebhook();
