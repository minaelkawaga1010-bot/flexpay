import { Response, Router } from 'express';
import { z } from 'zod';
import { prisma } from '@config/prisma';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';

const registerSchema = z.object({ deviceToken: z.string().min(10) });

export class NotificationsController {
  public readonly router = Router();

  constructor() {
    this.router.use(authenticate('employee'));
    this.router.post('/register', validate(registerSchema), asyncHandler(this.register));
    this.router.post('/unregister', asyncHandler(this.unregister));
  }

  private register = async (req: AuthRequest, res: Response): Promise<void> => {
    await prisma.employee.update({
      where: { id: req.user!.id },
      data: { deviceToken: req.body.deviceToken, notificationsEnabled: true },
    });
    res.json({ message: 'Device registered' });
  };

  private unregister = async (req: AuthRequest, res: Response): Promise<void> => {
    await prisma.employee.update({
      where: { id: req.user!.id },
      data: { deviceToken: null, notificationsEnabled: false },
    });
    res.json({ message: 'Device unregistered' });
  };
}

export const notificationsController = new NotificationsController();
