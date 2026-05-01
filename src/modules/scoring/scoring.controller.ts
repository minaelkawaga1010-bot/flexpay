import { Router } from 'express';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { scoringService } from './scoring.service';

const router = Router();

router.get(
  '/credit-score',
  authenticate('employee'),
  asyncHandler(async (req: AuthRequest, res) => {
    const score = await scoringService.compute(req.user!.id);
    res.json(score);
  }),
);

export default router;
