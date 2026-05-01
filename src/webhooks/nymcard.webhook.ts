import { Request, Response, Router } from 'express';
import { Prisma } from '@prisma/client';
import { env } from '@config/env';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { Unauthorized } from '@shared/utils/errors';
import { nymcardService } from '@modules/cards/nymcard.service';
import { cashbackService } from '@modules/cashback/cashback.service';
import { enqueueNotification } from '@modules/notifications/notification.job';

export class NymCardWebhook {
  public readonly router = Router();

  constructor() {
    this.router.post('/transaction', asyncHandler(this.handleTransaction));
    this.router.post('/shipping-update', asyncHandler(this.handleShippingUpdate));
    this.router.post('/card-status', asyncHandler(this.handleCardStatus));
  }

  // ----------------------------------------------------- Signature helper

  private verifySignature(req: Request): boolean {
    const sig = req.header(env.WEBHOOK_SIGNATURE_HEADER) ?? undefined;
    return nymcardService.verifyWebhookSignature(req.body as Buffer, sig);
  }

  private parseBody<T = Record<string, unknown>>(req: Request): T {
    return JSON.parse((req.body as Buffer).toString('utf8')) as T;
  }

  // -------------------------------------------------------- Transaction

  private handleTransaction = async (req: Request, res: Response): Promise<void> => {
    if (!this.verifySignature(req)) {
      throw Unauthorized('INVALID_SIGNATURE');
    }
    const payload = this.parseBody<{ type: string; data: Record<string, unknown> }>(req);

    if (payload.type === 'transaction.created' || payload.type === 'transaction.settled') {
      await this.processTransaction(payload.data);
    }
    res.status(200).json({ received: true });
  };

  private async processTransaction(data: Record<string, unknown>): Promise<void> {
    const cardId = String(data.cardId ?? '');
    const amount = Number(data.amount ?? 0);
    const currency = String(data.currency ?? 'AED');
    const merchantName = data.merchantName ? String(data.merchantName) : undefined;
    const merchantCategory = data.merchantCategory ? String(data.merchantCategory) : undefined;
    const status = String(data.status ?? '');
    const externalId = data.id ? String(data.id) : undefined;

    if (status !== 'SETTLED') return;

    const card = await prisma.card.findUnique({ where: { cardId } });
    if (!card) {
      logger.warn('NymCard webhook: unknown card', { cardId });
      return;
    }

    await prisma.employeeTransaction.create({
      data: {
        employeeId: card.employeeId,
        type: 'CARD_PURCHASE',
        // Negative because purchases are debits from the wallet ledger view.
        amount: -Math.abs(amount),
        fee: 0,
        totalAmount: -Math.abs(amount),
        currency,
        status: 'COMPLETED',
        description: merchantName,
        merchantName,
        merchantCategory,
        cardId: card.id,
        reference: externalId,
      } satisfies Prisma.EmployeeTransactionUncheckedCreateInput,
    });

    const employee = await prisma.employee.findUnique({
      where: { id: card.employeeId },
      select: { plan: true },
    });

    if (employee) {
      await cashbackService.processCashback({
        employeeId: card.employeeId,
        amount: Math.abs(amount),
        merchantCategory,
        plan: employee.plan,
      });
    }

    logger.info('NymCard transaction processed', {
      employeeId: card.employeeId,
      amount,
      merchant: merchantName,
    });
  }

  // ------------------------------------------------------ Shipping update

  private handleShippingUpdate = async (req: Request, res: Response): Promise<void> => {
    if (!this.verifySignature(req)) {
      throw Unauthorized('INVALID_SIGNATURE');
    }
    const { cardId, trackingNumber, status } = this.parseBody<{
      cardId: string;
      trackingNumber?: string;
      status: string;
    }>(req);

    const card = await prisma.card.findUnique({ where: { cardId } });
    if (!card) {
      res.status(202).json({ received: true });
      return;
    }

    await prisma.card.update({
      where: { id: card.id },
      data: { trackingNumber, shippingStatus: status },
    });

    if (trackingNumber) {
      await enqueueNotification({
        kind: 'tracking',
        employeeId: card.employeeId,
        trackingNumber,
      });
    }
    res.status(200).json({ received: true });
  };

  // ---------------------------------------------------------- Card status

  private handleCardStatus = async (req: Request, res: Response): Promise<void> => {
    if (!this.verifySignature(req)) {
      throw Unauthorized('INVALID_SIGNATURE');
    }
    const { cardId, status } = this.parseBody<{ cardId: string; status: string }>(req);
    const card = await prisma.card.findUnique({ where: { cardId } });
    if (!card) {
      res.status(202).json({ received: true });
      return;
    }
    const allowed: Record<string, 'ACTIVE' | 'INACTIVE' | 'BLOCKED' | 'EXPIRED' | 'REPLACED'> = {
      ACTIVE: 'ACTIVE',
      INACTIVE: 'INACTIVE',
      BLOCKED: 'BLOCKED',
      EXPIRED: 'EXPIRED',
      REPLACED: 'REPLACED',
    };
    const next = allowed[status.toUpperCase()] ?? card.status;
    await prisma.card.update({ where: { id: card.id }, data: { status: next } });
    res.status(200).json({ received: true });
  };
}

export const nymcardWebhook = new NymCardWebhook();
