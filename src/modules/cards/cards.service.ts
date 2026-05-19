import { Prisma } from '@prisma/client';
import { prisma } from '@config/prisma';
import { env } from '@config/env';
import { nymcardService } from './nymcard.service';
import { BadRequest, NotFound } from '@shared/utils/errors';
import { NymCardAddress, WalletType } from '@shared/types/nymcard';

export const cardsService = {
  /**
   * Auto-issue NymCard customer + virtual card for a freshly-created
   * employee. Idempotent: existing customer/card are returned.
   */
  async issueVirtualCard(employeeId: string) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { cards: true },
    });
    if (!employee) throw NotFound('Employee not found');

    const existingVirtual = employee.cards.find((c) => c.type === 'VIRTUAL');
    if (existingVirtual) return existingVirtual;

    let customerId = employee.nymcardCustomerId;
    if (!customerId) {
      const customer = await nymcardService.createCustomer({
        name: employee.fullName,
        email: employee.email ?? `${employee.phone}@flexpay.ae`,
        phone: employee.phone,
      });
      customerId = customer.id;
    }

    const issued = await nymcardService.issueVirtualCard(customerId);

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.employee.update({
        where: { id: employeeId },
        data: { nymcardCustomerId: customerId },
      });
      return tx.card.create({
        data: {
          cardId: issued.cardId,
          customerId,
          type: 'VIRTUAL',
          last4: issued.last4,
          brand: issued.brand,
          expiryMonth: issued.expiryMonth,
          expiryYear: issued.expiryYear,
          employeeId,
        },
      });
    });
  },

  async orderPhysicalCard(employeeId: string, address: NymCardAddress) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { cards: true },
    });
    if (!employee) throw NotFound('Employee not found');
    if (!employee.nymcardCustomerId) {
      throw BadRequest('Virtual card must be issued before ordering a physical card');
    }
    if (employee.walletBalance < env.PHYSICAL_CARD_FEE) {
      throw BadRequest(`Insufficient balance. Physical card fee is AED ${env.PHYSICAL_CARD_FEE}.`);
    }

    const result = await nymcardService.issuePhysicalCard(employee.nymcardCustomerId, address);

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.employee.update({
        where: { id: employeeId },
        data: { walletBalance: { decrement: env.PHYSICAL_CARD_FEE } },
      });
      await tx.employeeTransaction.create({
        data: {
          employeeId,
          type: 'FEE',
          amount: env.PHYSICAL_CARD_FEE,
          totalAmount: env.PHYSICAL_CARD_FEE,
          status: 'COMPLETED',
          description: 'Physical card issuance fee',
          reference: result.orderId,
        },
      });
      return tx.card.create({
        data: {
          cardId: result.card.cardId,
          customerId: employee.nymcardCustomerId!,
          type: 'PHYSICAL',
          last4: result.card.last4,
          brand: result.card.brand,
          expiryMonth: result.card.expiryMonth,
          expiryYear: result.card.expiryYear,
          shippingAddress: address as unknown as Prisma.InputJsonValue,
          shippingStatus: 'PENDING',
          employeeId,
        },
      });
    });
  },

  async tokenize(employeeId: string, walletType: WalletType) {
    const card = await prisma.card.findFirst({
      where: { employeeId, type: 'VIRTUAL', status: 'ACTIVE' },
    });
    if (!card) throw BadRequest('No active virtual card to tokenize');

    const { token } = await nymcardService.tokenizeCard(card.cardId, walletType);
    await prisma.card.update({
      where: { id: card.id },
      data:
        walletType === 'APPLE_PAY'
          ? { applePayToken: token }
          : { googlePayToken: token },
    });
    return { token };
  },

  async listForEmployee(employeeId: string) {
    return prisma.card.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        status: true,
        last4: true,
        brand: true,
        expiryMonth: true,
        expiryYear: true,
        shippingStatus: true,
        trackingNumber: true,
        createdAt: true,
      },
    });
  },
};
