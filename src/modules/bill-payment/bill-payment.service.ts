import {
  BillerType,
  BillPayment,
  BillPaymentStatus,
  Prisma,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { prisma } from '@config/prisma';
import { acquireWorkerLockScoped, LockScope } from '@shared/utils/advisory-lock';
import { AppError, BadRequest, NotFound } from '@shared/utils/errors';
import logger from '@shared/utils/logger';
import { roundCurrency } from '@shared/utils/currency';
import { computeBillerFee } from './biller-fee';
import {
  BillerDispatchResult,
  getBillerAdapter,
} from './biller-adapter.service';

/**
 * Free Bills — wallet-funded bill payment service.
 *
 * Flow:
 *
 *   1. Pre-flight: lookup BillPayment by idempotencyKey. If it
 *      exists, return it — the request is a replay.
 *
 *   2. Inside a single $transaction with a scoped advisory lock
 *      (WALLET_DEBIT) on the employee:
 *        a. Re-read the employee's wallet balance (the lock
 *           guarantees no concurrent debit has shifted it since the
 *           pre-flight check).
 *        b. Verify sufficient balance.
 *        c. Decrement the wallet by totalAmount (amount + fee).
 *        d. Create the BillPayment row in PENDING.
 *        e. Create the linked EmployeeTransaction in PENDING (debit
 *           row; negative amount), with idempotency key `bill:<key>`
 *           — the SQL-unique guarantee is the second line of defence
 *           against double-debit.
 *
 *   3. After commit, dispatch to the biller adapter. If the adapter
 *      throws or returns `failed` synchronously, run the refund flow
 *      (append-only): mark BillPayment FAILED, create a REFUND
 *      EmployeeTransaction, credit the wallet back. The refund is
 *      idempotent on `bill:refund:<key>`.
 *
 * Invariants:
 *   • A successful return from payBill() ⇒ wallet has been debited
 *     and the rail has accepted the request (status pending or
 *     completed). A failure ⇒ wallet is whole and no rail call is in
 *     flight.
 *   • The EmployeeTransaction row is never amount-mutated post-
 *     creation. Status transitions are append-only on top of the
 *     original row (status field is the sole mutable column).
 */

// ───────────────────────────────────────────────────────────────────
// Idempotency key namespacing
// ───────────────────────────────────────────────────────────────────

export function walletTxnIdempotencyKey(billIdempotencyKey: string): string {
  return `bill:${billIdempotencyKey}`;
}

export function refundIdempotencyKey(billIdempotencyKey: string): string {
  return `bill:refund:${billIdempotencyKey}`;
}

// ───────────────────────────────────────────────────────────────────
// Input shape
// ───────────────────────────────────────────────────────────────────

export interface PayBillInput {
  employeeId: string;
  billerType: BillerType;
  billerAccountRef: string;
  amount: number;
  idempotencyKey: string;
  currency?: string;
  metadata?: Record<string, unknown>;
}

// ───────────────────────────────────────────────────────────────────
// Service entry point
// ───────────────────────────────────────────────────────────────────

/**
 * Submit a wallet-funded bill payment.
 *
 * Returns the persisted BillPayment row. Replays of the same
 * idempotencyKey return the original row unchanged (no second debit,
 * no second rail dispatch).
 */
export async function payBill(input: PayBillInput): Promise<BillPayment> {
  validateInput(input);

  // ── 1. Pre-flight idempotency check (cheap, outside the tx).
  const existing = await prisma.billPayment.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    logger.info('bill-payment: idempotent replay — returning existing row', {
      employeeId: input.employeeId,
      idempotencyKey: input.idempotencyKey,
      status: existing.status,
    });
    return existing;
  }

  const currency = input.currency ?? 'AED';
  const amount = roundCurrency(input.amount);
  const fee = roundCurrency(computeBillerFee(input.billerType, amount));
  const totalAmount = roundCurrency(amount + fee);

  // ── 2. Atomic debit + bill + wallet-txn write.
  const bill = await prisma.$transaction(
    async (tx: Prisma.TransactionClient): Promise<BillPayment> => {
      await acquireWorkerLockScoped(tx, input.employeeId, LockScope.WALLET_DEBIT);

      const employee = await tx.employee.findUnique({
        where: { id: input.employeeId },
        select: { id: true, walletBalance: true },
      });
      if (!employee) throw NotFound('Employee not found');
      if (employee.walletBalance < totalAmount) {
        throw new AppError(
          409,
          'INSUFFICIENT_BALANCE',
          'Wallet balance is below the bill amount + fee.',
          {
            walletBalance: employee.walletBalance,
            required: totalAmount,
          },
        );
      }

      // SQL-unique guarantees idempotency_key is unique. The
      // pre-flight check is a fast path; the unique constraint is
      // what makes a concurrent duplicate request fail closed.
      const created = await tx.billPayment.create({
        data: {
          employeeId: input.employeeId,
          billerType: input.billerType,
          billerAccountRef: input.billerAccountRef,
          amount,
          fee,
          totalAmount,
          currency,
          status: BillPaymentStatus.PENDING,
          idempotencyKey: input.idempotencyKey,
          metadata: (input.metadata ?? null) as Prisma.InputJsonValue,
        },
      });

      const walletTxn = await tx.employeeTransaction.create({
        data: {
          employeeId: input.employeeId,
          type: TransactionType.BILL_PAYMENT,
          // Debit recorded as a negative magnitude — mirrors the
          // card-purchase convention in nymcard-card.webhook.
          amount: -totalAmount,
          fee,
          totalAmount: -totalAmount,
          currency,
          status: TransactionStatus.PENDING,
          description: `Bill payment to ${input.billerType} (${input.billerAccountRef})`,
          reference: created.id,
          merchantName: input.billerType,
          merchantCategory: 'UTILITY',
          idempotencyKey: walletTxnIdempotencyKey(input.idempotencyKey),
        },
      });

      await tx.employee.update({
        where: { id: input.employeeId },
        data: { walletBalance: { increment: -totalAmount } },
      });

      // Stitch the linkage. We re-fetch via a follow-up update to
      // avoid a circular dependency on walletTxn.id before its
      // creation — kept inside the same tx so the link is atomic.
      const linked = await tx.billPayment.update({
        where: { id: created.id },
        data: { walletTransactionId: walletTxn.id },
      });

      await tx.auditLog.create({
        data: {
          actorType: 'employee',
          actorId: input.employeeId,
          action: 'BILL_PAYMENT_SUBMITTED',
          resourceType: 'BillPayment',
          resourceId: linked.id,
          metadata: {
            billerType: input.billerType,
            amount,
            fee,
            totalAmount,
            idempotencyKey: input.idempotencyKey,
          } as Prisma.InputJsonValue,
        },
      });

      return linked;
    },
    { timeout: 30_000 },
  );

  // ── 3. Post-commit rail dispatch. The wallet is debited and the
  // bill is recorded; if the rail rejects synchronously we roll back
  // via an append-only refund flow.
  let dispatch: BillerDispatchResult;
  try {
    dispatch = await getBillerAdapter().submit({
      billPaymentId: bill.id,
      billerType: bill.billerType,
      billerAccountRef: bill.billerAccountRef,
      amount: bill.amount,
      currency: bill.currency,
      idempotencyKey: bill.idempotencyKey,
      customerRef: bill.employeeId,
    });
  } catch (err) {
    logger.error('bill-payment: adapter threw — initiating refund', {
      billPaymentId: bill.id,
      error: (err as Error).message,
    });
    return refundFailedBill(bill, (err as Error).message ?? 'adapter_exception');
  }

  if (dispatch.status === 'failed') {
    logger.warn('bill-payment: adapter reported failure — initiating refund', {
      billPaymentId: bill.id,
      failureReason: dispatch.failureReason,
    });
    return refundFailedBill(bill, dispatch.failureReason ?? 'adapter_rejected', dispatch.externalRef);
  }

  // Adapter succeeded (pending or completed). Persist the rail ref.
  return prisma.billPayment.update({
    where: { id: bill.id },
    data: {
      externalRef: dispatch.externalRef,
      // If the adapter is synchronous-completed (rare), reflect it
      // immediately so the dashboard isn't stuck on PENDING waiting
      // for a webhook the rail won't send.
      ...(dispatch.status === 'completed'
        ? { status: BillPaymentStatus.COMPLETED, processedAt: new Date() }
        : {}),
    },
  });
}

