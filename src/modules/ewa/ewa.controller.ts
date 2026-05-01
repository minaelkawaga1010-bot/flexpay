import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@config/prisma';
import { env } from '@config/env';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { BadRequest, NotFound } from '@shared/utils/errors';
import { scoringService } from '@modules/scoring/scoring.service';
import { flexxPayService } from './flexxpay.service';

const router = Router();

const advanceSchema = z.object({
  amount: z.number().positive(),
  returnUrl: z.string().url().optional(),
});

router.post(
  '/request',
  authenticate('employee'),
  validate(advanceSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    const employee = await prisma.employee.findUnique({ where: { id: req.user!.id } });
    if (!employee) throw NotFound('Employee not found');

    const score = await scoringService.compute(req.user!.id);
    if (!score.eligibleForEWA) {
      throw BadRequest(`Credit score ${score.score} is below the minimum (60)`);
    }
    if (req.body.amount > score.maxEWAAmount) {
      throw BadRequest(`Requested amount exceeds your limit of AED ${score.maxEWAAmount}`);
    }

    const redirectUrl = await flexxPayService.createAdvanceRequest({
      employeeName: employee.fullName,
      employeePhone: employee.phone,
      amount: req.body.amount,
      employerId: employee.companyId,
      returnUrl: req.body.returnUrl ?? env.FLEXXPAY_REDIRECT_URL,
    });

    const loan = await prisma.loan.create({
      data: {
        employeeId: req.user!.id,
        type: 'EWA',
        principal: req.body.amount,
        termDays: 30,
        status: 'PENDING',
        partnerReference: redirectUrl,
      },
    });

    res.json({ redirectUrl, loanId: loan.id });
  }),
);

export default router;
