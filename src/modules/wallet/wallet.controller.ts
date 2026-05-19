import { Response, Router } from 'express';
import { TransactionType } from '@prisma/client';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { transferRateLimiter } from '@shared/middleware/rate-limit';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { walletService } from './wallet.service';
import { transactionsQuerySchema, transferSchema } from './wallet.dto';

export class WalletController {
  public readonly router = Router();

  constructor() {
    this.router.use(authenticate('employee'));
    this.router.get('/balance', asyncHandler(this.getBalance));
    this.router.get(
      '/transactions',
      validate(transactionsQuerySchema, 'query'),
      asyncHandler(this.listTransactions),
    );
    this.router.post(
      '/transfer',
      transferRateLimiter,
      validate(transferSchema),
      asyncHandler(this.transfer),
    );
  }

  private getBalance = async (req: AuthRequest, res: Response): Promise<void> => {
    const balance = await walletService.getBalance(req.user!.id);
    res.json({ balance });
  };

  private listTransactions = async (req: AuthRequest, res: Response): Promise<void> => {
    const { limit, offset, type, startDate, endDate } = req.query as Record<string, unknown>;
    const result = await walletService.getTransactions(req.user!.id, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      type: type ? (type as TransactionType) : undefined,
      startDate: startDate as Date | string | undefined,
      endDate: endDate as Date | string | undefined,
    });
    res.json(result);
  };

  private transfer = async (req: AuthRequest, res: Response): Promise<void> => {
    const result = await walletService.transfer({
      senderId: req.user!.id,
      recipientPhone: req.body.recipientPhone,
      amount: req.body.amount,
      idempotencyKey: req.header('idempotency-key') ?? undefined,
    });
    res.json(result);
  };
}

export const walletController = new WalletController();
