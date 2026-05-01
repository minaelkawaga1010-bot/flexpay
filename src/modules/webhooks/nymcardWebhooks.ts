import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../../config/db';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { asyncHandler } from '../../middleware/asyncHandler';
import { cashbackService } from '../cashback/cashbackService';
import { notificationService } from '../../services/notificationService';
import { Unauthorized } from '../../utils/errors';

const router = Router();

/**
 * Verify the X-NymCard-Signature header is `sha256=hex(hmac(secret, rawBody))`.
 * If no secret is configured (dev/test), verification is skipped.
 */
function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!env.nymcard.webhookSecret) return true;
  if (!signatureHeader) return false;
  const [scheme, sig] = signatureHeader.split('=');
  if (scheme !== 'sha256' || !sig) return false;
  const expected = crypto.createHmac('sha256', env.nymcard.webhookSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

router.post(
  '/transaction',
  asyncHandler(async (req, res) => {
    if (!verifySignature(req.body, req.header('x-nymcard-signature'))) {
      throw Unauthorized('Invalid webhook signature');
    }
    const payload = JSON.parse(req.body.toString('utf8'));
    const { amount, employeeId, cardId, merchantCategory } = payload;

    let resolvedEmployeeId = employeeId;
    if (!resolvedEmployeeId && cardId) {
      const employee = await prisma.employee.findUnique({ where: { virtualCardId: cardId } });
      resolvedEmployeeId = employee?.id;
    }
    if (!resolvedEmployeeId) {
      logger.warn({ payload }, 'nymcard transaction webhook: unknown employee');
      return res.sendStatus(202);
    }

    await cashbackService.credit(resolvedEmployeeId, amount, merchantCategory ?? 'GENERAL');
    res.sendStatus(200);
  }),
);

router.post(
  '/shipping-update',
  asyncHandler(async (req, res) => {
    if (!verifySignature(req.body, req.header('x-nymcard-signature'))) {
      throw Unauthorized('Invalid webhook signature');
    }
    const payload = JSON.parse(req.body.toString('utf8'));
    const { cardId, trackingNumber, status } = payload;
    const employee = await prisma.employee.findUnique({ where: { virtualCardId: cardId } });
    if (!employee) return res.sendStatus(202);
    await prisma.employee.update({
      where: { id: employee.id },
      data: { physicalCardTracking: trackingNumber, physicalCardStatus: status },
    });
    if (trackingNumber) {
      await notificationService.notifyTrackingNumber(employee.id, trackingNumber);
    }
    res.sendStatus(200);
  }),
);

export default router;
