/**
 * Virtual Card Cleanup — CBUAE Universal Account framework.
 *
 * Pins two invariants of the cleanup:
 *
 *   1. card-routing.ts — cards are SPEND INSTRUMENTS linked to the
 *      SVF wallet; they are NEVER a WPS payee. The runtime guard
 *      `assertNotWpsPayee` refuses every card-shaped classifier on
 *      the boundary, and the type-level seal
 *      `_WPS_VEHICLE_HAS_NO_CARD_VARIANTS` makes a schema drift that
 *      adds a card variant to WageReceiptVehicle a build error.
 *
 *   2. cards.service.ts — `issueVirtualCard` and `orderPhysicalCard`
 *      refuse to provision a spend instrument on a wallet that has
 *      no compliant `wageReceiptVehicle` + `wpsLicensedEntity`
 *      classification. The wallet must exist (and be WPS-classified)
 *      before the card on top of it.
 */

jest.mock('@config/prisma', () => {
  const tx = {
    employee: { update: jest.fn() },
    card: { create: jest.fn() },
    employeeTransaction: { create: jest.fn() },
  };
  return {
    prisma: {
      employee: { findUnique: jest.fn() },
      card: { findFirst: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  };
});

jest.mock('@modules/cards/nymcard.service', () => ({
  nymcardService: {
    createCustomer: jest.fn().mockResolvedValue({ id: 'cust-1' }),
    issueVirtualCard: jest.fn().mockResolvedValue({
      cardId: 'nym-card-1',
      last4: '4242',
      brand: 'VISA',
      expiryMonth: 12,
      expiryYear: 2030,
    }),
    issuePhysicalCard: jest.fn().mockResolvedValue({
      orderId: 'order-1',
      card: {
        cardId: 'nym-card-2',
        last4: '5252',
        brand: 'VISA',
        expiryMonth: 12,
        expiryYear: 2030,
      },
    }),
  },
}));

import { CardType, WageReceiptVehicle } from '@prisma/client';
import { prisma } from '@config/prisma';
import { cardsService } from '../src/modules/cards/cards.service';
import {
  CardAsWpsPayeeError,
  asSpendInstrument,
  assertNotWpsPayee,
  cardSpendsAgainstWallet,
  isCardRoutingAttempt,
  _WPS_VEHICLE_HAS_NO_CARD_VARIANTS,
} from '../src/modules/cards/card-routing';

const mocked = prisma as unknown as {
  employee: { findUnique: jest.Mock };
  card: { findFirst: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
  __tx: {
    employee: { update: jest.Mock };
    card: { create: jest.Mock };
    employeeTransaction: { create: jest.Mock };
  };
};

beforeEach(() => {
  jest.clearAllMocks();
});

function compliantEmployee(over: Record<string, unknown> = {}) {
  return {
    id: 'emp-1',
    fullName: 'Worker',
    phone: '+971500000000',
    email: 'w@x.test',
    walletBalance: 1000,
    nymcardCustomerId: null,
    wageReceiptVehicle: WageReceiptVehicle.SVF_WALLET,
    wpsLicensedEntity: 'NYMCARD_SVF',
    cards: [],
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════
// card-routing.ts — runtime guard
// ═══════════════════════════════════════════════════════════════════

describe('isCardRoutingAttempt', () => {
  it.each(['prepaid_card', 'virtual_card', 'physical_card', 'card', 'VIRTUAL', 'PHYSICAL'])(
    'flags %s as a card routing attempt',
    (raw) => {
      expect(isCardRoutingAttempt(raw)).toBe(true);
    },
  );

  it('does not flag a legitimate wage-receipt vehicle string', () => {
    expect(isCardRoutingAttempt('universal_account')).toBe(false);
    expect(isCardRoutingAttempt('bank_account')).toBe(false);
    expect(isCardRoutingAttempt('svf_wallet')).toBe(false);
  });
});

describe('assertNotWpsPayee', () => {
  it('throws CardAsWpsPayeeError on a prepaid_card boundary string', () => {
    expect(() => assertNotWpsPayee('prepaid_card')).toThrow(CardAsWpsPayeeError);
    try {
      assertNotWpsPayee('prepaid_card');
    } catch (e) {
      expect((e as CardAsWpsPayeeError).code).toBe('WPS_PAYEE_IS_WALLET_NOT_CARD');
      expect((e as CardAsWpsPayeeError).status).toBe(422);
    }
  });

  it('throws on a CardType enum value passed as a payee string', () => {
    expect(() => assertNotWpsPayee(CardType.VIRTUAL)).toThrow(CardAsWpsPayeeError);
  });

  it('passes for a legitimate wage-receipt vehicle string', () => {
    expect(() => assertNotWpsPayee('svf_wallet')).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════
// card-routing.ts — type-level seal
// ═══════════════════════════════════════════════════════════════════

describe('type-level seal', () => {
  it('exports the WPS-vehicle-has-no-card-variants assertion as true', () => {
    // If a future schema change adds VIRTUAL/PHYSICAL/PREPAID_CARD to
    // WageReceiptVehicle, this exported value's type narrows from
    // `true` to `never` and the build breaks. At runtime we sanity-
    // check it is the boolean true.
    expect(_WPS_VEHICLE_HAS_NO_CARD_VARIANTS).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// card-routing.ts — brand
// ═══════════════════════════════════════════════════════════════════

describe('asSpendInstrument', () => {
  it('brands a card reference so it cannot be mistaken for a wage-receipt vehicle', () => {
    const ref = asSpendInstrument({
      cardType: CardType.VIRTUAL,
      cardId: 'nym-1',
      walletEmployeeId: 'emp-1',
    });
    expect(ref.cardType).toBe(CardType.VIRTUAL);
    expect(ref.cardId).toBe('nym-1');
    expect(ref.walletEmployeeId).toBe('emp-1');
  });
});

describe('cardSpendsAgainstWallet', () => {
  it('returns the wallet employee id unchanged (identity at runtime, type-asserting at compile)', () => {
    expect(cardSpendsAgainstWallet('emp-42')).toBe('emp-42');
  });
});

// ═══════════════════════════════════════════════════════════════════
// cards.service — issueVirtualCard WPS gate
// ═══════════════════════════════════════════════════════════════════

describe('cardsService.issueVirtualCard — WPS gate', () => {
  it('refuses to provision a card when wageReceiptVehicle is null', async () => {
    mocked.employee.findUnique.mockResolvedValue(
      compliantEmployee({ wageReceiptVehicle: null }),
    );
    await expect(cardsService.issueVirtualCard('emp-1')).rejects.toMatchObject({
      code: 'WPS_VEHICLE_NOT_CLASSIFIED',
    });
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to provision a card when wpsLicensedEntity is empty', async () => {
    mocked.employee.findUnique.mockResolvedValue(
      compliantEmployee({ wpsLicensedEntity: '' }),
    );
    await expect(cardsService.issueVirtualCard('emp-1')).rejects.toMatchObject({
      code: 'WPS_LICENSED_ENTITY_MISSING',
    });
  });

  it('proceeds when the wallet is compliantly classified (happy path)', async () => {
    mocked.employee.findUnique.mockResolvedValue(compliantEmployee());
    mocked.__tx.card.create.mockResolvedValue({
      id: 'c-internal-1',
      type: 'VIRTUAL',
      cardId: 'nym-card-1',
    });
    mocked.__tx.employee.update.mockResolvedValue({});

    const out = await cardsService.issueVirtualCard('emp-1');
    expect(out.cardId).toBe('nym-card-1');
    expect(mocked.$transaction).toHaveBeenCalledTimes(1);
  });

  it('is idempotent when a virtual card already exists (returns it without touching NymCard)', async () => {
    mocked.employee.findUnique.mockResolvedValue(
      compliantEmployee({
        cards: [{ id: 'c-existing', type: 'VIRTUAL', cardId: 'nym-existing' }],
      }),
    );

    const out = await cardsService.issueVirtualCard('emp-1');
    expect(out).toMatchObject({ id: 'c-existing', cardId: 'nym-existing' });
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// cards.service — orderPhysicalCard WPS gate
// ═══════════════════════════════════════════════════════════════════

describe('cardsService.orderPhysicalCard — WPS gate', () => {
  const address = {
    line1: '123 Sheikh Zayed Rd',
    city: 'Dubai',
    emirate: 'Dubai',
    country: 'AE',
  } as any;

  it('refuses when the wallet has no wage-receipt classification', async () => {
    mocked.employee.findUnique.mockResolvedValue(
      compliantEmployee({
        nymcardCustomerId: 'cust-1',
        wageReceiptVehicle: null,
      }),
    );
    await expect(cardsService.orderPhysicalCard('emp-1', address)).rejects.toMatchObject({
      code: 'WPS_VEHICLE_NOT_CLASSIFIED',
    });
  });

  it('refuses on missing wpsLicensedEntity', async () => {
    mocked.employee.findUnique.mockResolvedValue(
      compliantEmployee({
        nymcardCustomerId: 'cust-1',
        wpsLicensedEntity: '',
      }),
    );
    await expect(cardsService.orderPhysicalCard('emp-1', address)).rejects.toMatchObject({
      code: 'WPS_LICENSED_ENTITY_MISSING',
    });
  });
});
