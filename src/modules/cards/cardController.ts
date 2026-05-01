import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateBody } from '../../utils/validation';
import { cardService } from './cardService';

const router = Router();

const physicalCardSchema = z.object({
  address: z.object({
    street: z.string().min(1),
    city: z.string().min(1),
    country: z.string().min(2),
    postalCode: z.string().min(1),
  }),
});

const tokenizeSchema = z.object({
  walletType: z.enum(['APPLE_PAY', 'GOOGLE_PAY']),
});

router.post(
  '/physical',
  authenticate,
  requireRole('employee'),
  validateBody(physicalCardSchema),
  asyncHandler(async (req, res) => {
    const order = await cardService.orderPhysicalCard(req.auth!.sub, req.body.address);
    res.json({ message: 'Physical card ordered', orderId: order.orderId, trackingNumber: null });
  }),
);

router.post(
  '/tokenize',
  authenticate,
  requireRole('employee'),
  validateBody(tokenizeSchema),
  asyncHandler(async (req, res) => {
    const result = await cardService.tokenize(req.auth!.sub, req.body.walletType);
    res.json(result);
  }),
);

export default router;
