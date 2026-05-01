import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import { Address, nymcardService, WalletType } from '../../services/nymcardService';
import { BadRequest, NotFound } from '../../utils/errors';

const PHYSICAL_CARD_FEE = 30;

export const cardService = {
  /**
   * Provision a NymCard customer + virtual card for a freshly-created employee.
   * Safe to call multiple times: existing customer is reused.
   */
  async issueVirtualCard(employeeId: string): Promise<{ last4: string; expiry: Date }> {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw NotFound('Employee not found');

    let customerId = employee.nymcardCustomerId;
    if (!customerId) {
      const customer = await nymcardService.createCustomer(
        employee.fullName,
        employee.email ?? `${employee.phone}@flexpay.ae`,
        employee.phone,
      );
      customerId = customer.id;
    }

    const card = await nymcardService.issueVirtualCard(customerId);
    const expiry = new Date(card.expiry);
    await prisma.employee.update({
      where: { id: employeeId },
      data: {
        nymcardCustomerId: customerId,
        virtualCardId: card.cardId,
        virtualCardLast4: card.last4,
        virtualCardExpiry: expiry,
      },
    });

    return { last4: card.last4, expiry };
  },

  async orderPhysicalCard(employeeId: string, address: Address): Promise<{ orderId: string }> {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw NotFound('Employee not found');
    if (!employee.nymcardCustomerId) {
      throw BadRequest('Virtual card must be issued before ordering a physical card');
    }
    if (employee.walletBalance < PHYSICAL_CARD_FEE) {
      throw BadRequest(`Insufficient balance. Physical card fee is AED ${PHYSICAL_CARD_FEE}.`);
    }

    const order = await nymcardService.issuePhysicalCard(employee.nymcardCustomerId, address);

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.employee.update({
        where: { id: employeeId },
        data: { walletBalance: { decrement: PHYSICAL_CARD_FEE }, physicalCardStatus: 'ORDERED' },
      });
      await tx.employeeTransaction.create({
        data: {
          employeeId,
          type: 'CARD_FEE',
          amount: PHYSICAL_CARD_FEE,
          totalAmount: PHYSICAL_CARD_FEE,
          status: 'COMPLETED',
          description: 'Physical card issuance fee',
          reference: order.orderId,
        },
      });
    });

    return order;
  },

  async tokenize(employeeId: string, walletType: WalletType): Promise<{ token: string }> {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee?.virtualCardId) throw BadRequest('No card to tokenize');
    return nymcardService.tokenizeCard(employee.virtualCardId, walletType);
  },
};
