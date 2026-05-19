import { Request, Response, Router } from 'express';
import crypto from 'crypto';
import { env } from '@config/env';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { Unauthorized } from '@shared/utils/errors';

export class MoneyHashWebhook {
  public readonly router = Router();

  constructor() {
    this.router.post('/status', asyncHandler(this.handleStatus));
  }

  private verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
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

  private handleStatus = async (req: Request, res: Response): Promise<void> => {
    if (!this.verifySignature(req.body as Buffer, req.header('x-moneyhash-signature'))) {
      throw Unauthorized('INVALID_SIGNATURE');
    }
    const { transferId, status } = JSON.parse((req.body as Buffer).toString('utf8')) as {
      transferId: string;
      status: string;
    };

    const tx = await prisma.employeeTransaction.findFirst({ where: { reference: transferId } });
    if (!tx) {
      logger.warn('moneyhash webhook: unknown transferId', { transferId });
      res.status(202).json({ received: true });
      return;
    }

    const map: Record<string, 'COMPLETED' | 'FAILED' | 'REVERSED' | 'PENDING'> = {
      completed: 'COMPLETED',
      failed: 'FAILED',
      reversed: 'REVERSED',
      pending: 'PENDING',
    };
    const next = map[status] ?? 'PENDING';

    await prisma.employeeTransaction.update({
      where: { id: tx.id },
      data: { status: next, processedAt: new Date() },
    });
    res.status(200).json({ received: true });
  };
}

export const moneyhashWebhook = new MoneyHashWebhook();
