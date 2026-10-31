import {
  Prisma,
  TransactionStatus,
  TransactionType,
  type EmployeeTransaction,
} from '@prisma/client';
import { prisma } from '@config/prisma';
import { acquireWorkerLockScoped, LockScope } from '@shared/utils/advisory-lock';
import { NotFound } from '@shared/utils/errors';
import logger from '@shared/utils/logger';

/**
 * MoneyHash remittance lifecycle (TASK-011). A remittance is one
 * EmployeeTransaction of type REMITTANCE; its wallet debit (amount + fee)
 * is taken before anything is sent to MoneyHash.
 *
 *   PENDING ──provider success──▶ COMPLETED   signed `succeeded` webhook
 *   PENDING ──provider failure──▶ FAILED      signed `failed` / `reversed`
 *                                             webhook, or MoneyHash refusing
 *                                             the submission; one REFUND
 *                                             credits the full debit back
 *
 * PENDING also covers a submission whose outcome is UNKNOWN (timeout,
 * connection reset, 5xx): the transfer may exist upstream, so it is never
 * refunded on that evidence alone.
 *
 * COMPLETED and FAILED (and REVERSED, which nothing produces today) are
 * terminal for automatic processing. A contradictory late event —
 * failure or reversal after COMPLETED, success after FAILED — changes no
 * status or balance and leaves a *_CONFLICT audit row for ops. Crediting a
 * completed transfer back would need a provider-verified reversal
 * workflow, which does not exist.
 *
 * Financial invariants per remittance:
 *   • at most one REFUND row (unique `moneyhash:refund:<reference>`)
 *   • COMPLETED ⇒ no REFUND row; a REFUND row ⇒ FAILED / REVERSED
 *   • wallet effect: PENDING and COMPLETED −totalAmount, FAILED 0
 *
 * Every transition is decided on the row re-read under the employee's
 * WALLET_DEBIT advisory lock — the lock wallet transfers and bill payments
 * take — inside the transaction that writes it.
 */

export function refundIdempotencyKey(reference: string): string {
  return `moneyhash:refund:${reference}`;
}

/** What the provider (or the submission attempt) reported. */
export interface RemittanceOutcome {
  /** MoneyHash transferId, or FlexPay's reference when none was bound. */
  transferId: string;
  providerReference?: string;
  failureReason?: string;
  /** The event as reported: `failed` and `reversed` both mean "did not complete". */
  event: 'succeeded' | 'failed' | 'reversed';
}

/** Audit-safe form of a provider reason: a code-like token, never free text. */
function reasonCode(reason: string | undefined): string | null {
  if (!reason) return null;
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(reason) ? reason : 'unspecified';
}

async function recordConflict(
  tx: Prisma.TransactionClient,
  remittance: EmployeeTransaction,
  action: string,
  outcome: RemittanceOutcome,
  actorId: string,
  context: Record<string, boolean> = {},
): Promise<void> {
  logger.error('moneyhash remittance: contradictory provider event — ops review required', {
    remittanceId: remittance.id,
    currentStatus: remittance.status,
    event: outcome.event,
  });
  await tx.auditLog.create({
    data: {
      actorType: 'system',
      actorId,
      action,
      resourceType: 'EmployeeTransaction',
      resourceId: remittance.id,
      metadata: {
        transferId: outcome.transferId,
        providerReference: outcome.providerReference ?? null,
        currentStatus: remittance.status,
        event: outcome.event,
        failureCode: reasonCode(outcome.failureReason),
        detectedUnderLock: true,
        ...context,
      } as Prisma.InputJsonValue,
    },
  });
}

async function lockAndReread(
  tx: Prisma.TransactionClient,
  remittanceId: string,
  employeeId: string,
): Promise<EmployeeTransaction> {
  await acquireWorkerLockScoped(tx, employeeId, LockScope.WALLET_DEBIT);
  const fresh = await tx.employeeTransaction.findUnique({ where: { id: remittanceId } });
  if (!fresh || fresh.type !== TransactionType.REMITTANCE) throw NotFound('Remittance not found');
  return fresh;
}

