/**
 * CBUAE Universal Account framework — WPS payment-method gate tests.
 *
 * Pins the regulatory invariant: prepaid_card cannot be a wage-receipt
 * vehicle; only Universal Account / Bank account / SVF wallet may be.
 * Mirrors the canonical Python rule provided by the regulator-facing
 * spec and locks the schema-level + provisioning-level enforcement.
 */

import { WageReceiptVehicle } from '@prisma/client';
import {
  validateWpsPaymentMethod,
  assertWpsCompliantVehicle,
  registerWpsPaymentMethod,
  ALLOWED_WPS_METHODS,
  DISALLOWED_WPS_METHODS,
  WpsComplianceError,
} from '../src/modules/wps-compliance/wps-payment-method';

// ───────────────────────────────────────────────────────────────────
// Constant sanity
// ───────────────────────────────────────────────────────────────────

describe('CBUAE allowed/disallowed sets', () => {
  it('allows exactly the three Universal Account framework methods', () => {
    expect(new Set(ALLOWED_WPS_METHODS)).toEqual(
      new Set(['universal_account', 'bank_account', 'svf_wallet']),
    );
  });

  it('disallows prepaid_card explicitly', () => {
    expect(DISALLOWED_WPS_METHODS).toContain('prepaid_card');
  });
});

// ───────────────────────────────────────────────────────────────────
// validateWpsPaymentMethod
// ───────────────────────────────────────────────────────────────────

describe('validateWpsPaymentMethod', () => {
  it('maps each allowed method to its schema enum', () => {
    expect(validateWpsPaymentMethod('universal_account')).toBe(WageReceiptVehicle.UNIVERSAL_ACCOUNT);
    expect(validateWpsPaymentMethod('bank_account')).toBe(WageReceiptVehicle.BANK_ACCOUNT);
    expect(validateWpsPaymentMethod('svf_wallet')).toBe(WageReceiptVehicle.SVF_WALLET);
  });

  it('rejects prepaid_card with WPS_INVALID_PREPAID_CARD (the regulator rule)', () => {
    expect(() => validateWpsPaymentMethod('prepaid_card')).toThrow(WpsComplianceError);
    try {
      validateWpsPaymentMethod('prepaid_card');
    } catch (e) {
      expect((e as WpsComplianceError).code).toBe('WPS_INVALID_PREPAID_CARD');
      expect((e as WpsComplianceError).status).toBe(422);
    }
  });

  it('rejects unknown methods with WPS_UNKNOWN_METHOD', () => {
    expect(() => validateWpsPaymentMethod('crypto_wallet')).toThrow(WpsComplianceError);
    try {
      validateWpsPaymentMethod('crypto_wallet');
    } catch (e) {
      expect((e as WpsComplianceError).code).toBe('WPS_UNKNOWN_METHOD');
    }
  });
});

// ───────────────────────────────────────────────────────────────────
// assertWpsCompliantVehicle (the runtime guard)
// ───────────────────────────────────────────────────────────────────

describe('assertWpsCompliantVehicle', () => {
  it('passes for a compliant employee', () => {
    expect(() =>
      assertWpsCompliantVehicle({
        id: 'e1',
        wageReceiptVehicle: WageReceiptVehicle.SVF_WALLET,
        wpsLicensedEntity: 'NYMCARD_SVF',
      }),
    ).not.toThrow();
  });

  it('throws WPS_VEHICLE_NOT_CLASSIFIED when the field is null', () => {
    try {
      assertWpsCompliantVehicle({ id: 'e1', wageReceiptVehicle: null, wpsLicensedEntity: 'x' });
    } catch (e) {
      expect((e as WpsComplianceError).code).toBe('WPS_VEHICLE_NOT_CLASSIFIED');
    }
  });

  it('throws WPS_LICENSED_ENTITY_MISSING when the backing entity is empty', () => {
    try {
      assertWpsCompliantVehicle({
        id: 'e1',
        wageReceiptVehicle: WageReceiptVehicle.BANK_ACCOUNT,
        wpsLicensedEntity: '',
      });
    } catch (e) {
      expect((e as WpsComplianceError).code).toBe('WPS_LICENSED_ENTITY_MISSING');
    }
  });
});

// ───────────────────────────────────────────────────────────────────
// registerWpsPaymentMethod — provisioning helper (mocked tx)
// ───────────────────────────────────────────────────────────────────

describe('registerWpsPaymentMethod', () => {
  it('persists the classification atomically on accept', async () => {
    const tx: any = { employee: { update: jest.fn().mockResolvedValue({}) } };
    const r = await registerWpsPaymentMethod(tx, {
      employeeId: 'e1',
      method: 'svf_wallet',
      licensedEntity: 'NYMCARD_SVF',
    });
    expect(r.wageReceiptVehicle).toBe(WageReceiptVehicle.SVF_WALLET);
    expect(tx.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'e1' },
        data: expect.objectContaining({
          wageReceiptVehicle: WageReceiptVehicle.SVF_WALLET,
          wpsLicensedEntity: 'NYMCARD_SVF',
        }),
      }),
    );
  });

  it('refuses prepaid_card BEFORE any DB write (validator throws first)', async () => {
    const tx: any = { employee: { update: jest.fn() } };
    await expect(
      registerWpsPaymentMethod(tx, {
        employeeId: 'e1',
        method: 'prepaid_card',
        licensedEntity: 'NYMCARD_SVF',
      }),
    ).rejects.toMatchObject({ code: 'WPS_INVALID_PREPAID_CARD' });
    expect(tx.employee.update).not.toHaveBeenCalled();
  });

  it('refuses an empty licensed entity', async () => {
    const tx: any = { employee: { update: jest.fn() } };
    await expect(
      registerWpsPaymentMethod(tx, {
        employeeId: 'e1',
        method: 'bank_account',
        licensedEntity: '   ',
      }),
    ).rejects.toMatchObject({ code: 'WPS_LICENSED_ENTITY_MISSING' });
    expect(tx.employee.update).not.toHaveBeenCalled();
  });
});
