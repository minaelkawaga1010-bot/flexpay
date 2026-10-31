/**
 * Round a monetary amount to 2 decimal places (fils) with an explicit,
 * symmetric rounding policy — WITHOUT float scaling.
 *
 * Rounding policy: ROUND_HALF_UP away from zero (commercial rounding):
 *   1.005 -> 1.01   -1.005 -> -1.01   0.615 -> 0.62   2.675 -> 2.68
 *
 * Why not `Math.round(amount * 100) / 100`: `amount` is already an
 * IEEE-754 double (the literal 1.005 is stored as 1.00499999…), so
 * multiplying by 100 keeps that error and 1.005 wrongly rounds to 1.00.
 * Why not `Number.EPSILON` nudging: it is a heuristic that mis-rounds
 * values whose true magnitude sits just under the .5 boundary.
 *
 * Instead we re-parse from the number's SHORTEST round-trip decimal:
 * the template `${abs}e2` is the string "1.005e2", which the IEEE
 * parser reads as the real value 100.5 (exactly representable), so
 * Math.round sees 100.5 — not 100.4999…. The sign is applied outside
 * the round so the policy is symmetric for negatives (Math.round
 * otherwise breaks ties toward +Infinity: Math.round(-0.5) === -0).
 *
 * SCOPE: this still accepts a JS `number`, so it rounds the decimal the
 * double most concisely represents. End-to-end exactness (no double on
 * the money path at all) is the later minor-units / Decimal migration;
 * this is the API-compatible containment fix for the rounding boundary.
 */
export function roundCurrency(amount: number): number {
  // Preserve NaN / ±Infinity rather than turning them into NaN via the
  // string path below (matches the prior implementation's passthrough).
  if (!Number.isFinite(amount)) return amount;

  const sign = amount < 0 ? -1 : 1;
  const shifted = Number(`${Math.abs(amount)}e2`);

  // Defensive: an extreme magnitude whose toString() uses exponent
  // notation (|x| >= 1e21) would produce an unparseable `…e…e2` string.
  // That is far outside the monetary domain; fall back to scaled round.
  if (!Number.isFinite(shifted)) return Math.round(amount * 100) / 100;

  return sign * Number(`${Math.round(shifted)}e-2`);
}

export function formatAED(amount: number): string {
  return `AED ${roundCurrency(amount).toFixed(2)}`;
}
