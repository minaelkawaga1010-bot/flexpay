/**
 * TASK-015 — KYC activation gating (unit).
 *
 * Proves, with Prisma and the card/SMS side-effects mocked, that employer
 * onboarding NEVER flips an employee to ACTIVE (issuing a card is not KYC),
 * and exercises the Emirates-ID structural validator the KYC pipeline gates
 * on. The full lifecycle (authorised approval, fail-closed, rejection,
 * concurrency) is proven against real PostgreSQL in
 * tests/e2e/kyc-activation.e2e.test.ts.
 */

jest.mock('@config/prisma', () => ({
  prisma: {
    company: { findUnique: jest.fn() },
    employee: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  },
}));
jest.mock('@modules/cards/cards.service', () => ({
  cardsService: { issueVirtualCard: jest.fn().mockResolvedValue({ id: 'card-1' }) },
}));
jest.mock('@modules/auth/twilio.service', () => ({
  twilioService: { sendWelcomeSMS: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('@modules/notifications/notification.job', () => ({ enqueueNotification: jest.fn() }));
jest.mock('@modules/payroll/payroll.job', () => ({ enqueuePayrollJob: jest.fn() }));

import { EmployeeStatus } from '@prisma/client';
import { prisma } from '@config/prisma';
import { cardsService } from '@modules/cards/cards.service';
import { payrollService } from '../src/modules/payroll/payroll.service';
import { validateEmiratesId } from '../src/modules/compliance/kyc.service';

const mocked = prisma as unknown as {
  company: { findUnique: jest.Mock };
  employee: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════
// Employer onboarding never activates (TASK-015 §6)
// ═══════════════════════════════════════════════════════════════════

describe('payrollService.addEmployee — card issuance never activates', () => {
  beforeEach(() => {
    mocked.company.findUnique.mockResolvedValue({ id: 'co-1' });
    mocked.employee.findUnique.mockResolvedValue(null); // no existing employee
    mocked.employee.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'emp-1',
      ...data,
    }));
  });

  it('creates the employee PENDING_KYC and issues a card, but never writes status ACTIVE', async () => {
    const result = await payrollService.addEmployee('co-1', {
      fullName: 'New Hire',
      phone: '+971500000123',
      email: 'hire@example.ae',
      salary: 4000,
    } as never);

    // Created in the non-financially-active state…
    expect(mocked.employee.create).toHaveBeenCalledTimes(1);
    expect(mocked.employee.create.mock.calls[0][0].data.status).toBe(EmployeeStatus.PENDING_KYC);
    // …a card is still provisioned…
    expect(cardsService.issueVirtualCard).toHaveBeenCalledWith('emp-1');
    // …but NOTHING ever updates the employee to ACTIVE (no status write at all).
    const activatedWrite = mocked.employee.update.mock.calls.find(
      (c) => (c[0]?.data ?? {}).status === EmployeeStatus.ACTIVE,
    );
    expect(activatedWrite).toBeUndefined();
    expect(result.status).toBe(EmployeeStatus.PENDING_KYC);
  });

  it('still returns PENDING_KYC even when card issuance fails', async () => {
    (cardsService.issueVirtualCard as jest.Mock).mockRejectedValueOnce(new Error('nymcard down'));
    const result = await payrollService.addEmployee('co-1', {
      fullName: 'New Hire',
      phone: '+971500000124',
      salary: 4000,
    } as never);
    expect(result.status).toBe(EmployeeStatus.PENDING_KYC);
    const activatedWrite = mocked.employee.update.mock.calls.find(
      (c) => (c[0]?.data ?? {}).status === EmployeeStatus.ACTIVE,
    );
    expect(activatedWrite).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Emirates-ID structural validation (the KYC pipeline's gate)
// ═══════════════════════════════════════════════════════════════════

describe('validateEmiratesId', () => {
  /** A structurally valid Emirates ID with the correct Luhn check digit. */
  function validEid(): string {
    for (let c = 0; c <= 9; c++) {
      const candidate = `784-1988-1234567-${c}`;
      if (validateEmiratesId(candidate).ok) return candidate;
    }
    throw new Error('no valid check digit found');
  }

  it('accepts a well-formed Emirates ID with a correct check digit', () => {
    expect(validateEmiratesId(validEid()).ok).toBe(true);
  });

  it('rejects a malformed number', () => {
    expect(validateEmiratesId('123-4567-1234567-0')).toMatchObject({ ok: false, reason: 'malformed_number' });
    expect(validateEmiratesId('784-1988-1234567')).toMatchObject({ ok: false });
  });

  it('rejects a wrong check digit', () => {
    const valid = validEid();
    const wrong = valid.slice(0, -1) + ((Number(valid.slice(-1)) + 1) % 10);
    expect(validateEmiratesId(wrong)).toMatchObject({ ok: false, reason: 'checksum_mismatch' });
  });
});
