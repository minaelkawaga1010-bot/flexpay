import { BillerType } from '@prisma/client';

/**
 * Free Bills fee schedule.
 *
 * Per the "Free Bills" feature contract, FlexPay does NOT charge a
 * per-bill fee for the supported UAE billers — the value is in the
 * convenience of paying directly from the wage-receipt wallet, and
 * FlexPay's revenue model recoups via interchange + remittance fees,
 * not utility surcharges.
 *
 * This module is the single source of truth for the fee number that
 * goes onto each bill_payments row. Keeping it pure (no I/O, no DB)
 * lets the service layer call it from inside a transaction without
 * widening the transaction boundary.
 *
 * Future: if a biller starts charging FlexPay a routing fee that we
 * choose to pass through, override the per-biller branch here. The
 * SCHEMA already carries `fee` as a non-zero-permitted field so the
 * data model does not need to change.
 */

const ZERO_FEE_BILLERS = new Set<BillerType>([
  BillerType.DEWA,
  BillerType.SEWA,
  BillerType.ADDC,
  BillerType.FEWA,
  BillerType.ETISALAT,
  BillerType.DU,
  BillerType.SALIK,
  BillerType.RTA,
  BillerType.OTHER,
]);

/**
 * Compute the FlexPay-side fee for a bill payment, in AED.
 *
 * Always non-negative; rounded to fils (2 d.p.) for currency safety.
 * Returns 0 for every currently-supported biller — the "Free Bills"
 * promise — but keeps a single function to call so an op-driven
 * change to that promise lands in exactly one place.
 */
export function computeBillerFee(billerType: BillerType, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (ZERO_FEE_BILLERS.has(billerType)) return 0;
  // Defensive: if a new BillerType lands without a fee entry, default
  // to 0 (free) rather than silently charging an undocumented fee.
  return 0;
}
