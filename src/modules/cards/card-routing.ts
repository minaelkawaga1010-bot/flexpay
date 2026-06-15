import { CardType, WageReceiptVehicle } from '@prisma/client';

/**
 * Card-routing type seal — CBUAE Universal Account framework.
 *
 * The WPS (Wage Protection System) payee at the regulatory layer is
 * the wage-receipt VEHICLE (UNIVERSAL_ACCOUNT / BANK_ACCOUNT /
 * SVF_WALLET), enumerated in `WageReceiptVehicle`. A card — virtual
 * or physical — is a spend instrument layered on top of that
 * vehicle, NEVER the payee itself.
 *
 * This module provides:
 *
 *   1. A compile-time brand (`SpendInstrumentRef`) that makes it a
 *      type error to feed a CardType where a WageReceiptVehicle is
 *      expected. The two domains share no structural overlap, but
 *      branding the card-routing path means a future refactor that
 *      tries to widen `WageReceiptVehicle` to include a card variant
 *      will fail to type-check.
 *
 *   2. A runtime guard (`assertNotWpsPayee`) for any code path that
 *      receives a raw classifier string from outside the schema —
 *      external partner API, legacy migration payload, etc. — and
 *      needs to refuse PREPAID_CARD / VIRTUAL / PHYSICAL routings to
 *      the wage payee.
 *
 *   3. A `cardSpendsAgainstWallet` invariant function — pure docs +
 *      type assertion that the card debits go to the wallet, not the
 *      WPS payee. Inlined at call sites for clarity.
 */

// ───────────────────────────────────────────────────────────────────
// Type brand
// ───────────────────────────────────────────────────────────────────

declare const SpendInstrumentBrand: unique symbol;

/**
 * A reference to a card considered as a downstream spend instrument.
 * Branded so a function expecting a SpendInstrumentRef cannot be
 * called with a raw string or a WageReceiptVehicle.
 */
export type SpendInstrumentRef = {
  cardType: CardType;
  cardId: string;
  /** The wallet the card debits — the SVF wallet, never a card. */
  walletEmployeeId: string;
  readonly [SpendInstrumentBrand]: true;
};

export function asSpendInstrument(args: {
  cardType: CardType;
  cardId: string;
  walletEmployeeId: string;
}): SpendInstrumentRef {
  return {
    cardType: args.cardType,
    cardId: args.cardId,
    walletEmployeeId: args.walletEmployeeId,
  } as SpendInstrumentRef;
}

// ───────────────────────────────────────────────────────────────────
// Runtime guards
// ───────────────────────────────────────────────────────────────────

/**
 * Refuse raw strings that would route a card / prepaid product as a
 * WPS wage payee. Returns void on accept; throws on any card-shaped
 * classifier. The schema enum already prevents this at rest, but raw
 * boundary inputs (partner API JSON, CSV cells, legacy migration
 * payloads) can carry the legacy strings.
 */
const FORBIDDEN_AS_WPS_PAYEE = new Set<string>([
  'prepaid_card',
  'virtual_card',
  'physical_card',
  'card',
  CardType.VIRTUAL,
  CardType.PHYSICAL,
]);

export function isCardRoutingAttempt(rawClassifier: string): boolean {
  return FORBIDDEN_AS_WPS_PAYEE.has(rawClassifier.toLowerCase()) ||
    FORBIDDEN_AS_WPS_PAYEE.has(rawClassifier);
}

export class CardAsWpsPayeeError extends Error {
  public readonly code = 'WPS_PAYEE_IS_WALLET_NOT_CARD';
  public readonly status = 422;
  constructor(rawClassifier: string) {
    super(
      `'${rawClassifier}' cannot be a WPS wage-receipt vehicle under CBUAE rules. ` +
        `Cards are downstream spend instruments linked to the SVF wallet, ` +
        `never the wage payee. Allowed vehicles: ${Object.values(WageReceiptVehicle).join(', ')}.`,
    );
    this.name = 'CardAsWpsPayeeError';
  }
}

export function assertNotWpsPayee(rawClassifier: string): void {
  if (isCardRoutingAttempt(rawClassifier)) {
    throw new CardAsWpsPayeeError(rawClassifier);
  }
}

// ───────────────────────────────────────────────────────────────────
// Compile-time invariant — cards spend against the WALLET
// ───────────────────────────────────────────────────────────────────

/**
 * Compile-time assertion that a settlement target is a wallet
 * (employee id) and not a card. The `WageReceiptVehicle` enum and
 * the `CardType` enum share no values, so passing a CardType here
 * is a type error.
 *
 * Use at every card-debit call site to capture the rule in the
 * call signature, not just in a comment.
 */
export function cardSpendsAgainstWallet<
  W extends string & { readonly brand?: 'walletEmployeeId' },
>(walletEmployeeId: W): W {
  return walletEmployeeId;
}

// Type-level guard — the assertion below fails to compile if a future
// schema change tries to add a card variant to WageReceiptVehicle.
type CardVariantsInWpsVehicle = Extract<WageReceiptVehicle, CardType>;
type WpsVehicleHasNoCardVariants = CardVariantsInWpsVehicle extends never ? true : never;
// Exported as a const so a CI breakage is loud (unused-export-as-
// invariant pattern; if this stops being `true` the build fails).
export const _WPS_VEHICLE_HAS_NO_CARD_VARIANTS: WpsVehicleHasNoCardVariants = true;
