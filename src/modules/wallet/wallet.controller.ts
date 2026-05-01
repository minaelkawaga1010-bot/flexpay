import { Response } from 'express';
import { AuthRequest } from '@shared/middleware/auth';
import { walletService } from './wallet.service';

export const walletController = {
  async getBalance(req: AuthRequest, res: Response): Promise<void> {
    const balance = await walletService.getBalance(req.user!.id);
    res.json({ balance });
  },

  async listTransactions(req: AuthRequest, res: Response): Promise<void> {
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    const transactions = await walletService.listTransactions(req.user!.id, limit, offset);
    res.json({ transactions });
  },

  async transfer(req: AuthRequest, res: Response): Promise<void> {
    const result = await walletService.transfer(
      req.user!.id,
      req.body.recipientPhone,
      req.body.amount,
    );
    res.json(result);
  },
};
