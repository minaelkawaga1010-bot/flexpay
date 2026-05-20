/**
 * WalletScreen — gateway integration tests.
 *
 * These tests verify the WIRING from the Zod-parsed
 * `useMobileWalletStore.balance` shape through to the rendered DOM:
 *
 *   - walletBalance         → testID="balance-amount"
 *   - accruedWages          → testID="accrued-amount" (only when cycle ACTIVE)
 *   - availableLimit        → testID="available-limit"
 *   - dcse.eligibleForEWA   → enables / disables testID="get-advance-button"
 *   - lastError             → renders BalanceErrorBanner with the right code
 *
 * Both stores are mocked so we never hit the network or Keychain;
 * we control the shape directly to assert binding correctness.
 */

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';
import { WalletScreen } from '@screens/wallet/WalletScreen';
import { useMobileWalletStore } from '@store/useMobileWalletStore';
import { useWalletStore } from '@store/useWalletStore';

beforeEach(() => {
  jest.clearAllMocks();
  // Reset the legacy store so the transaction list rendering doesn't
  // bleed across tests.
  useWalletStore.setState({
    balance: 0,
    transactions: [],
    hasMore: false,
    isLoading: false,
    lastFetchAt: null,
  });
  useMobileWalletStore.setState({
    balance: null,
    isLoading: false,
    lastFetchAt: null,
    lastError: null,
  });
});

function seedBalance(overrides: Partial<NonNullable<ReturnType<typeof useMobileWalletStore.getState>['balance']>> = {}) {
  useMobileWalletStore.setState({
    balance: {
      walletBalance: 1234.56,
      currency: 'AED',
      accruedWages: 800,
      availableLimit: 790,
      dcse: {
        score: 0.72,
        eligibleForEWA: true,
        modelVersion: 'dcse-v1.0.0',
        nextReviewAt: null,
      },
      plan: 'BASIC',
      cycle: { id: 'cyc-1', status: 'ACTIVE' },
      ...overrides,
    },
    isLoading: false,
  });
}

describe('WalletScreen — gateway binding', () => {
  it('renders the gateway-bound walletBalance, accruedWages, and availableLimit', () => {
    seedBalance();
    const { getByTestId } = render(<WalletScreen />);
    // The amounts pass through formatAED which adds "AED " prefix and
    // 2-decimal formatting. We only check that the formatted number
    // appears, not the i18n locale separator.
    expect(getByTestId('balance-amount').props.children).toContain('1,234.56');
    expect(getByTestId('accrued-amount').props.children).toContain('800.00');
    expect(getByTestId('available-limit').props.children).toContain('790.00');
  });

  it('enables the Get Advance button when DCSE eligible AND availableLimit > 0', () => {
    seedBalance({ availableLimit: 500, dcse: { score: 0.7, eligibleForEWA: true, modelVersion: 'v1' } });
    const { getByTestId } = render(<WalletScreen />);
    const btn = getByTestId('get-advance-button');
    expect(btn.props.accessibilityState?.disabled ?? false).toBe(false);
  });

  it('disables the Get Advance button when DCSE marks the worker ineligible', () => {
    seedBalance({ availableLimit: 500, dcse: { score: 0.3, eligibleForEWA: false, modelVersion: 'v1' } });
    const { getByTestId } = render(<WalletScreen />);
    const btn = getByTestId('get-advance-button');
    expect(btn.props.accessibilityState?.disabled).toBe(true);
  });

  it('disables the Get Advance button when availableLimit is zero (I1-cap)', () => {
    seedBalance({ availableLimit: 0, accruedWages: 0 });
    const { getByTestId } = render(<WalletScreen />);
    const btn = getByTestId('get-advance-button');
    expect(btn.props.accessibilityState?.disabled).toBe(true);
  });

  it('hides the accrued-wages row when there is NO active payroll cycle', () => {
    seedBalance({
      cycle: { id: null, status: 'NO_ACTIVE_CYCLE' },
      accruedWages: 0,
      availableLimit: 0,
    });
    const { queryByTestId } = render(<WalletScreen />);
    expect(queryByTestId('accrued-amount')).toBeNull();
  });

  it('renders the compliance-block banner when lastError.code is COMPLIANCE_BLOCK', () => {
    seedBalance();
    useMobileWalletStore.setState({
      lastError: {
        code: 'COMPLIANCE_BLOCK',
        message: 'Account flagged',
        at: Date.now(),
      },
    });
    const { getByTestId } = render(<WalletScreen />);
    expect(getByTestId('balance-error-compliance_block')).toBeTruthy();
  });

  it('renders the KYC banner when lastError.code is KYC_NOT_COMPLETE', () => {
    useMobileWalletStore.setState({
      balance: null,
      lastError: {
        code: 'KYC_NOT_COMPLETE',
        message: 'KYC not complete',
        at: Date.now(),
      },
    });
    const { getByTestId } = render(<WalletScreen />);
    expect(getByTestId('balance-error-kyc_not_complete')).toBeTruthy();
  });

  it('falls back to the generic surface for unknown error codes', () => {
    useMobileWalletStore.setState({
      balance: null,
      lastError: {
        code: 'SOME_NEW_BACKEND_CODE',
        message: 'Server says hi',
        at: Date.now(),
      },
    });
    const { getByTestId } = render(<WalletScreen />);
    // Unknown-code banner uses the dedicated testID so the parent screen
    // can still differentiate "we have an error" from "no error".
    expect(getByTestId('balance-error-unknown')).toBeTruthy();
  });
});
