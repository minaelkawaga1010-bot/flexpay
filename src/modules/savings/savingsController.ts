import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateBody } from '../../utils/validation';
import { savingsService } from './savingsService';

const router = Router();
router.use(authenticate, requireRole('employee'));

router.get(
  '/goals',
  asyncHandler(async (req, res) => {
    const goals = await savingsService.list(req.auth!.sub);
    res.json({ goals });
  }),
);

const createSchema = z.object({
  name: z.string().min(1),
  targetAmount: z.number().positive(),
  monthlyAuto: z.number().nonnegative().optional(),
  deadline: z.coerce.date().optional(),
});

router.post(
  '/goals',
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const goal = await savingsService.create(req.auth!.sub, req.body);
    res.status(201).json({ goal });
  }),
);

const amountSchema = z.object({ amount: z.number().positive() });

router.post(
  '/goals/:id/deposit',
  validateBody(amountSchema),
  asyncHandler(async (req, res) => {
    const goal = await savingsService.deposit(req.auth!.sub, req.params.id, req.body.amount);
    res.json({ goal });
  }),
);

router.post(
  '/goals/:id/withdraw',
  validateBody(amountSchema),
  asyncHandler(async (req, res) => {
    const goal = await savingsService.withdraw(req.auth!.sub, req.params.id, req.body.amount);
    res.json({ goal });
  }),
);

export default router;
