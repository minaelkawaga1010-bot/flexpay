/**
 * TASK-017 — PII logging hygiene (unit, adversarial).
 *
 * Confirmed plaintext exposure: the provider stubs and the OTP-send path
 * logged customer PII (beneficiary name / bank account, employee name /
 * phone, customer name / email / phone, the raw phone number). These
 * assert a CANARY identity planted into each path never reaches any log
 * line. This same suite reproduces the exposure on the pre-fix tree (the
 * canaries DO appear there).
 */

jest.mock('@modules/auth/twilio.service', () => ({
  twilioService: {
    sendOTP: jest.fn().mockResolvedValue(undefined),
    sendWelcomeSMS: jest.fn().mockResolvedValue(undefined),
  },
}));

import logger from '@shared/utils/logger';
import { moneyHashService } from '@modules/remittance/moneyhash.service';
import { flexxPayService } from '@modules/ewa/flexxpay.service';
import { nymcardService } from '@modules/cards/nymcard.service';
import { authService } from '@modules/auth/auth.service';

const CANARY = {
  name: 'CANARYNAME_Jane_Roe',
  account: 'CANARYACCT_000111222',
  swift: 'CANARYSWIFT',
  phone: '+9715CANARYPHONE',
  email: 'canary@example.test',
};

function captureLogs(): { lines: () => string; restore: () => void } {
  const captured: unknown[][] = [];
  const spies = (['info', 'warn', 'error', 'debug'] as const).map((level) =>
    jest.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
      captured.push(args);
      return logger;
    }),
  );
  return { lines: () => JSON.stringify(captured), restore: () => spies.forEach((s) => s.mockRestore()) };
}

/** Assert NONE of the canary PII values appears anywhere in the captured logs. */
function expectNoPii(logs: string): void {
  for (const value of [CANARY.name, CANARY.account, CANARY.phone, CANARY.email]) {
    expect(logs).not.toContain(value);
  }
}

describe('PII logging hygiene (TASK-017)', () => {
  it('moneyhash createTransfer stub never logs the beneficiary name / bank account', async () => {
    const cap = captureLogs();
    try {
      await moneyHashService.createTransfer({
        amount: 1000,
        currency: 'AED',
        beneficiary: { name: CANARY.name, bankAccount: CANARY.account, swiftCode: CANARY.swift },
        reference: 'rem_test',
      });
    } finally {
      cap.restore();
    }
    expectNoPii(cap.lines());
  });

  it('flexxpay createAdvanceRequest stub never logs the employee name / phone', async () => {
    const cap = captureLogs();
    try {
      await flexxPayService.createAdvanceRequest({
        employeeName: CANARY.name,
        employeePhone: CANARY.phone,
        amount: 500,
        employerId: 'co-1',
        returnUrl: 'https://flexpay.ae/ewa/success',
      });
    } finally {
      cap.restore();
    }
    expectNoPii(cap.lines());
  });

  it('nymcard createCustomer stub never logs the customer name / email / phone', async () => {
    const cap = captureLogs();
    try {
      await nymcardService.createCustomer({ name: CANARY.name, email: CANARY.email, phone: CANARY.phone });
    } finally {
      cap.restore();
    }
    expectNoPii(cap.lines());
  });

  it('OTP-send never logs the raw phone number (a hash prefix is acceptable)', async () => {
    const cap = captureLogs();
    try {
      await authService.requestEmployeeOTP(CANARY.phone);
    } finally {
      cap.restore();
    }
    expect(cap.lines()).not.toContain(CANARY.phone);
  });
});
