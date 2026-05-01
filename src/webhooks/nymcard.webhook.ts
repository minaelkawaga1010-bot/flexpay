import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { env } from '@config/env';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { Unauthorized } from '@shared/utils/errors';
import { cashbackService } from '@modules/cashback/cashback.service';
import { notificationService } from '@modules/notifications/notification.service';

const router = Router();

function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!env.NYMCARD_WEBHOOK_SECRET) return true;
  if (!signatureHeader) return false;
  const [scheme, sig] = signatureHeader.split('=');
  if (scheme !== 'sha256' || !sig) return false;
  const expected = crypto
    .createHmac('sha256', env.NYMCARD_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

router.post(
  '/transaction',
  asyncHandler(async (req: Request, res: Response) => {
    if (!verifySignature(req.body, req.header(env.WEBHOOK_SIGNATURE_HEADER))) {
      throw Unauthorized('Invalid webhook signature');
    }
    const payload = JSON.parse((req.body as Buffer).toString('utf8'));
    const { amount, cardId, merchantCategory, merchantName } = payload;

    const card = await prisma.card.findUnique({ where: { cardId } });
    if (!card) {
      logger.warn('nymcard transaction webhook: unknown card', { cardId });
      return res.sendStatus(202);
    }

    await prisma.employeeTransaction.create({
      data: {
        employeeId: card.employeeId,
        type: 'CARD_PURCHASE',
        amount,
        totalAmount: amount,
        status: 'COMPLETED',
        description: `Purchase at ${merchantName}`,
        reference: payload.transactionId,
        merchantName,
        merchantCategory,
        cardId: card.id,
      },
    });

    await cashbackService.credit(card.employeeId, amount, merchantCategory ?? 'GENERAL');
    res.sendStatus(200);
  }),
);

router.post(
  '/shipping-update',
  asyncHandler(async (req: Request, res: Response) => {
    if (!verifySignature(req.body, req.header(env.WEBHOOK_SIGNATURE_HEADER))) {
      throw Unauthorized('Invalid webhook signature');
    }
    const payload = JSON.parse((req.body as Buffer).toString('utf8'));
    const { cardId, trackingNumber, status } = payload;

    const card = await prisma.card.findUnique({ where: { cardId } });
    if (!card) return res.sendStatus(202);

    await prisma.card.update({
      where: { id: card.id },
      data: { trackingNumber, shippingStatus: status },
    });
    if (trackingNumber) {
      await notificationService.notifyTrackingNumber(card.employeeId, trackingNumber);
    }
    res.sendStatus(200);
  }),
);

export default router;
