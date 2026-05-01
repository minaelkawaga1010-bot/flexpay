import { Response, Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { idempotency } from '@shared/utils/idempotency';
import { remittanceService } from './remittance.service';

const quoteQuery = z.object({
  amount: z.coerce.number().positive(),
  currency: z.string().length(3),
});

const sendSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3),
  beneficiary: z.object({
    name: z.string().min(2),
    bankAccount: z.string().min(4),
    swiftCode: z.string().min(4),
  }),
});

export class RemittanceController {
  public readonly router = Router();

  constructor() {
    this.router.use(authenticate('employee'));
    this.router.get('/quote', validate(quoteQuery, 'query'), asyncHandler(this.quote));
    this.router.post('/send', idempotency, validate(sendSchema), asyncHandler(this.send));
  }

  private quote = async (req: AuthRequest, res: Response): Promise<void> => {
    const amount = Number(req.query.amount);
    const currency = String(req.query.currency).toUpperCase();
    const quote = await remittanceService.quote(amount, currency);
    res.json({
      ...quote,
      disclaimer: 'Estimated amount. Final delivered value may vary based on FX at settlement.',
    });
  };

  private send = async (req: AuthRequest, res: Response): Promise<void> => {
    const result = await remittanceService.send(
      req.user!.id,
      req.body.amount,
      req.body.currency.toUpperCase(),
      req.body.beneficiary,
    );
    res.json(result);
  };
}

export const remittanceController = new RemittanceController();
