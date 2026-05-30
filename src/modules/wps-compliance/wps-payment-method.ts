import { Prisma, WageReceiptVehicle } from '@prisma/client';
import { AppError } from '@shared/utils/errors';

/**
 * CBUAE Universal Account framework — WPS wage-payment-method gate.
 *
 * Under the latest CBUAE rules, a worker's wage may be paid only into:
 *   • UNIVERSAL_ACCOUNT — the new CBUAE Universal Account
 *   • BANK_ACCOUNT     — a licensed-bank account
 *   • SVF_WALLET       — a Stored Value Facility wallet held by a
 *                        licensed SVF holder (NymCard SVF, etc.)
 *
 * Prepaid cards are explicitly **disallowed** as the wage payee — the
 * legacy "salary card" model is deprecated. FlexPay operates as a
 * Program Manager under NymCard's SVF licence: the IBAN-addressed
 * wallet is the wage payee; the NymCard-issued card is a downstream
 * spend instrument linked to the wallet, never the WPS destination.
 *
 * This module is the single enforcement point. It must be called on
 * every WPS-payee provisioning / registration path so a worker cannot
 * be onboarded with a prepaid card as their wage-receipt vehicle.
 */

// ───────────────────────────────────────────────────────────────────
// Allowed / disallowed sets
// ───────────────────────────────────────────────────────────────────

/** Raw method identifiers accepted on the boundary (e.g. partner API). */
export type WpsPaymentMethodInput =
  | 'universal_account'
  | 'bank_account'
  | 'svf_wallet'
  | 'prepaid_card'
  | (string & {}); // permit unknown strings so unknowns are explicitly rejected

export const ALLOWED_WPS_METHODS: ReadonlyArray<WpsPaymentMethodInput> = [
  'universal_account',
  'bank_account',
  'svf_wallet',
];

export const DISALLOWED_WPS_METHODS: ReadonlyArray<WpsPaymentMethodInput> = [
  'prepaid_card',
];

/** Map the raw boundary string to the schema enum, or null if unknown. */
const TO_ENUM: Record<string, WageReceiptVehicle> = {
  universal_account: WageReceiptVehicle.UNIVERSAL_ACCOUNT,
  bank_account: WageReceiptVehicle.BANK_ACCOUNT,
  svf_wallet: WageReceiptVehicle.SVF_WALLET,
};

// ───────────────────────────────────────────────────────────────────
// Error type
// ───────────────────────────────────────────────────────────────────

export type WpsComplianceErrorCode =
  | 'WPS_INVALID_PREPAID_CARD'
  | 'WPS_UNKNOWN_METHOD'
  | 'WPS_VEHICLE_NOT_CLASSIFIED'
  | 'WPS_LICENSED_ENTITY_MISSING';

export class WpsComplianceError extends AppError {
  constructor(code: WpsComplianceErrorCode, message: string, details?: Record<string, unknown>) {
    // 422 — semantic violation of the regulatory contract, not a
    // transient or auth error. Surfaced to ops, never silently
    // logged-and-continued.
    super(422, code, message, details);
    this.name = 'WpsComplianceError';
  }
}

// ───────────────────────────────────────────────────────────────────
// Validators
// ───────────────────────────────────────────────────────────────────

/**
 * Validate a raw payment-method identifier received on the boundary
 * (e.g. from a partner-bank/SVF provisioning API or an internal
 * onboarding flow). Returns the schema enum on accept; throws
 * WpsComplianceError on reject. Mirrors the canonical Python rule:
 *
 *   if method == "prepaid_card": raise
 *   if method in [universal_account, bank_account, svf_wallet]: APPROVED
 *   else: UNKNOWN_METHOD
 */
