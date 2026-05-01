import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '@shared/middleware/auth';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { offersController } from './offers.controller';

const router = Router();

router.get('/', authenticate('employee'), asyncHandler(offersController.list));
router.post('/:offerId/click', authenticate('employee'), asyncHandler(offersController.click));

const offerSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  discountPercentage: z.number().int().min(1).max(100),
  merchant: z.string().min(2),
  affiliateLink: z.string().url(),
  imageUrl: z.string().url().optional(),
  expiresAt: z.coerce.date(),
});

router.post('/admin', authenticate('admin'), validate(offerSchema), asyncHandler(offersController.create));
router.put(
  '/admin/:id',
  authenticate('admin'),
  validate(offerSchema.partial().extend({ isActive: z.boolean().optional() })),
  asyncHandler(offersController.update),
);
router.delete('/admin/:id', authenticate('admin'), asyncHandler(offersController.deactivate));

export default router;
