import { z } from 'zod';
import { phoneSchema, amountSchema } from '@shared/middleware/validator';

export const transactionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const transferSchema = z.object({
  recipientPhone: phoneSchema,
  amount: amountSchema,
});
export type TransferDto = z.infer<typeof transferSchema>;
