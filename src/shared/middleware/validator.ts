import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError, z } from 'zod';
import logger from '@shared/utils/logger';

export const validate = (schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const data = req[source];
      const parsed = schema.parse(data);
      // Re-assign to keep coerced/transformed values available downstream.
      Object.assign(req[source] as object, parsed as object);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        logger.warn('Validation failed', { path: req.path, errors });
        res.status(400).json({ error: 'VALIDATION_ERROR', details: errors });
        return;
      }
      logger.error('Unexpected validation error', { error: (error as Error).message });
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  };
};

// =====================================================================
// Reusable Zod schemas
// =====================================================================

export const phoneSchema = z
  .string()
  .regex(/^\+\d{8,15}$/, 'Phone must be E.164 format')
  .transform((phone) => phone.replace(/\s/g, ''));

export const uaePhoneSchema = z
  .string()
  .regex(/^\+9715[0-9]{8}$/, 'Invalid UAE phone number format')
  .transform((phone) => phone.replace(/\s/g, ''));

export const emailSchema = z.string().email('Invalid email format').toLowerCase().trim();

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain uppercase letter')
  .regex(/[a-z]/, 'Password must contain lowercase letter')
  .regex(/[0-9]/, 'Password must contain number');

export const amountSchema = z.coerce.number().positive('Amount must be positive').finite('Amount must be a valid number');

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .transform((date) => new Date(date + 'T00:00:00Z'));

export const addressSchema = z.object({
  street: z.string().min(5),
  city: z.string().min(2),
  country: z.string().min(2),
  postalCode: z.string().min(4),
  emirate: z
    .enum(['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'])
    .optional(),
});
