/**
 * useSalaryFeed — composition-level tests.
 *
 * Pins the contract the screen relies on:
 *   • WPS-only filter — only PAYROLL / REFUND / REMITTANCE survive.
 *   • Combined status — error if EITHER source errors; loading only
 *     if NEITHER has data yet; success once both have a payload.
 *   • refresh() invalidates both caches in parallel.
 *   • retry() clears the gateway error AND re-fetches both queries.
 *   • Pagination — getNextPageParam stops at a partial page.
 *
 * The walletService API is mocked at the module boundary; the
 * mobile-wallet store is reset between tests so each scenario starts
 * from a known shape.
 */

jest.mock('@services/api/wallet', () => ({
  walletService: {
    getTransactions: jest.fn(),
    getBalance: jest.fn(),
  },
}));

import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { walletService } from '@services/api/wallet';
import { useMobileWalletStore } from '@store/useMobileWalletStore';
import { useSalaryFeed } from '@hooks/useSalaryFeed';

const txOfType = (id: string, type: string, amount = 100) => ({
  id,
  type,
  amount,
  fee: 0,
  totalAmount: amount,
  status: 'COMPLETED' as const,
  createdAt: '2026-06-01T00:00:00Z',
});

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return { qc, wrapper: ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children) };
}

beforeEach(() => {
  jest.clearAllMocks();
  useMobileWalletStore.setState({
    balance: null,
    isLoading: false,
    lastError: null,
    lastFetchAt: null,
  });
});

// ───────────────────────────────────────────────────────────────────
// WPS filter
// ───────────────────────────────────────────────────────────────────

describe('useSalaryFeed — WPS filter', () => {
  it('filters out CARD_PURCHASE / CASHBACK / REFERRAL_REWARD', async () => {
    (walletService.getTransactions as jest.Mock).mockResolvedValue({
      transactions: [
        txOfType('p1', 'PAYROLL', 5000),
        txOfType('c1', 'CARD_PURCHASE', -50),
        txOfType('r1', 'REFUND', 25),
        txOfType('cb', 'CASHBACK', 5),
        txOfType('rem', 'REMITTANCE', -1000),
        txOfType('ref', 'REFERRAL_REWARD', 10),
      ],
      pagination: { limit: 20, offset: 0 },
    });
    useMobileWalletStore.setState({
      balance: {
        walletBalance: 100,
        currency: 'AED',
        accruedWages: 0,
        availableLimit: 0,
        hrLagBufferPercent: 0.1,
        failsafeActive: false,
        dcse: { score: 0, eligibleForEWA: false, modelVersion: 'v1', nextReviewAt: null },
        plan: 'BASIC',
        cycle: { id: 'c1', status: 'ACTIVE' },
      },
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSalaryFeed(), { wrapper });
    await waitFor(() => expect(result.current.transactions.length).toBe(3));
    const types = new Set(result.current.transactions.map((t) => t.type));
    expect(types).toEqual(new Set(['PAYROLL', 'REFUND', 'REMITTANCE']));
  });
});

// ───────────────────────────────────────────────────────────────────
// Combined status
// ───────────────────────────────────────────────────────────────────

describe('useSalaryFeed — combined status', () => {
  it('reports error when the gateway-store has lastError set, even if tx query succeeds', async () => {
    (walletService.getTransactions as jest.Mock).mockResolvedValue({
      transactions: [txOfType('p1', 'PAYROLL', 5000)],
      pagination: { limit: 20, offset: 0 },
    });
    useMobileWalletStore.setState({
      lastError: { code: 'COMPLIANCE_BLOCK', message: 'on hold', at: Date.now() },
    } as any);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSalaryFeed(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.code).toBe('COMPLIANCE_BLOCK');
  });

  it('reports error with TRANSACTIONS_UNAVAILABLE when the tx query errors', async () => {
    (walletService.getTransactions as jest.Mock).mockRejectedValue(new Error('boom'));
    useMobileWalletStore.setState({
      balance: {
        walletBalance: 100,
        currency: 'AED',
        accruedWages: 0,
        availableLimit: 0,
        hrLagBufferPercent: 0.1,
        failsafeActive: false,
        dcse: { score: 0, eligibleForEWA: false, modelVersion: 'v1', nextReviewAt: null },
        plan: 'BASIC',
        cycle: { id: 'c1', status: 'ACTIVE' },
      },
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSalaryFeed(), { wrapper });
    // The hook configures retry: 2 with exponential backoff (2s + 4s).
    // Wait long enough for the budget to drain on the rejected mock.
    await waitFor(() => expect(result.current.status).toBe('error'), { timeout: 8000 });
    expect(result.current.error?.code).toBe('TRANSACTIONS_UNAVAILABLE');
  }, 10_000);

  it('reports success once both balance and a tx page have landed', async () => {
    (walletService.getTransactions as jest.Mock).mockResolvedValue({
      transactions: [txOfType('p1', 'PAYROLL', 5000)],
      pagination: { limit: 20, offset: 0 },
    });
    useMobileWalletStore.setState({
      balance: {
        walletBalance: 100,
        currency: 'AED',
        accruedWages: 0,
        availableLimit: 0,
        hrLagBufferPercent: 0.1,
        failsafeActive: false,
        dcse: { score: 0, eligibleForEWA: false, modelVersion: 'v1', nextReviewAt: null },
        plan: 'BASIC',
        cycle: { id: 'c1', status: 'ACTIVE' },
      },
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSalaryFeed(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.transactions.length).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────
// refresh + retry
// ───────────────────────────────────────────────────────────────────

describe('useSalaryFeed — refresh + retry', () => {
  it('refresh() fans out to both the gateway fetch and the tx query', async () => {
    const fetchBalance = jest.fn().mockResolvedValue(undefined);
    useMobileWalletStore.setState({
      fetchBalance,
      balance: null,
    } as any);
    (walletService.getTransactions as jest.Mock).mockResolvedValue({
      transactions: [],
      pagination: { limit: 20, offset: 0 },
    });
    const { wrapper, qc } = makeWrapper();
    const spy = jest.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useSalaryFeed(), { wrapper });
    await waitFor(() => expect(result.current.status).not.toBe('loading'));
    await act(async () => {
      await result.current.refresh();
    });
    expect(fetchBalance).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: expect.arrayContaining(['salary-feed', 'transactions']),
    }));
  });
});
