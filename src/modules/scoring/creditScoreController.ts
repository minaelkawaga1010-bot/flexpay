import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { creditScoreService } from './creditScoreService';

const router = Router();

router.get(
  '/credit-score',
  authenticate,
  requireRole('employee'),
  asyncHandler(async (req, res) => {
    const score = await creditScoreService.compute(req.auth!.sub);
    res.json(score);
  }),
);

export default router;
