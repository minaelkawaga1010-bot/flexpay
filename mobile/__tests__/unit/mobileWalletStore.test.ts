/**
 * useMobileWalletStore — advance double-tap guard + loading lifecycle.
 *
 * Audit Phase 3: tapping "Withdraw" must lock the UI for the duration
 * of the advisory-locked server tx. A second tap while one reservation
 * is in flight must be a no-op (no second biometric prompt / step-up
 * race), and the lock must always release (success OR failure) so the
 * screen never freezes.
 */

jest.mock('@services/api/wallet.gateway', () => ({
  walletGateway: {
    requestEwaAdvance: jest.fn(),
    fetchBalance: jest.fn().mockResolvedValue(undefined),
  },
}));

import { walletGateway } from '@services/api/wallet.gateway';
import { useMobileWalletStore, paddedAvailableLimit } from '@store/useMobileWalletStore';

const mockedGateway = walletGateway as unknown as {
  requestEwaAdvance: jest.Mock;
  fetchBalance: jest.Mock;
};

function seedBalance(availableLimit = 5000) {
  useMobileWalletStore.setState({
    balance: {
      walletBalance: 1000,
      currency: 'AED',
      accruedWages: 10000,
      availableLimit,
      hrLagBufferPercent: 0,
      failsafeActive: false,
      dcse: { score: 0.8, eligibleForEWA: true, modelVersion: 'v1', nextReviewAt: null },
      plan: 'BASIC',
      cycle: { id: 'cyc-1', status: 'ACTIVE' },
    } as any,
    isSubmittingAdvance: false,
    lastError: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useMobileWalletStore.getState().reset();
});

describe('requestAdvance — double-tap guard', () => {
  it('ignores a second tap while a reservation is in flight (no second gateway call)', async () => {
    seedBalance();
    // First call hangs until we resolve it.
    let resolveFirst: (v: unknown) => void = () => {};
    mockedGateway.requestEwaAdvance.mockImplementationOnce(
      () => new Promise((res) => { resolveFirst = res; }),
    );

    const first = useMobileWalletStore.getState().requestAdvance({ amount: 100 });
    // Lock is engaged synchronously after dispatch.
    expect(useMobileWalletStore.getState().isSubmittingAdvance).toBe(true);

    // Second tap while in flight → no-op, returns null, no extra call.
    const second = await useMobileWalletStore.getState().requestAdvance({ amount: 100 });
    expect(second).toBeNull();
    expect(mockedGateway.requestEwaAdvance).toHaveBeenCalledTimes(1);

    // Resolve the first; lock releases.
    resolveFirst({ advanceId: 'adv-1', amount: 100, fee: 10, currency: 'AED', status: 'RESERVED', cycleId: 'cyc-1', reservedAt: new Date() });
    await first;
    expect(useMobileWalletStore.getState().isSubmittingAdvance).toBe(false);
  });

  it('releases the lock after a successful reservation', async () => {
    seedBalance();
    mockedGateway.requestEwaAdvance.mockResolvedValueOnce({
      advanceId: 'adv-2', amount: 200, fee: 10, currency: 'AED', status: 'RESERVED', cycleId: 'cyc-1', reservedAt: new Date(),
    });
    const result = await useMobileWalletStore.getState().requestAdvance({ amount: 200 });
    expect(result).toMatchObject({ advanceId: 'adv-2' });
    expect(useMobileWalletStore.getState().isSubmittingAdvance).toBe(false);
  });

  it('releases the lock after a failure (no frozen screen on network dropout)', async () => {
    seedBalance();
    mockedGateway.requestEwaAdvance.mockRejectedValueOnce(new Error('Network Error'));
    const result = await useMobileWalletStore.getState().requestAdvance({ amount: 200 });
    expect(result).toBeNull();
    expect(useMobileWalletStore.getState().isSubmittingAdvance).toBe(false);
    expect(useMobileWalletStore.getState().lastError?.code).toBe('UNKNOWN');
  });

  it('does not engage the lock when the client-side cap rejects the amount', async () => {
    seedBalance(50); // availableLimit 50
    const result = await useMobileWalletStore.getState().requestAdvance({ amount: 100 });
    expect(result).toBeNull();
    expect(mockedGateway.requestEwaAdvance).not.toHaveBeenCalled();
    expect(useMobileWalletStore.getState().isSubmittingAdvance).toBe(false);
    expect(useMobileWalletStore.getState().lastError?.code).toBe('OVER_AVAILABLE_LIMIT');
  });
});

describe('paddedAvailableLimit — buffer mirror', () => {
  it('takes the tighter of server availableLimit and locally-buffered accrued', () => {
    const balance = {
      accruedWages: 1000,
      availableLimit: 990,
      hrLagBufferPercent: 0.1,
    } as any;
    // bufferedAccrued = 1000 × 0.9 = 900 < 990 → 900 wins
    expect(paddedAvailableLimit(balance)).toBe(900);
  });
});
