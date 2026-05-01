import { Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { idempotency } from '@shared/utils/idempotency';
import { remittanceService } from './remittance.service';

const router = Router();
router.use(authenticate('employee'));

const quoteQuery = z.object({
  amount: z.coerce.number().positive(),
  currency: z.string().length(3),
});

router.get(
  '/quote',
  validate(quoteQuery, 'query'),
  asyncHandler(async (req: AuthRequest, res) => {
    const amount = Number(req.query.amount);
    const currency = String(req.query.currency).toUpperCase();
    const quote = await remittanceService.quote(amount, currency);
    res.json({
      ...quote,
      disclaimer: 'Estimated amount. Final delivered value may vary based on FX at settlement.',
    });
  }),
);

const sendSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3),
  beneficiary: z.object({
    name: z.string().min(2),
    bankAccount: z.string().min(4),
    swiftCode: z.string().min(4),
  }),
});

router.post(
  '/send',
  idempotency,
  validate(sendSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    const result = await remittanceService.send(
      req.user!.id,
      req.body.amount,
      req.body.currency.toUpperCase(),
      req.body.beneficiary,
    );
    res.json(result);
  }),
);

export default router;
