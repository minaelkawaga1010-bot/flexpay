import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { idempotency } from '../../middleware/idempotency';
import { validateBody, validateQuery } from '../../utils/validation';
import { walletService } from './walletService';

const router = Router();

router.get(
  '/balance',
  authenticate,
  requireRole('employee'),
  asyncHandler(async (req, res) => {
    const balance = await walletService.getBalance(req.auth!.sub);
    res.json({ balance });
  }),
);

const txQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get(
  '/transactions',
  authenticate,
  requireRole('employee'),
  validateQuery(txQuery),
  asyncHandler(async (req, res) => {
    const { limit, offset } = req.query as unknown as z.infer<typeof txQuery>;
    const transactions = await walletService.listTransactions(req.auth!.sub, limit, offset);
    res.json({ transactions });
  }),
);

const transferSchema = z.object({
  recipientPhone: z.string().regex(/^\+\d{8,15}$/),
  amount: z.number().positive(),
});

router.post(
  '/transfer',
  authenticate,
  requireRole('employee'),
  idempotency,
  validateBody(transferSchema),
  asyncHandler(async (req, res) => {
    const result = await walletService.transfer(
      req.auth!.sub,
      req.body.recipientPhone,
      req.body.amount,
    );
    res.json(result);
  }),
);

export default router;
