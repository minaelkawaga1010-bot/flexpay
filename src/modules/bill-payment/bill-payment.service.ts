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
 *      idempotent on `bill:refund:<key>`. A synchronous `completed`
 *      runs the same settlement path as the webhook.
 *
 * Status lifecycle (TASK-010). Every transition is decided on a fresh
 * read under the employee's WALLET_DEBIT advisory lock, inside the
 * transaction that writes it:
 *
 *   PENDING ──settle──▶ COMPLETED   rail confirmed (webhook or synchronous adapter)
 *   PENDING ──refund──▶ FAILED      rail or adapter failure; one REFUND credits the wallet
 *
 * COMPLETED and FAILED (and REVERSED, which nothing produces today) are
 * terminal for automatic processing. A contradictory late event —
 * failure or reversal after COMPLETED, success after FAILED — changes
 * no status or balance and leaves a *_CONFLICT audit row for ops.
 * Crediting a settled bill would need a provider-verified reversal
 * workflow, which does not exist.
 *
 * Financial invariants per bill:
 *   • at most one REFUND row (unique `bill:refund:<key>`)
 *   • COMPLETED ⇒ no REFUND row; a REFUND row ⇒ FAILED / REVERSED
 *   • wallet effect: PENDING and COMPLETED −totalAmount, FAILED 0
 *   • the BILL_PAYMENT wallet txn mirrors the bill status
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

  // A synchronous completion (rare) is a settlement: take the webhook's
  // locked, fresh-state path, which also completes the wallet txn —
  // never a blind status write outside the lock.
  if (dispatch.status === 'completed') {
    return settleBillPayment(bill, dispatch.externalRef, 'bill-payment:adapter');
  }

  // Pending: persist the rail ref so the webhook can find the bill. No
  // status change here.
  return prisma.billPayment.update({
    where: { id: bill.id },
    data: { externalRef: dispatch.externalRef },
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
 * Only a PENDING bill is refunded, judged on the row re-read under the
 * lock (TASK-010): a bill that settled meanwhile is never credited — the
 * late failure is audited as a conflict instead.
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
  // FAILED / REVERSED are terminal, so even a stale snapshot is final.
  if (bill.status === BillPaymentStatus.FAILED || bill.status === BillPaymentStatus.REVERSED) {
    return bill;
  }

  try {
    return await refundUnderLock(bill, failureReason, externalRef);
  } catch (err) {
    // Database-uniqueness backstop on `bill:refund:<key>`: a refund row
    // committed by a writer the advisory lock did not serialize (none
    // exist today). Decide again under the lock — the second pass sees
    // that row and takes the no-op / heal / conflict branch, never a
    // second credit.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      logger.warn('bill-payment: refund unique-key race — deciding again under the lock', {
        billPaymentId: bill.id,
      });
      return refundUnderLock(bill, failureReason, externalRef);
    }
    throw err;
  }
}

/** Audit-safe form of an adapter / provider reason: a code-like token, never free text. */
function reasonCode(reason: string): string {
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(reason) ? reason : 'unspecified';
}

