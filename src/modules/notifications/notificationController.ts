import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { authenticate, requireRole } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateBody } from '../../utils/validation';

const router = Router();

const registerSchema = z.object({
  deviceToken: z.string().min(10),
});

router.post(
  '/register',
  authenticate,
  requireRole('employee'),
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    await prisma.employee.update({
      where: { id: req.auth!.sub },
      data: { deviceToken: req.body.deviceToken },
    });
    res.json({ message: 'Device registered' });
  }),
);

router.post(
  '/unregister',
  authenticate,
  requireRole('employee'),
  asyncHandler(async (req, res) => {
    await prisma.employee.update({
      where: { id: req.auth!.sub },
      data: { deviceToken: null },
    });
    res.json({ message: 'Device unregistered' });
  }),
);

export default router;
