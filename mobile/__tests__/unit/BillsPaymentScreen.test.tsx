/**
 * BillsPaymentScreen — Phase 2 Feature #3 integration tests.
 *
 * Covers:
 *   • Successful payment sequence (DEWA / 200 AED).
 *   • Insufficient balance refusal — backend 409 surfaces as a typed
 *     error card; form is preserved so the user can adjust.
 *   • Network failure fallback — error card + idempotency-key
 *     preservation across retry attempts.
 *   • Double-tap protection — `isSubmittingBill` lock guarantees
 *     exactly one network call regardless of tap velocity.
 *   • Compliance badge mounts on the confirmation modal AND the
 *     receipt surface.
 *
 * The bills API client is mocked at the module boundary via the
 * lazy-binding pattern (see VirtualCardView.test.tsx for the
 * rationale).
 */

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

const mockApi = {
  payBill: jest.fn(),
  listBills: jest.fn(),
};
jest.mock('@services/api/bills', () => ({
  billsService: {
    payBill: (...args: unknown[]) => (mockApi.payBill as any)(...args),
    listBills: (...args: unknown[]) => (mockApi.listBills as any)(...args),
  },
}));

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { BillsPaymentScreen } from '@screens/bills/BillsPaymentScreen';

const completeBill = (over: Record<string, unknown> = {}) => ({
  bill: {
    id: 'bp-1',
    billerType: 'DEWA',
    billerAccountRef: '2001234567',
    amount: 200,
    fee: 0,
    totalAmount: 200,
    currency: 'AED',
    status: 'PENDING',
    failureReason: null,
    externalRef: null,
    createdAt: '2026-06-14T10:00:00Z',
    processedAt: null,
    ...over,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
});

// Helper to drive the form into a payable state.
async function fillForm(
  api: ReturnType<typeof render>,
  opts: { biller?: string; ref?: string; amount?: string } = {},
) {
  const { biller = 'DEWA', ref = '2001234567', amount = '200' } = opts;
  fireEvent.press(api.getByTestId(`biller-tile-${biller}`));
  fireEvent.changeText(api.getByTestId('biller-account-ref'), ref);
  fireEvent.changeText(api.getByTestId('biller-amount'), amount);
}

// ───────────────────────────────────────────────────────────────────
// Form gating + validation
// ───────────────────────────────────────────────────────────────────

describe('BillsPaymentScreen — form gating', () => {
  it('renders the eight UAE biller tiles', () => {
    const { getByTestId } = render(<BillsPaymentScreen />);
    for (const b of ['DEWA', 'SEWA', 'ADDC', 'FEWA', 'ETISALAT', 'DU', 'SALIK', 'RTA']) {
      expect(getByTestId(`biller-tile-${b}`)).toBeTruthy();
    }
  });

  it('keeps the Pay button disabled until biller + ref + amount are present', () => {
    const api = render(<BillsPaymentScreen />);
    expect(api.getByTestId('bills-pay-button').props.accessibilityState?.disabled).toBe(true);

    fireEvent.press(api.getByTestId('biller-tile-DEWA'));
    expect(api.getByTestId('bills-pay-button').props.accessibilityState?.disabled).toBe(true);

    fireEvent.changeText(api.getByTestId('biller-account-ref'), '2001234567');
    fireEvent.changeText(api.getByTestId('biller-amount'), '200');
    expect(api.getByTestId('bills-pay-button').props.accessibilityState?.disabled).toBe(false);
  });

  it('does not open the confirm modal if the form is invalid', () => {
    const api = render(<BillsPaymentScreen />);
    fireEvent.press(api.getByTestId('bills-pay-button'));
    expect(api.queryByTestId('bills-confirm-modal')).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────
// Successful payment
// ───────────────────────────────────────────────────────────────────

describe('BillsPaymentScreen — successful payment', () => {
  it('confirm-modal mounts the CBUAE compliance badge', async () => {
    mockApi.payBill.mockResolvedValue(completeBill());
    const api = render(<BillsPaymentScreen />);
    await fillForm(api);
    fireEvent.press(api.getByTestId('bills-pay-button'));
    expect(api.getByTestId('bills-confirm-modal')).toBeTruthy();
    expect(api.getByTestId('bills-compliance-badge')).toBeTruthy();
  });

  it('routes the form payload + idempotency key through billsService.payBill', async () => {
    mockApi.payBill.mockResolvedValue(completeBill());
    const api = render(<BillsPaymentScreen />);
    await fillForm(api);
    fireEvent.press(api.getByTestId('bills-pay-button'));
    fireEvent.press(api.getByTestId('bills-confirm-button'));

    await waitFor(() => expect(mockApi.payBill).toHaveBeenCalledTimes(1));
    expect(mockApi.payBill).toHaveBeenCalledWith(
      expect.objectContaining({
        billerType: 'DEWA',
        billerAccountRef: '2001234567',
        amount: 200,
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it('renders the receipt with the compliance badge after success', async () => {
    mockApi.payBill.mockResolvedValue(completeBill());
    const api = render(<BillsPaymentScreen />);
    await fillForm(api);
    fireEvent.press(api.getByTestId('bills-pay-button'));
    fireEvent.press(api.getByTestId('bills-confirm-button'));

    await waitFor(() => expect(api.queryByTestId('bills-done-button')).toBeTruthy());
    expect(api.getByTestId('bills-compliance-badge')).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────
// Insufficient balance — backend 409
// ───────────────────────────────────────────────────────────────────

describe('BillsPaymentScreen — insufficient balance', () => {
  it('surfaces a typed error card and keeps the form values intact', async () => {
    const insufficient = Object.assign(new Error('Wallet balance is below the bill amount + fee.'), {
      code: 'INSUFFICIENT_BALANCE',
    });
    mockApi.payBill.mockRejectedValue(insufficient);

    const api = render(<BillsPaymentScreen />);
    await fillForm(api, { amount: '5000' });
    fireEvent.press(api.getByTestId('bills-pay-button'));
    fireEvent.press(api.getByTestId('bills-confirm-button'));

    await waitFor(() => expect(api.getByTestId('bills-error-card')).toBeTruthy());
    // Form survives so the user can adjust the amount and retry.
    expect(api.getByTestId('biller-amount').props.value).toBe('5000');
    // Receipt NOT shown — payment failed.
    expect(api.queryByTestId('bills-done-button')).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────
// Network failure — graceful fallback + idempotency key preservation
// ───────────────────────────────────────────────────────────────────

describe('BillsPaymentScreen — network failure fallback', () => {
  it('shows an error card on transient network failure', async () => {
    mockApi.payBill.mockRejectedValue(new Error('Network request failed'));

    const api = render(<BillsPaymentScreen />);
    await fillForm(api);
    fireEvent.press(api.getByTestId('bills-pay-button'));
    fireEvent.press(api.getByTestId('bills-confirm-button'));

    await waitFor(() => expect(api.getByTestId('bills-error-card')).toBeTruthy());
  });

  it('retries re-use the SAME idempotency key (so the backend dedupes)', async () => {
    mockApi.payBill
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce(completeBill());

    const api = render(<BillsPaymentScreen />);
    await fillForm(api);
    fireEvent.press(api.getByTestId('bills-pay-button'));

    // First attempt — fails.
    fireEvent.press(api.getByTestId('bills-confirm-button'));
    await waitFor(() => expect(api.getByTestId('bills-error-card')).toBeTruthy());

    // Second attempt — succeeds. Both calls share the same key.
    fireEvent.press(api.getByTestId('bills-confirm-button'));
    await waitFor(() => expect(api.queryByTestId('bills-done-button')).toBeTruthy());

    expect(mockApi.payBill).toHaveBeenCalledTimes(2);
    const k1 = (mockApi.payBill.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey;
    const k2 = (mockApi.payBill.mock.calls[1][0] as { idempotencyKey: string }).idempotencyKey;
    expect(k1).toBe(k2);
  });
});

// ───────────────────────────────────────────────────────────────────
// Double-tap protection
// ───────────────────────────────────────────────────────────────────

describe('BillsPaymentScreen — double-tap protection', () => {
  it('exactly one network call regardless of tap velocity', async () => {
    // Hold the resolve so rapid taps land while a submit is in flight.
    let resolveBill: ((value: ReturnType<typeof completeBill>) => void) | null = null;
    mockApi.payBill.mockImplementation(
      () => new Promise((r) => { resolveBill = r; }),
    );

    const api = render(<BillsPaymentScreen />);
    await fillForm(api);
    fireEvent.press(api.getByTestId('bills-pay-button'));

    // Rapid five-tap burst on Confirm.
    const btn = api.getByTestId('bills-confirm-button');
    fireEvent.press(btn);
    fireEvent.press(btn);
    fireEvent.press(btn);
    fireEvent.press(btn);
    fireEvent.press(btn);

    expect(mockApi.payBill).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveBill?.(completeBill());
    });
    await waitFor(() => expect(api.queryByTestId('bills-done-button')).toBeTruthy());
  });
});
