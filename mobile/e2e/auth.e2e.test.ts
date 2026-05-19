import { by, device, element, expect } from 'detox';

/**
 * Drives the auth flow on the real app.
 *
 * Prerequisite: a backend that accepts a fixed test OTP for the test phone
 * number (typically a dedicated dev/staging build with the OTP override
 * flag enabled, or a Twilio Magic Number). Without it, the verify step
 * has no way to succeed against a live OTP store.
 */

const TEST_PHONE = '+971501234567';
const TEST_OTP = '123456';

const fillOtp = async (code: string) => {
  for (let i = 0; i < code.length; i++) {
    await element(by.id(`otp-input-${i}`)).typeText(code[i]);
  }
};

describe('Authentication Flow', () => {
  beforeAll(async () => {
    await device.launchApp({
      permissions: { notifications: 'YES' },
      newInstance: true,
    });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('completes the OTP → ProfileSetup → Home flow for a new user', async () => {
    // 1. Phone entry
    await element(by.id('phone-input')).typeText(TEST_PHONE);
    await element(by.id('continue-button')).tap();

    // 2. OTP screen visible, then fill all six digits
    await expect(element(by.id('otp-screen'))).toBeVisible();
    await fillOtp(TEST_OTP);

    // 3. Backend raises FULL_NAME_REQUIRED for first-time users — the
    //    app routes to ProfileSetup. Fill the form and continue.
    await expect(element(by.id('profile-setup-screen'))).toBeVisible();
    await element(by.id('full-name-input')).typeText('Ahmed Mohamed');
    await element(by.id('salary-input')).typeText('3500');
    await element(by.id('continue-button')).tap();

    // 4. Lands on Home
    await expect(element(by.id('home-screen'))).toBeVisible();
    await expect(element(by.id('balance-card'))).toBeVisible();
  });

  it('rejects an invalid OTP', async () => {
    await element(by.id('phone-input')).typeText(TEST_PHONE);
    await element(by.id('continue-button')).tap();

    await expect(element(by.id('otp-screen'))).toBeVisible();
    await fillOtp('000000');

    // Alert title comes from i18n key `auth.otp.invalid_title`.
    await expect(element(by.text('Invalid or expired OTP'))).toBeVisible();
  });
});