export function validateWpsPaymentMethod(method: WpsPaymentMethodInput): WageReceiptVehicle {
  if (DISALLOWED_WPS_METHODS.includes(method)) {
    throw new WpsComplianceError(
      'WPS_INVALID_PREPAID_CARD',
      'Prepaid cards are not allowed as a WPS wage-receipt vehicle under the CBUAE Universal Account framework.',
      { method, allowed: ALLOWED_WPS_METHODS },
    );
  }
  const mapped = TO_ENUM[method];
  if (!mapped) {
    throw new WpsComplianceError(
      'WPS_UNKNOWN_METHOD',
      `Unknown WPS payment method '${method}'. Allowed: ${ALLOWED_WPS_METHODS.join(', ')}.`,
      { method, allowed: ALLOWED_WPS_METHODS },
    );
  }
  return mapped;
}

/**
 * Assert that an Employee row carries a compliant wage-receipt vehicle
 * classification. Throws if the field is unset or (defensively) if the
 * schema ever drifts to allow PREPAID_CARD. Use this as a precondition
 * at every WPS-payee registration / SIF-ingest matching point so a
 * worker without an explicit classification never receives a wage
 * transfer to an unclassified vehicle.
 *
 * `wpsLicensedEntity` is also required — without naming the licensed
 * bank / SVF holder backing the wallet, the wallet has no regulatory
 * provenance and cannot lawfully receive WPS funds.
 */
export function assertWpsCompliantVehicle(employee: {
  id: string;
  wageReceiptVehicle: WageReceiptVehicle | null;
  wpsLicensedEntity: string | null;
}): void {
  if (!employee.wageReceiptVehicle) {
    throw new WpsComplianceError(
      'WPS_VEHICLE_NOT_CLASSIFIED',
      'Employee has no wage-receipt vehicle classification; cannot register as a WPS payee.',
      { employeeId: employee.id },
    );
  }
  // Defence-in-depth: the schema enum does not include PREPAID_CARD,
  // but if the union ever expands at the database level, refuse here.
  const allowed: WageReceiptVehicle[] = [
    WageReceiptVehicle.UNIVERSAL_ACCOUNT,
    WageReceiptVehicle.BANK_ACCOUNT,
    WageReceiptVehicle.SVF_WALLET,
  ];
  if (!allowed.includes(employee.wageReceiptVehicle)) {
    throw new WpsComplianceError(
      'WPS_INVALID_PREPAID_CARD',
      `Wage-receipt vehicle '${employee.wageReceiptVehicle}' is not permitted under CBUAE rules.`,
      { employeeId: employee.id, vehicle: employee.wageReceiptVehicle },
    );
  }
  if (!employee.wpsLicensedEntity || employee.wpsLicensedEntity.trim() === '') {
    throw new WpsComplianceError(
      'WPS_LICENSED_ENTITY_MISSING',
      'wpsLicensedEntity is not set; the wallet has no licensed bank/SVF holder backing.',
      { employeeId: employee.id },
    );
  }
}

/**
 * Provisioning helper. Records the worker's wage-receipt-vehicle
 * classification atomically; the validator throws BEFORE the DB write
 * so a prepaid-card classification can never be persisted.
 *
 * Accepts a Prisma transaction client to compose with the surrounding
 * onboarding transaction (the same MVCC snapshot as the rest of the
 * worker's provisioning).
 */
export async function registerWpsPaymentMethod(
  tx: Prisma.TransactionClient,
  args: {
    employeeId: string;
    method: WpsPaymentMethodInput;
    licensedEntity: string;
  },
): Promise<{ employeeId: string; wageReceiptVehicle: WageReceiptVehicle; wpsLicensedEntity: string }> {
  const vehicle = validateWpsPaymentMethod(args.method); // throws on prepaid/unknown
  if (!args.licensedEntity || args.licensedEntity.trim() === '') {
    throw new WpsComplianceError(
      'WPS_LICENSED_ENTITY_MISSING',
      'A licensed bank / SVF holder must be named when registering a WPS payment method.',
      { employeeId: args.employeeId, method: args.method },
    );
  }
  await tx.employee.update({
    where: { id: args.employeeId },
    data: {
      wageReceiptVehicle: vehicle,
      wpsLicensedEntity: args.licensedEntity,
    },
  });
  return {
    employeeId: args.employeeId,
    wageReceiptVehicle: vehicle,
    wpsLicensedEntity: args.licensedEntity,
  };
}
