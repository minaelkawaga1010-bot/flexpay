import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import { BadRequest, NotFound } from '../../utils/errors';
import { notificationService } from '../../services/notificationService';
import { referralService } from '../referrals/referralService';

const TRANSFER_FEE_BASIC = 2;
const TRANSFER_FEE_LUXURY = 0;

export const walletService = {
  async getBalance(employeeId: string): Promise<number> {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { walletBalance: true },
    });
    if (!employee) throw NotFound('Employee not found');
    return employee.walletBalance;
  },

  async listTransactions(employeeId: string, limit: number, offset: number) {
    return prisma.employeeTransaction.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  },

  async transfer(senderId: string, recipientPhone: string, amount: number) {
    if (amount <= 0) throw BadRequest('Amount must be positive');

    const sender = await prisma.employee.findUnique({ where: { id: senderId } });
    if (!sender) throw NotFound('Sender not found');

    const recipient = await prisma.employee.findUnique({ where: { phone: recipientPhone } });
    if (!recipient) throw NotFound('Recipient not found');
    if (recipient.id === sender.id) throw BadRequest('Cannot transfer to yourself');

    const fee = sender.plan === 'LUXURY' ? TRANSFER_FEE_LUXURY : TRANSFER_FEE_BASIC;
    const total = amount + fee;
    if (sender.walletBalance < total) throw BadRequest('Insufficient balance');

    const [updatedSender, , transferTx] = await prisma.$transaction([
      prisma.employee.update({
        where: { id: sender.id },
        data: { walletBalance: { decrement: total } },
      }),
      prisma.employee.update({
        where: { id: recipient.id },
        data: { walletBalance: { increment: amount } },
      }),
      prisma.employeeTransaction.create({
        data: {
          employeeId: sender.id,
          type: 'TRANSFER',
          amount,
          fee,
          totalAmount: total,
          status: 'COMPLETED',
          description: `Transfer to ${recipient.phone}`,
          reference: recipient.id,
        },
      }),
      prisma.employeeTransaction.create({
        data: {
          employeeId: recipient.id,
          type: 'DEPOSIT',
          amount,
          totalAmount: amount,
          status: 'COMPLETED',
          description: `Transfer from ${sender.phone}`,
          reference: sender.id,
        },
      }),
    ]);

    // Side-effects (best-effort, outside the DB transaction)
    await Promise.all([
      notificationService.notifyTransferReceived(recipient.id, amount, sender.fullName),
      notificationService.notifyTransferSent(sender.id, amount, recipient.fullName),
      referralService.maybeReward(recipient.id, amount),
    ]);

    return {
      transactionId: transferTx.id,
      balance: updatedSender.walletBalance,
      fee,
    };
  },

  /** Generic credit helper — used by payroll, cashback, etc. */
  async credit(
    tx: Prisma.TransactionClient,
    employeeId: string,
    amount: number,
    type: Prisma.EmployeeTransactionCreateInput['type'],
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
  },
};
