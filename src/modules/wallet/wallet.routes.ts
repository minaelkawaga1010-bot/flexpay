import { Router } from 'express';
import { authenticate } from '@shared/middleware/auth';
import { transferRateLimiter } from '@shared/middleware/rate-limit';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { idempotency } from '@shared/utils/idempotency';
import { transactionsQuerySchema, transferSchema } from './wallet.dto';
import { walletController } from './wallet.controller';

const router = Router();

router.use(authenticate('employee'));

router.get('/balance', asyncHandler(walletController.getBalance));

router.get(
  '/transactions',
  validate(transactionsQuerySchema, 'query'),
  asyncHandler(walletController.listTransactions),
);

router.post(
  '/transfer',
  transferRateLimiter,
  idempotency,
  validate(transferSchema),
  asyncHandler(walletController.transfer),
);

export default router;