// ───────────────────────────────────────────────────────────────────
// Refund flow — append-only credit-back
// ───────────────────────────────────────────────────────────────────

/**
 * Mark a BillPayment FAILED, append a REFUND wallet transaction, and
 * credit the wallet back. All atomic inside one $transaction; the
 * refund-side idempotency key (`bill:refund:<key>`) prevents
 * double-refund across concurrent or retried failure paths.
 *
 * Exported for the webhook handler — same flow whether the failure
 * comes synchronously from the adapter or asynchronously from the
 * biller webhook.
 */
export async function refundFailedBill(
  bill: BillPayment,
  failureReason: string,
  externalRef?: string,
): Promise<BillPayment> {
  if (bill.status === BillPaymentStatus.FAILED || bill.status === BillPaymentStatus.REVERSED) {
    return bill;
  }

  // Second line of defence — idempotency on the refund row itself.
  const existingRefund = await prisma.employeeTransaction.findUnique({
    where: { idempotencyKey: refundIdempotencyKey(bill.idempotencyKey) },
  });
  if (existingRefund) {
    // Refund already issued in a previous attempt; the bill row may
    // have been left PENDING by a crashed prior call. Heal it now.
    logger.info('bill-payment: refund already issued, healing bill row', {
      billPaymentId: bill.id,
      refundId: existingRefund.id,
    });
    return prisma.billPayment.update({
      where: { id: bill.id },
      data: {
        status: BillPaymentStatus.FAILED,
        failureReason,
        refundTransactionId: existingRefund.id,
        processedAt: new Date(),
        ...(externalRef ? { externalRef } : {}),
      },
    });
  }

  return prisma.$transaction(
    async (tx: Prisma.TransactionClient): Promise<BillPayment> => {
      await acquireWorkerLockScoped(tx, bill.employeeId, LockScope.WALLET_DEBIT);

      // Mark the original PENDING wallet txn FAILED — status only,
      // amounts are immutable (append-only invariant).
      if (bill.walletTransactionId) {
        await tx.employeeTransaction.update({
          where: { id: bill.walletTransactionId },
          data: { status: TransactionStatus.FAILED, processedAt: new Date() },
        });
      }

      const refundAmount = bill.totalAmount;
      const refund = await tx.employeeTransaction.create({
        data: {
          employeeId: bill.employeeId,
          type: TransactionType.REFUND,
          amount: refundAmount,
          fee: 0,
          totalAmount: refundAmount,
          currency: bill.currency,
          status: TransactionStatus.COMPLETED,
          description: `Refund for failed bill ${bill.billerType} (${bill.billerAccountRef}): ${failureReason}`,
          reference: bill.id,
          merchantName: bill.billerType,
          merchantCategory: 'UTILITY',
          idempotencyKey: refundIdempotencyKey(bill.idempotencyKey),
          processedAt: new Date(),
        },
      });

      await tx.employee.update({
        where: { id: bill.employeeId },
        data: { walletBalance: { increment: refundAmount } },
      });

      const updated = await tx.billPayment.update({
        where: { id: bill.id },
        data: {
          status: BillPaymentStatus.FAILED,
          failureReason,
          refundTransactionId: refund.id,
          processedAt: new Date(),
          ...(externalRef ? { externalRef } : {}),
        },
      });

      await tx.auditLog.create({
        data: {
          actorType: 'system',
          actorId: 'bill-payment:refund',
          action: 'BILL_PAYMENT_FAILED_AND_REFUNDED',
          resourceType: 'BillPayment',
          resourceId: bill.id,
          metadata: {
            refundId: refund.id,
            refundAmount,
            failureReason,
          } as Prisma.InputJsonValue,
        },
      });

      return updated;
    },
    { timeout: 30_000 },
  );
}

