import { Response, Router } from 'express';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { referralsService } from './referrals.service';

export class ReferralsController {
  public readonly router = Router();

  constructor() {
    this.router.use(authenticate('employee'));
    this.router.get('/my-code', asyncHandler(this.myCode));
    this.router.get('/history', asyncHandler(this.history));
  }

  private myCode = async (req: AuthRequest, res: Response): Promise<void> => {
    const code = await referralsService.getMyCode(req.user!.id);
    res.json({ referralCode: code });
  };

  private history = async (req: AuthRequest, res: Response): Promise<void> => {
    res.json({ referrals: await referralsService.history(req.user!.id) });
  };
}

export const referralsController = new ReferralsController();
