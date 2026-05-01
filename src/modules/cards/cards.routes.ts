import { Router } from 'express';
import { authenticate } from '@shared/middleware/auth';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { idempotency } from '@shared/utils/idempotency';
import { cardsController } from './cards.controller';
import { orderPhysicalCardSchema, tokenizeCardSchema } from './cards.dto';

const router = Router();

router.get('/', authenticate('employee'), asyncHandler(cardsController.list));

router.post(
  '/physical',
  authenticate('employee'),
  idempotency,
  validate(orderPhysicalCardSchema),
  asyncHandler(cardsController.orderPhysical),
);

router.post(
  '/tokenize',
  authenticate('employee'),
  validate(tokenizeCardSchema),
  asyncHandler(cardsController.tokenize),
);

export default router;
