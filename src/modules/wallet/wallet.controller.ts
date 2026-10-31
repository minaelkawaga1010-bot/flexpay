import { Response, Router } from 'express';
import { TransactionType } from '@prisma/client';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { transferRateLimiter } from '@shared/middleware/rate-limit';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { idempotency } from '@shared/utils/idempotency';
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
      // TASK-013: after authenticate() (router.use above), so the record is
      // scoped to this employee — never a shared pre-auth namespace.
      idempotency,
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
    // TASK-013: the service-level (DB-unique) idempotency key must be scoped
    // to the authenticated sender, or two users sending the same raw
    // Idempotency-Key would collide and one would replay the other's
    // transaction. Namespacing here (wiring only) keeps wallet.service and
    // the schema untouched, consistent with remittance/advance scoping.
    const rawKey = req.header('idempotency-key');
    const result = await walletService.transfer({
      senderId: req.user!.id,
      recipientPhone: req.body.recipientPhone,
      amount: req.body.amount,
      idempotencyKey: rawKey ? `wallet:transfer:${req.user!.id}:${rawKey}` : undefined,
    });
    res.json(result);
  };
}

export const walletController = new WalletController();
