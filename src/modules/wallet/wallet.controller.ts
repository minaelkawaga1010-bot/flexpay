import { Response } from 'express';
import { TransactionType } from '@prisma/client';
import { AuthRequest } from '@shared/middleware/auth';
import { walletService } from './wallet.service';

export const walletController = {
  async getBalance(req: AuthRequest, res: Response): Promise<void> {
    const balance = await walletService.getBalance(req.user!.id);
    res.json({ balance });
  },

  async listTransactions(req: AuthRequest, res: Response): Promise<void> {
    const { limit, offset, type, startDate, endDate } = req.query as Record<string, unknown>;
    const result = await walletService.getTransactions(req.user!.id, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      type: type ? (type as TransactionType) : undefined,
      startDate: startDate as Date | string | undefined,
      endDate: endDate as Date | string | undefined,
    });
    res.json(result);
  },

  async transfer(req: AuthRequest, res: Response): Promise<void> {
    const result = await walletService.transfer({
      senderId: req.user!.id,
      recipientPhone: req.body.recipientPhone,
      amount: req.body.amount,
      idempotencyKey: req.header('idempotency-key') ?? undefined,
    });
    res.json(result);
  },
};
