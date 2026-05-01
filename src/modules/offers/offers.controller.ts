import { Response, Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { offersService } from './offers.service';

const offerSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  discountPercentage: z.number().int().min(1).max(100),
  merchant: z.string().min(2),
  affiliateLink: z.string().url(),
  imageUrl: z.string().url().optional(),
  expiresAt: z.coerce.date(),
});

export class OffersController {
  public readonly router = Router();

  constructor() {
    this.router.get('/', authenticate('employee'), asyncHandler(this.list));
    this.router.post('/:offerId/click', authenticate('employee'), asyncHandler(this.click));
    this.router.post(
      '/admin',
      authenticate('admin'),
      validate(offerSchema),
      asyncHandler(this.create),
    );
    this.router.put(
      '/admin/:id',
      authenticate('admin'),
      validate(offerSchema.partial().extend({ isActive: z.boolean().optional() })),
      asyncHandler(this.update),
    );
    this.router.delete('/admin/:id', authenticate('admin'), asyncHandler(this.deactivate));
  }

  private list = async (_req: AuthRequest, res: Response): Promise<void> => {
    res.json({ offers: await offersService.listActive() });
  };

  private click = async (req: AuthRequest, res: Response): Promise<void> => {
    const link = await offersService.recordClick(
      req.params.offerId,
      req.user!.id,
      req.ip,
      req.header('user-agent') ?? undefined,
    );
    res.redirect(302, link);
  };

  private create = async (req: AuthRequest, res: Response): Promise<void> => {
    res.status(201).json({ offer: await offersService.create(req.body) });
  };

  private update = async (req: AuthRequest, res: Response): Promise<void> => {
    res.json({ offer: await offersService.update(req.params.id, req.body) });
  };

  private deactivate = async (req: AuthRequest, res: Response): Promise<void> => {
    await offersService.deactivate(req.params.id);
    res.status(204).send();
  };
}

export const offersController = new OffersController();
