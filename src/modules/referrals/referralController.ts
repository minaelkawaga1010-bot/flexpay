import { Router } from 'express';
import { prisma } from '../../config/db';
import { authenticate, requireRole } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { NotFound } from '../../utils/errors';

const router = Router();

router.get(
  '/my-code',
  authenticate,
  requireRole('employee'),
  asyncHandler(async (req, res) => {
    const employee = await prisma.employee.findUnique({
      where: { id: req.auth!.sub },
      select: { referralCode: true },
    });
    if (!employee) throw NotFound('Employee not found');
    res.json({ referralCode: employee.referralCode });
  }),
);

router.get(
  '/history',
  authenticate,
  requireRole('employee'),
  asyncHandler(async (req, res) => {
    const referrals = await prisma.referral.findMany({
      where: { referrerId: req.auth!.sub },
      orderBy: { createdAt: 'desc' },
      include: {
        referee: { select: { fullName: true, phone: true, createdAt: true } },
      },
    });
    res.json({ referrals });
  }),
);

export default router;
