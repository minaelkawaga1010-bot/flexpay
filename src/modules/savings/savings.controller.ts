import { Response, Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { savingsService } from './savings.service';

const createSchema = z.object({
  name: z.string().min(1),
  targetAmount: z.number().positive(),
  monthlyAuto: z.number().nonnegative().optional(),
  autoSaveDay: z.number().int().min(1).max(28).optional(),
  deadline: z.coerce.date().optional(),
});
const amountSchema = z.object({ amount: z.number().positive() });

export class SavingsController {
  public readonly router = Router();

  constructor() {
    this.router.use(authenticate('employee'));
    this.router.get('/goals', asyncHandler(this.list));
    this.router.post('/goals', validate(createSchema), asyncHandler(this.create));
    this.router.post('/goals/:id/deposit', validate(amountSchema), asyncHandler(this.deposit));
    this.router.post('/goals/:id/withdraw', validate(amountSchema), asyncHandler(this.withdraw));
  }

  private list = async (req: AuthRequest, res: Response): Promise<void> => {
    res.json({ goals: await savingsService.list(req.user!.id) });
  };

  private create = async (req: AuthRequest, res: Response): Promise<void> => {
    res.status(201).json({ goal: await savingsService.create(req.user!.id, req.body) });
  };

  private deposit = async (req: AuthRequest, res: Response): Promise<void> => {
    res.json({
      goal: await savingsService.deposit(req.user!.id, req.params.id, req.body.amount),
    });
  };

  private withdraw = async (req: AuthRequest, res: Response): Promise<void> => {
    res.json({
      goal: await savingsService.withdraw(req.user!.id, req.params.id, req.body.amount),
    });
  };
}

export const savingsController = new SavingsController();
