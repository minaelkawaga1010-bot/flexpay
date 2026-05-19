/**
 * Compliance plane unit tests.
 *
 * Three surfaces under test:
 *   1. Emirates ID structural validator (pure function, exhaustive)
 *   2. Sanctions name-normalisation (pure function, fast-check)
 *   3. enforceComplianceForAdvance gate logic (mocked tx client) —
 *      covers status-based blocks and open-incident blocks.
 *
 * The integration of the gate INSIDE reserveAdvance is covered at the
 * e2e level (tests/e2e) where a real Postgres + Prisma transaction is
 * available; here we are isolating the gate's decision logic.
 */

import * as fc from 'fast-check';
import {
  ComplianceIncidentStatus,
  ComplianceIncidentType,
  EmployeeStatus,
} from '@prisma/client';
import { validateEmiratesId } from '../src/modules/compliance/kyc.service';
import { normaliseName } from '../src/modules/compliance/sanctions.service';
import {
  enforceComplianceForAdvance,
  ComplianceBlock,
  BLOCKING_INCIDENT_STATUSES,
} from '../src/modules/compliance/compliance.guard';
import { AppError } from '../src/shared/utils/errors';

// ───────────────────────────────────────────────────────────────────
// Emirates ID structural validator
// ───────────────────────────────────────────────────────────────────

/**
 * Compute the Luhn check digit for the 14-digit body of an Emirates ID.
 * Used by the test arbitrary to mint *valid* IDs that the validator
 * must accept; mismatched-checksum cases come from perturbing this.
 */
function luhnCheckDigit(body14: string): number {
  const digits = body14.split('').map((d) => parseInt(d, 10));
  let sum = 0;
  for (let i = digits.length - 1, doubled = true; i >= 0; i--, doubled = !doubled) {
    let v = digits[i];
    if (doubled) {
      v *= 2;
      if (v > 9) v -= 9;
    }
    sum += v;
  }
  return (10 - (sum % 10)) % 10;
}

describe('validateEmiratesId', () => {
  it('accepts a structurally valid Emirates ID with correct checksum', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1980, max: 2030 }),
        fc.integer({ min: 0, max: 9_999_999 }),
        (year, serial) => {
          const yearStr = String(year).padStart(4, '0');
          const serialStr = String(serial).padStart(7, '0');
          const body = `784${yearStr}${serialStr}`;
          const check = luhnCheckDigit(body);
          const eid = `784-${yearStr}-${serialStr}-${check}`;
          expect(validateEmiratesId(eid).ok).toBe(true);
        },
      ),
    );
  });

  it('rejects a malformed Emirates ID (wrong prefix)', () => {
    expect(validateEmiratesId('123-1990-1234567-0').ok).toBe(false);
    expect(validateEmiratesId('784-1990-1234567').ok).toBe(false);
    expect(validateEmiratesId('not-an-id').ok).toBe(false);
  });

  it('rejects a structurally well-formed ID with a bad checksum', () => {
    // Valid body, deliberately wrong check digit.
    const body = '78419900000001';
    const correct = luhnCheckDigit(body);
    const wrong = (correct + 1) % 10;
    const eid = `784-1990-0000001-${wrong}`;
    const result = validateEmiratesId(eid);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('checksum_mismatch');
  });
});

// ───────────────────────────────────────────────────────────────────
// Sanctions name normalisation
// ───────────────────────────────────────────────────────────────────

describe('normaliseName', () => {
  it('is idempotent — normalise(normalise(x)) === normalise(x)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 60 }), (s) => {
        const once = normaliseName(s);
        const twice = normaliseName(once);
        expect(twice).toBe(once);
      }),
    );
  });

  it('collapses case, diacritics, and whitespace', () => {
    expect(normaliseName('  Álí   Mŏhámmęd  ')).toBe('ali mohammed');
    expect(normaliseName('ALI MOHAMMED')).toBe('ali mohammed');
    expect(normaliseName('Ali  Mohammed')).toBe('ali mohammed');
  });

  it('returns empty for inputs with no matchable characters', () => {
    expect(normaliseName('   ')).toBe('');
    expect(normaliseName('!!!!')).toBe('');
  });
});

