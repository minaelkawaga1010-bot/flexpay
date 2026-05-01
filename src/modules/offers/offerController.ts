import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateBody } from '../../utils/validation';
import { offerService } from './offerService';

const router = Router();

router.get(
  '/',
  authenticate,
  requireRole('employee'),
  asyncHandler(async (_req, res) => {
    const offers = await offerService.listActive();
    res.json({ offers });
  }),
);

router.post(
  '/:offerId/click',
  authenticate,
  requireRole('employee'),
  asyncHandler(async (req, res) => {
    const link = await offerService.recordClick(req.params.offerId, req.auth!.sub, req.ip);
    res.redirect(302, link);
  }),
);

const offerSchema = z.object({
  title: z.string().min(2),
  description: z.string().min(2),
  discountPercentage: z.number().int().min(1).max(100),
  merchant: z.string().min(2),
  affiliateLink: z.string().url(),
  imageUrl: z.string().url().optional(),
  expiresAt: z.coerce.date(),
});

router.post(
  '/admin',
  authenticate,
  requireRole('admin'),
  validateBody(offerSchema),
  asyncHandler(async (req, res) => {
    const offer = await offerService.create(req.body);
    res.status(201).json({ offer });
  }),
);

router.put(
  '/admin/:id',
  authenticate,
  requireRole('admin'),
  validateBody(offerSchema.partial().extend({ isActive: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const offer = await offerService.update(req.params.id, req.body);
    res.json({ offer });
  }),
);

router.delete(
  '/admin/:id',
  authenticate,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    await offerService.remove(req.params.id);
    res.status(204).send();
  }),
);

export default router;
