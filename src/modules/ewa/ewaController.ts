import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateBody } from '../../utils/validation';
import { ewaService } from './ewaService';

const router = Router();

const advanceSchema = z.object({
  amount: z.number().positive(),
  returnUrl: z.string().url(),
});

router.post(
  '/request',
  authenticate,
  requireRole('employee'),
  validateBody(advanceSchema),
  asyncHandler(async (req, res) => {
    const result = await ewaService.requestAdvance(req.auth!.sub, req.body.amount, req.body.returnUrl);
    res.json(result);
  }),
);

export default router;
