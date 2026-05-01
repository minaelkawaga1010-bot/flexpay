import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { env } from '@config/env';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { Unauthorized } from '@shared/utils/errors';

const router = Router();

function verifySignature(rawBody: Buffer, signature?: string): boolean {
  if (!env.MONEYHASH_WEBHOOK_SECRET) return true;
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', env.MONEYHASH_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

router.post(
  '/status',
  asyncHandler(async (req: Request, res: Response) => {
    if (!verifySignature(req.body, req.header('x-moneyhash-signature'))) {
      throw Unauthorized('Invalid webhook signature');
    }
    const payload = JSON.parse((req.body as Buffer).toString('utf8'));
    const { transferId, status } = payload;

    const tx = await prisma.employeeTransaction.findFirst({ where: { reference: transferId } });
    if (!tx) {
      logger.warn('moneyhash webhook: unknown transferId', { transferId });
      return res.sendStatus(202);
    }

    let newStatus: 'COMPLETED' | 'FAILED' | 'REVERSED' | 'PENDING' = 'PENDING';
    if (status === 'completed') newStatus = 'COMPLETED';
    else if (status === 'failed') newStatus = 'FAILED';
    else if (status === 'reversed') newStatus = 'REVERSED';

    await prisma.employeeTransaction.update({
      where: { id: tx.id },
      data: { status: newStatus, processedAt: new Date() },
    });

    res.sendStatus(200);
  }),
);

export default router;
