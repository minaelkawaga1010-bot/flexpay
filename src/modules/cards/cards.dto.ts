import { z } from 'zod';
import { addressSchema } from '@shared/middleware/validator';

export const orderPhysicalCardSchema = z.object({
  address: addressSchema,
});
export type OrderPhysicalCardDto = z.infer<typeof orderPhysicalCardSchema>;

export const tokenizeCardSchema = z.object({
  walletType: z.enum(['APPLE_PAY', 'GOOGLE_PAY']),
});
export type TokenizeCardDto = z.infer<typeof tokenizeCardSchema>;
