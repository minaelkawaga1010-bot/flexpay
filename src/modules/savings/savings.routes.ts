import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '@shared/middleware/auth';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { savingsController } from './savings.controller';

const router = Router();
router.use(authenticate('employee'));

const createSchema = z.object({
  name: z.string().min(1),
  targetAmount: z.number().positive(),
  monthlyAuto: z.number().nonnegative().optional(),
  autoSaveDay: z.number().int().min(1).max(28).optional(),
  deadline: z.coerce.date().optional(),
});

const amountSchema = z.object({ amount: z.number().positive() });

router.get('/goals', asyncHandler(savingsController.list));
router.post('/goals', validate(createSchema), asyncHandler(savingsController.create));
router.post('/goals/:id/deposit', validate(amountSchema), asyncHandler(savingsController.deposit));
router.post('/goals/:id/withdraw', validate(amountSchema), asyncHandler(savingsController.withdraw));

export default router;
