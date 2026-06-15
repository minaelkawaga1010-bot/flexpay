import { Prisma } from '@prisma/client';
import { prisma } from '@config/prisma';
import { env } from '@config/env';
import { nymcardService } from './nymcard.service';
import { BadRequest, NotFound } from '@shared/utils/errors';
import { NymCardAddress, WalletType } from '@shared/types/nymcard';
import { assertWpsCompliantVehicle } from '@modules/wps-compliance/wps-payment-method';

/**
 * Card-issuance service.
 *
 * ─── Regulatory characterisation (CBUAE Universal Account framework) ──
 *
 * A FlexPay card — virtual or physical, NymCard-issued, Mastercard-
 * scheme — is a DOWNSTREAM SPEND INSTRUMENT linked to the worker's
 * SVF wallet. It is NEVER a WPS wage-receipt vehicle.
 *
 * The wage-receipt vehicle on a worker is one of:
 *   • UNIVERSAL_ACCOUNT  — CBUAE Universal Account
 *   • BANK_ACCOUNT       — licensed-bank account (IBAN-addressed)
 *   • SVF_WALLET         — Stored Value Facility wallet (e.g. NymCard
 *                          SVF licence; FlexPay as Program Manager)
 *
 * The legacy "salary card" / prepaid-card-as-payee model is deprecated
 * under the new CBUAE rules and is REFUSED at the schema level (the
 * `WageReceiptVehicle` enum does not include PREPAID_CARD) and at the
 * provisioning gate (`src/modules/wps-compliance/wps-payment-method.ts`,
 * `validateWpsPaymentMethod`).
 *
 * This service enforces the invariant at issuance time by calling
 * `assertWpsCompliantVehicle` BEFORE creating a card row. A worker
 * without an explicit, compliant wage-receipt classification cannot
 * receive a card on top of an unclassified wallet — the WPS payee
 * (the IBAN-addressed wallet) must exist first, and the card is
 * provisioned as a Mastercard-scheme spend handle on that wallet.
 *
 * Wire-shape contract:
 *   • WPS SIF settlement credits the SVF WALLET (the IBAN-addressed
 *     payee), not the card PAN. See `src/modules/payroll-ingestion/`.
 *   • Card authorisations (NymCard /authorize webhook) debit the
 *     wallet, never settle a wage payment. See
 *     `src/webhooks/nymcard-authorize.webhook.ts`.
 *   • Card refunds credit the wallet. The PAN is a routing handle,
 *     not a balance carrier.
 *
 * Audit cross-references:
 *   • `assertWpsCompliantVehicle` — the regulatory precondition.
 *   • `WageReceiptVehicle` enum — the schema-level seal that prevents
 *     PREPAID_CARD from ever appearing in the classification union.
 *   • `validateWpsPaymentMethod` — the provisioning-time gate that
 *     rejects raw `prepaid_card` strings on the boundary.
 */