// ───────────────────────────────────────────────────────────────────
// enforceComplianceForAdvance — gate decision logic
// ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock of Prisma.TransactionClient that exposes the
 * two surfaces the guard touches: employee.findUnique and
 * complianceIncident.findFirst.
 */
function buildMockTx(opts: {
  employee: { status: EmployeeStatus } | null;
  blockingIncident: {
    id: string;
    type: ComplianceIncidentType;
    severity: number;
  } | null;
}): any {
  return {
    employee: {
      findUnique: jest.fn().mockResolvedValue(opts.employee),
    },
    complianceIncident: {
      findFirst: jest.fn().mockResolvedValue(opts.blockingIncident),
    },
  };
}

describe('enforceComplianceForAdvance', () => {
  it('passes for ACTIVE employee with no blocking incidents', async () => {
    const tx = buildMockTx({
      employee: { status: EmployeeStatus.ACTIVE },
      blockingIncident: null,
    });
    await expect(enforceComplianceForAdvance(tx, 'emp-1')).resolves.toBeUndefined();
  });

  it('throws ComplianceBlock when a severity-5 incident is open', async () => {
    const tx = buildMockTx({
      employee: { status: EmployeeStatus.ACTIVE },
      blockingIncident: {
        id: 'inc-1',
        type: ComplianceIncidentType.SANCTIONS_HIT,
        severity: 5,
      },
    });
    await expect(enforceComplianceForAdvance(tx, 'emp-1')).rejects.toBeInstanceOf(
      ComplianceBlock,
    );
  });

  it('blocks PENDING_KYC with KYC_NOT_COMPLETE', async () => {
    const tx = buildMockTx({
      employee: { status: EmployeeStatus.PENDING_KYC },
      blockingIncident: null,
    });
    await expect(enforceComplianceForAdvance(tx, 'emp-1')).rejects.toThrow(AppError);
    await expect(enforceComplianceForAdvance(tx, 'emp-1')).rejects.toMatchObject({
      code: 'KYC_NOT_COMPLETE',
    });
  });

  it('blocks BLOCKED and DEACTIVATED with ACCOUNT_NOT_ACTIVE', async () => {
    for (const status of [EmployeeStatus.BLOCKED, EmployeeStatus.DEACTIVATED]) {
      const tx = buildMockTx({ employee: { status }, blockingIncident: null });
      await expect(enforceComplianceForAdvance(tx, 'emp-1')).rejects.toMatchObject({
        code: 'ACCOUNT_NOT_ACTIVE',
      });
    }
  });

  it('blocks for every documented blocking status', async () => {
    // Sanity: the guard reads `BLOCKING_INCIDENT_STATUSES` via a Prisma
    // `in` filter, so the unit gate test only sees the *result*. This
    // property check just enforces that the constant matches the
    // documented intent — RESOLVED_NO_ACTION must NOT be in the list.
    expect(BLOCKING_INCIDENT_STATUSES).toContain(ComplianceIncidentStatus.OPEN);
    expect(BLOCKING_INCIDENT_STATUSES).toContain(ComplianceIncidentStatus.UNDER_REVIEW);
    expect(BLOCKING_INCIDENT_STATUSES).toContain(ComplianceIncidentStatus.ESCALATED);
    expect(BLOCKING_INCIDENT_STATUSES).toContain(ComplianceIncidentStatus.RESOLVED_BLOCKED);
    expect(BLOCKING_INCIDENT_STATUSES).not.toContain(
      ComplianceIncidentStatus.RESOLVED_NO_ACTION,
    );
  });

  it('throws EMPLOYEE_NOT_FOUND when the employee row is missing', async () => {
    const tx = buildMockTx({ employee: null, blockingIncident: null });
    await expect(enforceComplianceForAdvance(tx, 'emp-1')).rejects.toMatchObject({
      code: 'EMPLOYEE_NOT_FOUND',
    });
  });
});