// ───────────────────────────────────────────────────────────────────
// Settlement (webhook side)
// ───────────────────────────────────────────────────────────────────

/**
 * Mark a BillPayment COMPLETED on inbound biller confirmation. The
 * linked wallet EmployeeTransaction transitions PENDING → COMPLETED.
 * Idempotent: a replay on an already-COMPLETED row is a no-op.
 */
export async function settleBillPayment(
  bill: BillPayment,
  externalRef: string,
): Promise<BillPayment> {
  if (bill.status === BillPaymentStatus.COMPLETED) {
    return bill;
  }
  if (bill.status === BillPaymentStatus.FAILED || bill.status === BillPaymentStatus.REVERSED) {
    // The rail reported success on a previously-failed-and-refunded
    // bill. Surface for ops review; do NOT auto-reconcile (that would
    // create a phantom debit because the wallet was already credited
    // back).
    logger.error('bill-payment: settle after terminal failure — ops review required', {
      billPaymentId: bill.id,
      currentStatus: bill.status,
      externalRef,
    });
    await prisma.auditLog.create({
      data: {
        actorType: 'system',
        actorId: 'webhook:biller',
        action: 'BILL_PAYMENT_SUCCESS_AFTER_FAILURE_CONFLICT',
        resourceType: 'BillPayment',
        resourceId: bill.id,
        metadata: {
          externalRef,
          currentStatus: bill.status,
        } as Prisma.InputJsonValue,
      },
    });
    return bill;
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<BillPayment> => {
    if (bill.walletTransactionId) {
      await tx.employeeTransaction.update({
        where: { id: bill.walletTransactionId },
        data: { status: TransactionStatus.COMPLETED, processedAt: new Date() },
      });
    }

    const updated = await tx.billPayment.update({
      where: { id: bill.id },
      data: {
        status: BillPaymentStatus.COMPLETED,
        externalRef,
        processedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        actorType: 'system',
        actorId: 'webhook:biller',
        action: 'BILL_PAYMENT_COMPLETED',
        resourceType: 'BillPayment',
        resourceId: bill.id,
        metadata: { externalRef } as Prisma.InputJsonValue,
      },
    });

    return updated;
  });
}

// ───────────────────────────────────────────────────────────────────
// Validation
// ───────────────────────────────────────────────────────────────────

function validateInput(input: PayBillInput): void {
  if (!input.employeeId) throw BadRequest('employeeId is required');
  if (!input.billerAccountRef || input.billerAccountRef.trim() === '') {
    throw BadRequest('billerAccountRef is required');
  }
  if (!input.idempotencyKey || input.idempotencyKey.trim() === '') {
    throw BadRequest('idempotencyKey is required');
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw BadRequest('amount must be a positive number');
  }
  if (input.amount > 100_000) {
    // Hard ceiling. UAE utility bills above this are atypical and
    // should route via the higher-touch B2B remittance flow.
    throw BadRequest('amount exceeds the per-bill ceiling (AED 100,000)');
  }
}