/** Apply a provider success: PENDING → COMPLETED, nothing else. */
export async function confirmRemittance(
  remittanceId: string,
  employeeId: string,
  outcome: RemittanceOutcome,
  actorId: string,
): Promise<EmployeeTransaction> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const fresh = await lockAndReread(tx, remittanceId, employeeId);
    if (fresh.status === TransactionStatus.COMPLETED) {
      return fresh; // duplicate confirmation
    }

    const refund = fresh.reference
      ? await tx.employeeTransaction.findUnique({ where: { idempotencyKey: refundIdempotencyKey(fresh.reference) } })
      : null;
    if (fresh.status !== TransactionStatus.PENDING || refund) {
      // Already failed and refunded: a late success is never auto-reconciled
      // (that would re-debit a wallet that was credited back).
      await recordConflict(tx, fresh, 'REMITTANCE_SUCCESS_AFTER_FAILURE_CONFLICT', outcome, actorId, {
        refundIssued: refund !== null,
      });
      return fresh;
    }

    const updated = await tx.employeeTransaction.update({
      where: { id: fresh.id },
      data: { status: TransactionStatus.COMPLETED, processedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorType: 'system',
        actorId,
        action: 'REMITTANCE_COMPLETED',
        resourceType: 'EmployeeTransaction',
        resourceId: fresh.id,
        metadata: {
          transferId: outcome.transferId,
          providerReference: outcome.providerReference ?? null,
        } as Prisma.InputJsonValue,
      },
    });
    logger.info('moneyhash remittance completed', { remittanceId: fresh.id, employeeId });
    return updated;
  });
}

/**
 * Apply a provider failure or reversal: PENDING → FAILED with one
 * append-only REFUND row and the full debit credited back, atomically.
 * The original row's amounts are never mutated.
 */
export async function failRemittance(
  remittanceId: string,
  employeeId: string,
  outcome: RemittanceOutcome,
  actorId: string,
): Promise<EmployeeTransaction> {
  return prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const fresh = await lockAndReread(tx, remittanceId, employeeId);
      if (fresh.status === TransactionStatus.COMPLETED) {
        // MoneyHash already confirmed this transfer: a later failure or
        // reversal never credits the wallet automatically.
        await recordConflict(tx, fresh, 'REMITTANCE_FAILURE_AFTER_COMPLETION_CONFLICT', outcome, actorId);
        return fresh;
      }
      if (fresh.status !== TransactionStatus.PENDING) {
        return fresh; // FAILED / REVERSED: already refunded — a duplicate is a no-op
      }

      const refundKey = refundIdempotencyKey(fresh.reference ?? fresh.id);
      const existing = await tx.employeeTransaction.findUnique({ where: { idempotencyKey: refundKey } });
      if (existing) {
        // A refund row whose remittance never left PENDING (a partial earlier
        // state): finish the transition without crediting again.
        return tx.employeeTransaction.update({
          where: { id: fresh.id },
          data: { status: TransactionStatus.FAILED, processedAt: new Date() },
        });
      }

      // The remittance service records `totalAmount` as the positive AED
      // amount debited from the wallet; the refund credits the same
      // magnitude back.
      const refundAmount = Math.abs(fresh.totalAmount);
      const updated = await tx.employeeTransaction.update({
        where: { id: fresh.id },
        data: { status: TransactionStatus.FAILED, processedAt: new Date() },
      });
      const refund = await tx.employeeTransaction.create({
        data: {
          employeeId: fresh.employeeId,
          type: TransactionType.REFUND,
          amount: refundAmount,
          fee: 0,
          totalAmount: refundAmount,
          currency: fresh.currency,
          status: TransactionStatus.COMPLETED,
          description: `Refund for failed remittance ${outcome.transferId}${
            outcome.failureReason ? `: ${outcome.failureReason}` : ''
          }`,
          reference: outcome.transferId,
          idempotencyKey: refundKey,
          processedAt: new Date(),
        },
      });
      await tx.employee.update({
        where: { id: fresh.employeeId },
        data: { walletBalance: { increment: refundAmount } },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'system',
          actorId,
          action: 'REMITTANCE_FAILED_AND_REFUNDED',
          resourceType: 'EmployeeTransaction',
          resourceId: fresh.id,
          metadata: {
            transferId: outcome.transferId,
            refundId: refund.id,
            refundAmount,
            failureReason: outcome.failureReason ?? null,
            providerReference: outcome.providerReference ?? null,
          } as Prisma.InputJsonValue,
        },
      });
      logger.info('moneyhash remittance failed → wallet rolled back', { remittanceId: fresh.id, employeeId });
      return updated;
    },
    { timeout: 30_000 },
  );
}
