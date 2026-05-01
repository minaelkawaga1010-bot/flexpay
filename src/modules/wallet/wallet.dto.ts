import { z } from 'zod';
import { phoneSchema, amountSchema } from '@shared/middleware/validator';

export const transactionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  type: z
    .enum([
      'DEPOSIT',
      'WITHDRAWAL',
      'TRANSFER',
      'RECEIVE',
      'CASHBACK',
      'FEE',
      'REFERRAL_REWARD',
      'SAVINGS_TRANSFER',
      'CARD_PURCHASE',
      'PAYROLL',
      'REMITTANCE',
      'REFUND',
    ])
    .optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});
export type TransactionsQueryDto = z.infer<typeof transactionsQuerySchema>;

export const transferSchema = z.object({
  recipientPhone: phoneSchema,
  amount: amountSchema,
});
export type TransferDto = z.infer<typeof transferSchema>;
