import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { walletGateway, type WalletBalance } from '@services/api/wallet.gateway';
import { BiometricStaleError, ComplianceBlockError } from '@services/api/mobileGateway.client';
import { StepUpError } from '@store/useStepUpStore';
import logger from '@services/utils/logger';

/**
 * Mobile-wallet store dedicated to the secure-gateway surface.
 *
 * Kept separate from the legacy `useWalletStore` (which serves the
 * /wallet/* non-gateway routes) so the gateway-only state — DCSE
 * snapshot, accrued wages, server-computed availableLimit — has a
 * single source of truth and screens can bind to it without
 * accidentally pulling legacy P2P state.
 *
 * The `availableLimit` field on the balance response IS the I1-cap the
 * UI should respect. Don't recompute it client-side; trust the server.
 */

interface LastError {
  code: string;
  message: string;
  at: number;
}

interface MobileWalletState {
  balance: WalletBalance | null;
  isLoading: boolean;
  lastFetchAt: number | null;
  /** Surface the most recent gateway error in a structured way for screens to react to. */
  lastError: LastError | null;

  fetchBalance: () => Promise<void>;
  requestAdvance: (args: { amount: number; reason?: string }) => Promise<{
    advanceId: string;
    amount: number;
    fee: number;
    status: string;
  } | null>;
  reset: () => void;
  clearError: () => void;
}

function toLastError(err: unknown): LastError {
  if (err instanceof ComplianceBlockError) {
    return { code: err.code, message: err.serverMessage, at: Date.now() };
  }
  if (err instanceof BiometricStaleError) {
    return { code: 'BIOMETRIC_STALE', message: 'Please re-authenticate with biometrics.', at: Date.now() };
  }
  if (err instanceof StepUpError) {
    return { code: `STEP_UP_${err.reason}`, message: 'Verification was not completed.', at: Date.now() };
  }
  const msg = err instanceof Error ? err.message : 'Unknown error';
  return { code: 'UNKNOWN', message: msg, at: Date.now() };
}

export const useMobileWalletStore = create<MobileWalletState>()(
  immer((set) => ({
    balance: null,
    isLoading: false,
    lastFetchAt: null,
    lastError: null,

    fetchBalance: async () => {
      set((s) => {
        s.isLoading = true;
      });
      try {
        const balance = await walletGateway.fetchBalance();
        set((s) => {
          s.balance = balance;
          s.lastFetchAt = Date.now();
          s.lastError = null;
        });
      } catch (err) {
        logger.error('mobileWallet: fetchBalance failed', { error: (err as Error).message });
        set((s) => {
          s.lastError = toLastError(err);
        });
      } finally {
        set((s) => {
          s.isLoading = false;
        });
      }
    },

    requestAdvance: async ({ amount, reason }) => {
      // Cheap UI-side cap so the user can't even submit an obviously
      // over-limit number. Server enforces it again via I1 inside the
      // reserveAdvance transaction.
      const current = useMobileWalletStore.getState().balance;
      if (current && amount > current.availableLimit) {
        set((s) => {
          s.lastError = {
            code: 'OVER_AVAILABLE_LIMIT',
            message: `Requested ${amount} AED exceeds your available limit of ${current.availableLimit} AED.`,
            at: Date.now(),
          };
        });
        return null;
      }
      try {
        const result = await walletGateway.requestEwaAdvance({ amount, reason });
        // Re-fetch balance to pick up updated walletBalance and the
        // freshly debited accrued amount.
        void useMobileWalletStore.getState().fetchBalance();
        return {
          advanceId: result.advanceId,
          amount: result.amount,
          fee: result.fee,
          status: result.status,
        };
      } catch (err) {
        logger.error('mobileWallet: requestAdvance failed', { error: (err as Error).message });
        set((s) => {
          s.lastError = toLastError(err);
        });
        return null;
      }
    },

    reset: () =>
      set((s) => {
        s.balance = null;
        s.lastFetchAt = null;
        s.lastError = null;
      }),

    clearError: () =>
      set((s) => {
        s.lastError = null;
      }),
  })),
);
