import { Router, Request, Response } from 'express';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { asyncHandler } from '@shared/utils/asyncHandler';

const router = Router();

router.post(
  '/status',
  asyncHandler(async (req: Request, res: Response) => {
    const payload = JSON.parse((req.body as Buffer).toString('utf8'));
    const { partnerReference, status, disbursedAmount, disbursementTxnId } = payload;

    const loan = await prisma.loan.findFirst({ where: { partnerReference } });
    if (!loan) {
      logger.warn('flexxpay webhook: unknown partnerReference', { partnerReference });
      return res.sendStatus(202);
    }

    let newStatus = loan.status;
    if (status === 'approved') newStatus = 'APPROVED';
    else if (status === 'disbursed') newStatus = 'ACTIVE';
    else if (status === 'repaid') newStatus = 'REPAID';
    else if (status === 'defaulted') newStatus = 'DEFAULTED';
    else if (status === 'rejected') newStatus = 'REJECTED';

    await prisma.loan.update({
      where: { id: loan.id },
      data: {
        status: newStatus,
        disbursedAmount: disbursedAmount ?? loan.disbursedAmount,
        disbursedAt: disbursedAmount ? new Date() : loan.disbursedAt,
        disbursementTxnId: disbursementTxnId ?? loan.disbursementTxnId,
      },
    });

    res.sendStatus(200);
  }),
);

export default router;
