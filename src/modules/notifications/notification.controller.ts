import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@config/prisma';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';

const router = Router();

const registerSchema = z.object({ deviceToken: z.string().min(10) });

router.post(
  '/register',
  authenticate('employee'),
  validate(registerSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    await prisma.employee.update({
      where: { id: req.user!.id },
      data: { deviceToken: req.body.deviceToken, notificationsEnabled: true },
    });
    res.json({ message: 'Device registered' });
  }),
);

router.post(
  '/unregister',
  authenticate('employee'),
  asyncHandler(async (req: AuthRequest, res) => {
    await prisma.employee.update({
      where: { id: req.user!.id },
      data: { deviceToken: null, notificationsEnabled: false },
    });
    res.json({ message: 'Device unregistered' });
  }),
);

export default router;
