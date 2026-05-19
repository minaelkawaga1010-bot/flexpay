import { Response, Router } from 'express';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { creditScoringService } from './scoring.service';

export class ScoringController {
  public readonly router = Router();

  constructor() {
    this.router.get(
      '/score',
      authenticate('employee'),
      asyncHandler(this.getScore),
    );
  }

  private getScore = async (req: AuthRequest, res: Response): Promise<void> => {
    const score = await creditScoringService.computeScore(req.user!.id);
    res.json(score);
  };
}

export const scoringController = new ScoringController();
