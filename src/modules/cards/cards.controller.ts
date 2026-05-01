import { Request, Response, Router } from 'express';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { idempotency } from '@shared/utils/idempotency';
import { cardsService } from './cards.service';
import { orderPhysicalCardSchema, tokenizeCardSchema } from './cards.dto';

export class CardsController {
  public readonly router = Router();

  constructor() {
    this.router.use(authenticate('employee'));
    this.router.get('/', asyncHandler(this.list));
    this.router.post(
      '/physical',
      idempotency,
      validate(orderPhysicalCardSchema),
      asyncHandler(this.orderPhysical),
    );
    this.router.post(
      '/tokenize',
      validate(tokenizeCardSchema),
      asyncHandler(this.tokenize),
    );
  }

  private list = async (req: AuthRequest, res: Response): Promise<void> => {
    const cards = await cardsService.listForEmployee(req.user!.id);
    res.json({ cards });
  };

  private orderPhysical = async (req: AuthRequest, res: Response): Promise<void> => {
    const card = await cardsService.orderPhysicalCard(req.user!.id, req.body.address);
    res.status(201).json({ message: 'Physical card ordered', cardId: card.id, trackingNumber: null });
  };

  private tokenize = async (req: AuthRequest, res: Response): Promise<void> => {
    const result = await cardsService.tokenize(req.user!.id, req.body.walletType);
    res.json(result);
  };
}

export const cardsController = new CardsController();
export type { Request };
