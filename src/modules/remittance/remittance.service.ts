import { randomUUID } from 'crypto';
import { Prisma, TransactionStatus, TransactionType, type EmployeeTransaction } from '@prisma/client';
import { prisma } from '@config/prisma';
import { env } from '@config/env';
import { roundCurrency } from '@shared/utils/currency';
import { acquireWorkerLockScoped, LockScope } from '@shared/utils/advisory-lock';
import { AppError, BadRequest, NotFound } from '@shared/utils/errors';
import logger from '@shared/utils/logger';
import { Beneficiary, moneyHashService } from './moneyhash.service';
import { failRemittance } from './remittance-lifecycle';

const FX_CACHE_TTL_MS = 5 * 60 * 1000;

const fxCache = new Map<string, { rate: number; expiresAt: number }>();

type Quote = { rate: number; fee: number; recipientAmount: number; totalDebit: number };

/**
 * MoneyHash refused the request, or it never reached MoneyHash: no
 * transfer was created, so refunding is safe. Anything else — timeout,
 * connection reset, 5xx, an unrecognised error — is ambiguous: the
 * transfer may exist upstream. (HTTP-level reading of the response; the
 * MoneyHash error contract itself is not verified.)
 */
export function submissionDefinitelyRejected(err: unknown): boolean {
  const e = err as { response?: { status?: number }; code?: string };
  if (e.response?.status !== undefined) return [400, 401, 403, 404, 422].includes(e.response.status);
  return ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(e.code ?? '');
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Debit the wallet and record the remittance PENDING before anything
 * leaves: under the WALLET_DEBIT lock (shared with transfers and bill
 * payments) with a guarded decrement, so concurrent sends can never
 * overdraw the wallet or reach MoneyHash unfunded.
 */
async function reserve(
  employeeId: string,
  amount: number,
  currency: string,
  beneficiary: Beneficiary,
  quote: Quote,
  reference: string,
  idempotencyKey: string | null,
): Promise<EmployeeTransaction> {
  try {
    return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await acquireWorkerLockScoped(tx, employeeId, LockScope.WALLET_DEBIT);
      const employee = await tx.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
      if (!employee) throw NotFound('Employee not found');

      const debit = await tx.employee.updateMany({
        where: { id: employeeId, walletBalance: { gte: quote.totalDebit } },
        data: { walletBalance: { decrement: quote.totalDebit } },
      });
      if (debit.count !== 1) throw BadRequest('Insufficient balance');

      return tx.employeeTransaction.create({
        data: {
          employeeId,
          type: TransactionType.REMITTANCE,
          amount,
          fee: quote.fee,
          totalAmount: quote.totalDebit,
          status: TransactionStatus.PENDING,
          description: `Remittance to ${beneficiary.name} (${currency})`,
          reference,
          location: { country: currency } as Prisma.InputJsonValue,
          merchantName: 'MoneyHash',
          idempotencyKey,
        },
      });
    });
  } catch (err) {
    // The idempotency key is unique: a concurrent or repeated submission
    // of the same request loses here, before any money moves.
    if (idempotencyKey && isUniqueViolation(err)) {
      throw new AppError(409, 'REMITTANCE_ALREADY_SUBMITTED', 'This remittance was already submitted');
    }
    throw err;
  }
}

export const remittanceService = {
  async getRate(from: string, to: string): Promise<number> {
    const key = `${from}-${to}`;
    const cached = fxCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.rate;
    const rate = await moneyHashService.getExchangeRate(from, to);
    fxCache.set(key, { rate, expiresAt: Date.now() + FX_CACHE_TTL_MS });
    return rate;
  },

  async quote(amount: number, currency: string) {
    if (amount <= 0) throw BadRequest('Amount must be positive');
    const rate = await this.getRate('AED', currency);
    const finalRate = rate * (1 - env.REMITTANCE_FX_SPREAD);
    const fee = roundCurrency(amount * env.REMITTANCE_FEE_PERCENT);
    const recipientAmount = roundCurrency(amount * finalRate);
    return { rate: finalRate, fee, recipientAmount, totalDebit: amount + fee };
  },

  /**
   * Reserve, submit, then bind (TASK-011). The remittance stays PENDING
   * until MoneyHash's signed webhook confirms or fails it. A submission
   * MoneyHash refused is refunded at once; one whose outcome is unknown
   * keeps the debit and stays PENDING for reconciliation — a timeout is
   * never taken as proof that the transfer failed.
   *
   * `idempotencyKey` (client-supplied): at most one remittance per key.
   */
  async send(
    employeeId: string,
    amount: number,
    currency: string,
    beneficiary: Beneficiary,
    options: { idempotencyKey?: string } = {},
  ) {
    const quote = await this.quote(amount, currency);
    // FlexPay's own handle, sent to MoneyHash as the transfer reference and
    // kept on the row until MoneyHash returns its transferId.
    const reference = `rem_${randomUUID()}`;
    const idempotencyKey = options.idempotencyKey
      ? `moneyhash:remittance:${employeeId}:${options.idempotencyKey}`
      : null;
    const remittance = await reserve(employeeId, amount, currency, beneficiary, quote, reference, idempotencyKey);
    const estimatedDelivery = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    let transferId: string;
    try {
      transferId = await moneyHashService.createTransfer({ amount, currency: 'AED', beneficiary, reference });
    } catch (err) {
      if (submissionDefinitelyRejected(err)) {
        await failRemittance(
          remittance.id,
          employeeId,
          { transferId: reference, event: 'failed', failureReason: 'provider_rejected_submission' },
          'remittance:submission',
        );
        throw new AppError(
          502,
          'REMITTANCE_REJECTED',
          'MoneyHash rejected the transfer; the full amount was returned to the wallet',
        );
      }
      // Outcome unknown: keep the debit and the PENDING row. Error class only.
      const errorClass = String(
        (err as { code?: string; response?: { status?: number } }).code ??
          (err as { response?: { status?: number } }).response?.status ??
          'unknown',
      );
      logger.warn('moneyhash remittance: submission outcome unknown — held PENDING', {
        remittanceId: remittance.id,
        errorClass,
      });
      await prisma.auditLog.create({
        data: {
          actorType: 'system',
          actorId: 'remittance:submission',
          action: 'REMITTANCE_SUBMISSION_OUTCOME_UNKNOWN',
          resourceType: 'EmployeeTransaction',
          resourceId: remittance.id,
          metadata: { reference, errorClass } as Prisma.InputJsonValue,
        },
      });
      return {
        transferId: reference,
        status: 'PENDING_VERIFICATION' as const,
        estimatedDelivery,
        recipientAmount: quote.recipientAmount,
        fee: quote.fee,
      };
    }

    // Bind MoneyHash's id so its webhooks find this remittance. No status change here.
    await prisma.employeeTransaction.update({
      where: { id: remittance.id },
      data: { reference: transferId },
    });
    return {
      transferId,
      status: 'PENDING' as const,
      estimatedDelivery,
      recipientAmount: quote.recipientAmount,
      fee: quote.fee,
    };
  },
};
