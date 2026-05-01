import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { idempotency } from '../../middleware/idempotency';
import { validateBody, validateQuery } from '../../utils/validation';
import { remittanceService } from './remittanceService';

const router = Router();
router.use(authenticate, requireRole('employee'));

const quoteQuery = z.object({
  amount: z.coerce.number().positive(),
  currency: z.string().length(3),
});

router.get(
  '/quote',
  validateQuery(quoteQuery),
  asyncHandler(async (req, res) => {
    const { amount, currency } = req.query as unknown as z.infer<typeof quoteQuery>;
    const quote = await remittanceService.quote(amount, currency.toUpperCase());
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
  validateBody(sendSchema),
  asyncHandler(async (req, res) => {
    const result = await remittanceService.send(
      req.auth!.sub,
      req.body.amount,
      req.body.currency.toUpperCase(),
      req.body.beneficiary,
    );
    res.json(result);
  }),
);

export default router;