export const cardsService = {
  /**
   * Auto-issue NymCard customer + virtual card for a freshly-created
   * employee. Idempotent: existing customer/card are returned.
   *
   * Precondition: the employee must already carry a compliant
   * wage-receipt-vehicle classification + licensed-entity backing.
   * Cards ride on the wallet; the wallet must exist first.
   */
  async issueVirtualCard(employeeId: string) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { cards: true },
    });
    if (!employee) throw NotFound('Employee not found');

    // CBUAE Universal Account gate. Cards are downstream of the
    // wallet — the wallet's classification + licensed-entity backing
    // must be set before we can provision the spend instrument.
    assertWpsCompliantVehicle({
      id: employee.id,
      wageReceiptVehicle: employee.wageReceiptVehicle,
      wpsLicensedEntity: employee.wpsLicensedEntity,
    });

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

    // Same WPS gate — physical issuance is downstream of the wallet
    // too. Refuse a physical card on an unclassified wallet.
    assertWpsCompliantVehicle({
      id: employee.id,
      wageReceiptVehicle: employee.wageReceiptVehicle,
      wpsLicensedEntity: employee.wpsLicensedEntity,
    });

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
          // JSON-normalize: strips `undefined` optional fields (which
          // Prisma.InputJsonValue rejects) and guarantees a JSON-safe
          // value at runtime — removing the `as unknown as` compiler
          // bypass while being structurally correct.
          shippingAddress: JSON.parse(JSON.stringify(address)) as Prisma.InputJsonValue,
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

  /**
   * Freeze (BLOCK) the named card for the calling employee.
   *
   * Atomic: the NymCard rail call happens BEFORE the local row update
   * so a rail failure leaves the local state unchanged. Idempotent on
   * already-BLOCKED rows (no rail call, no audit row).
   *
   * Ownership: we deliberately scope by `{ id: cardId, employeeId }`
   * — a worker cannot freeze a card they don't own even if the route
   * is hit with a guessed cardId.
   */
  async freezeCard(employeeId: string, cardId: string) {
    const card = await prisma.card.findFirst({ where: { id: cardId, employeeId } });
    if (!card) throw NotFound('Card not found');
    if (card.status === 'BLOCKED') return card;

    await nymcardService.blockCard(card.cardId);

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.card.update({
        where: { id: card.id },
        data: { status: 'BLOCKED' },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'employee',
          actorId: employeeId,
          action: 'CARD_FROZEN',
          resourceType: 'Card',
          resourceId: card.id,
          metadata: { nymcardId: card.cardId } as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
  },

  /**
   * Unfreeze (unblock) the named card. Idempotent on already-ACTIVE
   * rows. Returns the card row in its post-update state.
   *
   * Defence: we refuse to unfreeze cards whose status is EXPIRED or
   * REPLACED — those terminal states must be resolved by re-issuance,
   * not by a user-initiated unblock.
   */
  async unfreezeCard(employeeId: string, cardId: string) {
    const card = await prisma.card.findFirst({ where: { id: cardId, employeeId } });
    if (!card) throw NotFound('Card not found');
    if (card.status === 'ACTIVE') return card;
    if (card.status === 'EXPIRED' || card.status === 'REPLACED') {
      throw BadRequest('Card is in a terminal state and cannot be reactivated');
    }

    await nymcardService.unblockCard(card.cardId);

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.card.update({
        where: { id: card.id },
        data: { status: 'ACTIVE' },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'employee',
          actorId: employeeId,
          action: 'CARD_UNFROZEN',
          resourceType: 'Card',
          resourceId: card.id,
          metadata: { nymcardId: card.cardId } as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
  },

  /**
   * Reveal the full PAN + CVV for short-lived display in the mobile
   * app. The caller MUST have cleared the step-up-OTP gate via the
   * usual auth middleware; this method assumes a clean reveal
   * authorisation has already happened.
   *
   * SECURITY:
   *   • The PAN / CVV are NEVER persisted server-side beyond the
   *     audit-row write (which logs only the cardId, not the PAN).
   *   • The mobile client renders them in component-local state with
   *     an auto-clear timer; no Zustand / Keychain persistence.
   *   • Audit log captures the reveal — needed for chargeback /
   *     fraud-review traceability.
   */
  async revealCardDetails(employeeId: string, cardId: string) {
    const card = await prisma.card.findFirst({ where: { id: cardId, employeeId } });
    if (!card) throw NotFound('Card not found');
    if (card.status !== 'ACTIVE') {
      throw BadRequest('Card details can only be revealed when ACTIVE');
    }

    const { pan, cvv } = await nymcardService.getSensitiveCardDetails(card.cardId);

    await prisma.auditLog.create({
      data: {
        actorType: 'employee',
        actorId: employeeId,
        action: 'CARD_DETAILS_REVEALED',
        resourceType: 'Card',
        resourceId: card.id,
        // PAN / CVV deliberately omitted from the audit metadata —
        // the action itself is what's traceable, not the values.
        metadata: { nymcardId: card.cardId } as Prisma.InputJsonValue,
      },
    });

    return {
      pan,
      cvv,
      expiryMonth: card.expiryMonth,
      expiryYear: card.expiryYear,
    };
  },
};
