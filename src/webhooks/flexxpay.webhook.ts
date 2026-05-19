import { Request, Response, Router } from 'express';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { asyncHandler } from '@shared/utils/asyncHandler';

export class FlexxPayWebhook {
  public readonly router = Router();

  constructor() {
    this.router.post('/status', asyncHandler(this.handleStatus));
  }

  private handleStatus = async (req: Request, res: Response): Promise<void> => {
    const { partnerReference, status, disbursedAmount, disbursementTxnId } = JSON.parse(
      (req.body as Buffer).toString('utf8'),
    ) as {
      partnerReference: string;
      status: string;
      disbursedAmount?: number;
      disbursementTxnId?: string;
    };

    const loan = await prisma.loan.findFirst({ where: { partnerReference } });
    if (!loan) {
      logger.warn('flexxpay webhook: unknown partnerReference', { partnerReference });
      res.status(202).json({ received: true });
      return;
    }

    const next: typeof loan.status =
      status === 'approved'
        ? 'APPROVED'
        : status === 'disbursed'
          ? 'ACTIVE'
          : status === 'repaid'
            ? 'REPAID'
            : status === 'defaulted'
              ? 'DEFAULTED'
              : status === 'rejected'
                ? 'REJECTED'
                : loan.status;

    await prisma.loan.update({
      where: { id: loan.id },
      data: {
        status: next,
        disbursedAmount: disbursedAmount ?? loan.disbursedAmount,
        disbursedAt: disbursedAmount ? new Date() : loan.disbursedAt,
        disbursementTxnId: disbursementTxnId ?? loan.disbursementTxnId,
      },
    });
    res.status(200).json({ received: true });
  };
}

export const flexxpayWebhook = new FlexxPayWebhook();
