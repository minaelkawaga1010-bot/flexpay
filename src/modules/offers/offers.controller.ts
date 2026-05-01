import { Response } from 'express';
import { AuthRequest } from '@shared/middleware/auth';
import { offersService } from './offers.service';

export const offersController = {
  async list(_req: AuthRequest, res: Response): Promise<void> {
    const offers = await offersService.listActive();
    res.json({ offers });
  },

  async click(req: AuthRequest, res: Response): Promise<void> {
    const link = await offersService.recordClick(
      req.params.offerId,
      req.user!.id,
      req.ip,
      req.header('user-agent') ?? undefined,
    );
    res.redirect(302, link);
  },

  async create(req: AuthRequest, res: Response): Promise<void> {
    const offer = await offersService.create(req.body);
    res.status(201).json({ offer });
  },

  async update(req: AuthRequest, res: Response): Promise<void> {
    const offer = await offersService.update(req.params.id, req.body);
    res.json({ offer });
  },

  async deactivate(req: AuthRequest, res: Response): Promise<void> {
    await offersService.deactivate(req.params.id);
    res.status(204).send();
  },
};
