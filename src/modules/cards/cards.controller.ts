import { Request, Response } from 'express';
import { cardsService } from './cards.service';
import { AuthRequest } from '@shared/middleware/auth';

export const cardsController = {
  async list(req: AuthRequest, res: Response): Promise<void> {
    const cards = await cardsService.listForEmployee(req.user!.id);
    res.json({ cards });
  },

  async orderPhysical(req: AuthRequest, res: Response): Promise<void> {
    const card = await cardsService.orderPhysicalCard(req.user!.id, req.body.address);
    res.status(201).json({ message: 'Physical card ordered', cardId: card.id, trackingNumber: null });
  },

  async tokenize(req: AuthRequest, res: Response): Promise<void> {
    const result = await cardsService.tokenize(req.user!.id, req.body.walletType);
    res.json(result);
  },
};

export type { Request };
