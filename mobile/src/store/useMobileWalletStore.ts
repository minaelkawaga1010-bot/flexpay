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
 * The `availableLimit` field on the balance response IS the buffered
 * I1-cap the UI should respect. The HR data-lag haircut
 * (`hrLagBufferPercent`) is already folded into availableLimit
 * server-side; we ALSO mirror the factor client-side to display the
 * padded figure and as a defensive cross-check (see paddedAvailableLimit).
 */

interface LastError {
  code: string;
  message: string;
  at: number;
}

/**
 * Client-side mirror of the HR-lag haircut. The server's
 * `availableLimit` already nets the buffer + fee and is authoritative,
 * but we re-derive the buffered-accrued figure from the ingested
 * `hrLagBufferPercent` and take the TIGHTER of the two. This guarantees
 * the UI never offers more than the server's buffered ceiling even if a
 * stale balance is in state — zero client/server mismatch.
 *
 *   bufferedAccrued = accruedWages × (1 − hrLagBufferPercent)
 *   paddedLimit     = MAX(0, MIN(server.availableLimit, bufferedAccrued))
 */
export function paddedAvailableLimit(balance: WalletBalance): number {
  const buffer = Number.isFinite(balance.hrLagBufferPercent) ? balance.hrLagBufferPercent : 0;
  const bufferedAccrued = balance.accruedWages * (1 - buffer);
  return Math.max(0, Math.min(balance.availableLimit, bufferedAccrued));
}

interface MobileWalletState {
  balance: WalletBalance | null;
  isLoading: boolean;
  /**
   * In-flight guard for the EWA request. True from the moment a request
   * is dispatched until it settles. Screens bind the "Withdraw" button's
   * loading/disabled state to this so a double-tap can't fire two
   * concurrent reservations (which would double-prompt biometrics and
   * race the step-up modal — the second enqueue would REPLACE the first
   * with a STEP_UP_REPLACED rejection). The server advisory lock already
   * prevents double-spend; this closes the UX hole above it.
   */
  isSubmittingAdvance: boolean;
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
    isSubmittingAdvance: false,
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
      // Double-tap guard: if a reservation is already in flight, ignore
      // the repeat tap entirely. Prevents two concurrent biometric
      // prompts + a step-up modal race (the 2nd enqueue would REPLACE
      // the 1st with a STEP_UP_REPLACED rejection). No-op return, no
      // error surfaced — the first request owns the flow.
      if (useMobileWalletStore.getState().isSubmittingAdvance) {
        return null;
      }

      // Cheap UI-side cap so the user can't even submit an obviously
      // over-limit number. Uses the HR-lag-buffer-mirrored padded limit
      // (the tighter of server availableLimit and locally-buffered
      // accrued) so the client cap matches what reserveAdvance enforces
      // inside its locked transaction.
      const current = useMobileWalletStore.getState().balance;
      if (current) {
        const cap = paddedAvailableLimit(current);
        if (amount > cap) {
          // Surface WHY the cap is low: a tripped cohort failsafe pins
          // the limit at 20% accrued; otherwise it's the HR-lag haircut.
          const reasonSuffix = current.failsafeActive
            ? ' Your employer cohort is under temporary review, so limits are reduced.'
            : '';
          set((s) => {
            s.lastError = {
              code: 'OVER_AVAILABLE_LIMIT',
              message: `Requested ${amount} AED exceeds your available limit of ${cap} AED.${reasonSuffix}`,
              at: Date.now(),
            };
          });
          return null;
        }
      }

      // Lock the UI for the duration of the advisory-locked server tx.
      set((s) => {
        s.isSubmittingAdvance = true;
      });
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
      } finally {
        // Always release the lock — network timeout, biometric cancel,
        // step-up dismissal, or success all unlock the button. No path
        // leaves the UI frozen.
        set((s) => {
          s.isSubmittingAdvance = false;
        });
      }
    },

    reset: () =>
      set((s) => {
        s.balance = null;
        s.isSubmittingAdvance = false;
        s.lastFetchAt = null;
        s.lastError = null;
      }),

    clearError: () =>
      set((s) => {
        s.lastError = null;
      }),
  })),
);