async function refundUnderLock(
  bill: BillPayment,
  failureReason: string,
  externalRef?: string,
): Promise<BillPayment> {
  return prisma.$transaction(
    async (tx: Prisma.TransactionClient): Promise<BillPayment> => {
      await acquireWorkerLockScoped(tx, bill.employeeId, LockScope.WALLET_DEBIT);

      // Re-read UNDER the lock and decide on the fresh row: the caller's
      // snapshot may predate a settlement or a refund (e.g. the sync
      // adapter-failure path racing the async biller webhook) that
      // committed while we waited for the lock.
      const fresh = await tx.billPayment.findUnique({ where: { id: bill.id } });
      if (!fresh) throw NotFound('Bill payment not found');

      if (fresh.status === BillPaymentStatus.COMPLETED) {
        // The biller confirmed payment. A late failure or reversal never
        // credits the wallet; surface it for ops without touching the
        // settled balances.
        logger.error('bill-payment: failure after settlement — ops review required', {
          billPaymentId: fresh.id,
        });
        await tx.auditLog.create({
          data: {
            actorType: 'system',
            actorId: 'bill-payment:refund',
            action: 'BILL_PAYMENT_FAILURE_AFTER_SETTLEMENT_CONFLICT',
            resourceType: 'BillPayment',
            resourceId: fresh.id,
            metadata: {
              currentStatus: fresh.status,
              settledExternalRef: fresh.externalRef,
              eventExternalRef: externalRef ?? null,
              failureCode: reasonCode(failureReason),
              detectedUnderLock: true,
            } as Prisma.InputJsonValue,
          },
        });
        return fresh;
      }
      if (fresh.status !== BillPaymentStatus.PENDING) {
        // FAILED / REVERSED: already final — a duplicate failure is a no-op.
        return fresh;
      }

      const refundKey = refundIdempotencyKey(fresh.idempotencyKey);
      const existing = await tx.employeeTransaction.findUnique({
        where: { idempotencyKey: refundKey },
      });
      if (existing) {
        // A refund row whose bill is still PENDING (a partial earlier
        // state): finish the transition without crediting again.
        return tx.billPayment.update({
          where: { id: fresh.id },
          data: {
            status: BillPaymentStatus.FAILED,
            failureReason,
            refundTransactionId: existing.id,
            processedAt: new Date(),
            ...(externalRef ? { externalRef } : {}),
          },
        });
      }

      // Mark the original PENDING wallet txn FAILED — status only,
      // amounts are immutable (append-only invariant).
      if (fresh.walletTransactionId) {
        await tx.employeeTransaction.update({
          where: { id: fresh.walletTransactionId },
          data: { status: TransactionStatus.FAILED, processedAt: new Date() },
        });
      }

      const refundAmount = fresh.totalAmount;
      const refund = await tx.employeeTransaction.create({
        data: {
          employeeId: fresh.employeeId,
          type: TransactionType.REFUND,
          amount: refundAmount,
          fee: 0,
          totalAmount: refundAmount,
          currency: fresh.currency,
          status: TransactionStatus.COMPLETED,
          description: `Refund for failed bill ${fresh.billerType} (${fresh.billerAccountRef}): ${failureReason}`,
          reference: fresh.id,
          merchantName: fresh.billerType,
          merchantCategory: 'UTILITY',
          idempotencyKey: refundKey,
          processedAt: new Date(),
        },
      });

      await tx.employee.update({
        where: { id: fresh.employeeId },
        data: { walletBalance: { increment: refundAmount } },
      });

      const updated = await tx.billPayment.update({
        where: { id: fresh.id },
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
          resourceId: fresh.id,
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

/** Ops evidence for a success event on a bill that already failed (no reconciliation). */
async function recordSuccessAfterFailure(
  client: Pick<Prisma.TransactionClient, 'auditLog'>,
  bill: BillPayment,
  externalRef: string,
  actorId: string,
  context: Record<string, boolean>,
): Promise<void> {
  logger.error('bill-payment: settle after terminal failure — ops review required', {
    billPaymentId: bill.id,
    currentStatus: bill.status,
    externalRef,
  });
  await client.auditLog.create({
    data: {
      actorType: 'system',
      actorId,
      action: 'BILL_PAYMENT_SUCCESS_AFTER_FAILURE_CONFLICT',
      resourceType: 'BillPayment',
      resourceId: bill.id,
      metadata: { externalRef, currentStatus: bill.status, ...context } as Prisma.InputJsonValue,
    },
  });
}

/**
 * Mark a BillPayment COMPLETED on inbound biller confirmation (or a
 * synchronous adapter completion). The linked wallet EmployeeTransaction
 * transitions PENDING → COMPLETED. Idempotent: a replay on an
 * already-COMPLETED row is a no-op.
 */
export async function settleBillPayment(
  bill: BillPayment,
  externalRef: string,
  actorId = 'webhook:biller',
): Promise<BillPayment> {
  if (bill.status === BillPaymentStatus.COMPLETED) {
    return bill;
  }
  if (bill.status === BillPaymentStatus.FAILED || bill.status === BillPaymentStatus.REVERSED) {
    // The rail reported success on a previously-failed-and-refunded
    // bill. Surface for ops review; do NOT auto-reconcile (that would
    // create a phantom debit because the wallet was already credited
    // back).
    await recordSuccessAfterFailure(prisma, bill, externalRef, actorId, {});
    return bill;
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<BillPayment> => {
    // TASK-004: serialize against the refund path (both take WALLET_DEBIT)
    // and re-read the bill UNDER the lock. The caller's `bill` snapshot
    // was taken before the lock, so a concurrent refund may have moved
    // the bill to a terminal state meanwhile; decide on the FRESH status
    // to avoid marking COMPLETED a bill that was just FAILED + refunded
    // (which would be a phantom credit / divergent terminal state).
    await acquireWorkerLockScoped(tx, bill.employeeId, LockScope.WALLET_DEBIT);

    const fresh = await tx.billPayment.findUnique({ where: { id: bill.id } });
    if (!fresh) throw NotFound('Bill payment not found');

    if (fresh.status === BillPaymentStatus.COMPLETED) {
      // Another settle won the race — idempotent no-op.
      return fresh;
    }
    if (fresh.status === BillPaymentStatus.FAILED || fresh.status === BillPaymentStatus.REVERSED) {
      // A refund committed between the caller's snapshot and this lock.
      // Surface the conflict for ops; do NOT reconcile (the wallet was
      // already credited back).
      await recordSuccessAfterFailure(tx, fresh, externalRef, actorId, { detectedUnderLock: true });
      return fresh;
    }

    // TASK-010: a refund row means the wallet was already credited back —
    // settling on top of it would make a completed-and-refunded bill.
    const refund = await tx.employeeTransaction.findUnique({
      where: { idempotencyKey: refundIdempotencyKey(fresh.idempotencyKey) },
    });
    if (refund) {
      await recordSuccessAfterFailure(tx, fresh, externalRef, actorId, {
        detectedUnderLock: true,
        refundIssued: true,
      });
      return fresh;
    }

    // fresh.status === PENDING, nothing refunded → safe to settle.
    if (fresh.walletTransactionId) {
      await tx.employeeTransaction.update({
        where: { id: fresh.walletTransactionId },
        data: { status: TransactionStatus.COMPLETED, processedAt: new Date() },
      });
    }

    const updated = await tx.billPayment.update({
      where: { id: fresh.id },
      data: {
        status: BillPaymentStatus.COMPLETED,
        externalRef,
        processedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        actorType: 'system',
        actorId,
        action: 'BILL_PAYMENT_COMPLETED',
        resourceType: 'BillPayment',
        resourceId: fresh.id,
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
