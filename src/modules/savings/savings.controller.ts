import { Response } from 'express';
import { AuthRequest } from '@shared/middleware/auth';
import { savingsService } from './savings.service';

export const savingsController = {
  async list(req: AuthRequest, res: Response): Promise<void> {
    const goals = await savingsService.list(req.user!.id);
    res.json({ goals });
  },

  async create(req: AuthRequest, res: Response): Promise<void> {
    const goal = await savingsService.create(req.user!.id, req.body);
    res.status(201).json({ goal });
  },

  async deposit(req: AuthRequest, res: Response): Promise<void> {
    const goal = await savingsService.deposit(req.user!.id, req.params.id, req.body.amount);
    res.json({ goal });
  },

  async withdraw(req: AuthRequest, res: Response): Promise<void> {
    const goal = await savingsService.withdraw(req.user!.id, req.params.id, req.body.amount);
    res.json({ goal });
  },
};
