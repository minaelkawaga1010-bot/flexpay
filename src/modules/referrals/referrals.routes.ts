import { Router } from 'express';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { referralsService } from './referrals.service';

const router = Router();

router.use(authenticate('employee'));

router.get(
  '/my-code',
  asyncHandler(async (req: AuthRequest, res) => {
    const code = await referralsService.getMyCode(req.user!.id);
    res.json({ referralCode: code });
  }),
);

router.get(
  '/history',
  asyncHandler(async (req: AuthRequest, res) => {
    const referrals = await referralsService.history(req.user!.id);
    res.json({ referrals });
  }),
);

export default router;
