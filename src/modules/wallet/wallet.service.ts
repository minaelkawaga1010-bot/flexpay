import { Prisma, TransactionType } from '@prisma/client';
import { prisma } from '@config/prisma';
import { env } from '@config/env';
import { BadRequest, Forbidden, NotFound } from '@shared/utils/errors';
import { enqueueNotification } from '@modules/notifications/notification.job';
import { referralsService } from '@modules/referrals/referrals.service';

export interface ListTransactionsArgs {
  limit?: number;
  offset?: number;
  type?: TransactionType;
  startDate?: Date | string;
  endDate?: Date | string;
}

export class WalletService {
  async getBalance(employeeId: string): Promise<number> {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { walletBalance: true },
    });
    if (!employee) throw NotFound('Employee not found');
    return employee.walletBalance;
  }

  async getTransactions(employeeId: string, args: ListTransactionsArgs) {
    const limit = args.limit ?? 20;
    const offset = args.offset ?? 0;

    const where: Prisma.EmployeeTransactionWhereInput = {
      employeeId,
      status: 'COMPLETED',
    };
    if (args.type) where.type = args.type;
    if (args.startDate || args.endDate) {
      where.createdAt = {};
      if (args.startDate) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(args.startDate);
      if (args.endDate) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(args.endDate);
    }

    const [transactions, total] = await Promise.all([
      prisma.employeeTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          amount: true,
          fee: true,
          totalAmount: true,
          currency: true,
          status: true,
          description: true,
          merchantName: true,
          counterpartyPhone: true,
          createdAt: true,
        },
        take: limit,
        skip: offset,
      }),
      prisma.employeeTransaction.count({ where }),
    ]);

    return {
      transactions,
      pagination: { total, limit, offset, hasMore: offset + limit < total },
    };
  }

  async transfer(args: {
    senderId: string;
    recipientPhone: string;
    amount: number;
    idempotencyKey?: string;
  }) {
    const { senderId, recipientPhone, amount, idempotencyKey } = args;
    if (amount <= 0) throw BadRequest('Amount must be positive');

    // Service-level idempotency: if a transaction with this key already
    // exists, replay its outcome rather than create a duplicate.
    if (idempotencyKey) {
      const existing = await prisma.employeeTransaction.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return {
          success: true,
          transactionId: existing.id,
          balance: await this.getBalance(senderId),
          fee: existing.fee,
          replay: true,
        };
      }
    }

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const sender = await tx.employee.findFirst({ where: { id: senderId, status: 'ACTIVE' } });
      if (!sender) throw NotFound('SENDER_NOT_FOUND');

      const recipient = await tx.employee.findFirst({
        where: { phone: recipientPhone, status: 'ACTIVE' },
      });
      if (!recipient) throw NotFound('RECIPIENT_NOT_FOUND');
      if (recipient.id === sender.id) throw BadRequest('CANNOT_TRANSFER_TO_SELF');

      const fee = sender.plan === 'LUXURY' ? 0 : env.P2P_TRANSFER_FEE;
      const total = amount + fee;
      if (sender.walletBalance < total) throw BadRequest('INSUFFICIENT_BALANCE');

      await tx.employee.update({
        where: { id: sender.id },
        data: { walletBalance: { decrement: total } },
      });
      await tx.employee.update({
        where: { id: recipient.id },
        data: { walletBalance: { increment: amount } },
      });

      // Double-entry record. The sender row carries a negative `amount` to
      // make ledger sums trivial; `totalAmount` is also negative for symmetry.
      const senderTxn = await tx.employeeTransaction.create({
        data: {
          employeeId: sender.id,
          type: 'TRANSFER',
          amount: -amount,
          fee,
          totalAmount: -total,
          status: 'COMPLETED',
          description: `P2P to ${recipient.phone}`,
          counterpartyId: recipient.id,
          counterpartyPhone: recipient.phone,
          idempotencyKey: idempotencyKey ?? null,
        },
      });
      await tx.employeeTransaction.create({
        data: {
          employeeId: recipient.id,
          type: 'RECEIVE',
          amount,
          fee: 0,
          totalAmount: amount,
          status: 'COMPLETED',
          description: `P2P from ${sender.phone}`,
          counterpartyId: sender.id,
          counterpartyPhone: sender.phone,
        },
      });

      // Side-effects (best-effort, after the DB tx).
      void Promise.all([
        enqueueNotification({
          kind: 'transfer-sent',
          employeeId: sender.id,
          amount,
          recipientName: recipient.fullName,
        }),
        enqueueNotification({
          kind: 'transfer-received',
          employeeId: recipient.id,
          amount,
          senderName: sender.fullName,
        }),
        referralsService.maybeReward(recipient.id, amount),
      ]);

      return {
        success: true,
        transactionId: senderTxn.id,
        balance: sender.walletBalance - total,
        fee,
      };
    });
  }

  /** Generic credit helper used by payroll, cashback, etc. */
  async credit(
    tx: Prisma.TransactionClient,
    employeeId: string,
    amount: number,
    type: TransactionType,
    description: string,
    reference?: string,
  ) {
    await tx.employee.update({
      where: { id: employeeId },
      data: { walletBalance: { increment: amount } },
    });
    await tx.employeeTransaction.create({
      data: {
        employeeId,
        type,
        amount,
        totalAmount: amount,
        status: 'COMPLETED',
        description,
        reference,
      },
    });
  }

  /** Forbidden helper kept on the service for symmetry with the previous API. */
  protected forbid(): never {
    throw Forbidden();
  }
}

export const walletService = new WalletService();
