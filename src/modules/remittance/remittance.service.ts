import { Prisma } from '@prisma/client';
import { prisma } from '@config/prisma';
import { env } from '@config/env';
import { roundCurrency } from '@shared/utils/currency';
import { BadRequest, NotFound } from '@shared/utils/errors';
import { Beneficiary, moneyHashService } from './moneyhash.service';

const FX_CACHE_TTL_MS = 5 * 60 * 1000;

const fxCache = new Map<string, { rate: number; expiresAt: number }>();

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

  async send(employeeId: string, amount: number, currency: string, beneficiary: Beneficiary) {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw NotFound('Employee not found');
    const quote = await this.quote(amount, currency);
    if (employee.walletBalance < quote.totalDebit) throw BadRequest('Insufficient balance');

    const transferId = await moneyHashService.createTransfer({
      amount,
      currency: 'AED',
      beneficiary,
      reference: `FlexPay transfer for ${employee.fullName}`,
    });

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.employee.update({
        where: { id: employeeId },
        data: { walletBalance: { decrement: quote.totalDebit } },
      });
      await tx.employeeTransaction.create({
        data: {
          employeeId,
          type: 'REMITTANCE',
          amount,
          fee: quote.fee,
          totalAmount: quote.totalDebit,
          status: 'COMPLETED',
          description: `Remittance to ${beneficiary.name} (${currency})`,
          reference: transferId,
          location: { country: currency } as Prisma.InputJsonValue,
          merchantName: 'MoneyHash',
        },
      });
    });

    const estimatedDelivery = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    return {
      transferId,
      estimatedDelivery,
      recipientAmount: quote.recipientAmount,
      fee: quote.fee,
    };
  },
};
