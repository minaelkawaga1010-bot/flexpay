import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import logger from '@services/utils/logger';

/**
 * Pending step-up OTP challenges.
 *
 * Lifecycle:
 *   1. The mobile-gateway response interceptor catches a 403 with
 *      `STEP_UP_OTP_REQUIRED` (or the backend's "Step-up OTP required"
 *      message). It calls `enqueue({ purpose, resolve, reject })`,
 *      which:
 *        a. records the challenge in the store
 *        b. surfaces the global OTP modal (any UI subscribed to the
 *           `pending` field renders it)
 *        c. returns the promise to the original axios chain — the
 *           original request is suspended awaiting OTP.
 *   2. The OTP screen calls `submit(code)`. The store resolves the
 *      stored promise with the code; the interceptor injects
 *      X-Step-Up-OTP and retries the request once.
 *   3. The OTP screen calls `cancel()` on dismiss — the promise is
 *      rejected so the original axios chain unwinds with a typed error.
 *
 * Only ONE challenge can be in-flight at a time. A new enqueue while
 * one is pending replaces it (rejects the old one with
 * `STEP_UP_REPLACED`). This avoids OTP modal stacking and the resulting
 * user confusion when two transactions race.
 */

export type StepUpPurpose = 'ADVANCE' | 'REMITTANCE' | 'CARD_TOKENIZE' | 'P2P_HIGH_VALUE';

export class StepUpError extends Error {
  constructor(public readonly reason: 'CANCELLED' | 'REPLACED' | 'TIMEOUT') {
    super(`STEP_UP_${reason}`);
    this.name = 'StepUpError';
  }
}

interface Challenge {
  id: string;
  purpose: StepUpPurpose;
  /** Human-readable hint surfaced in the modal — e.g. "Advance of 500 AED". */
  hint?: string;
  createdAt: number;
}

interface PendingResolvers {
  resolve: (code: string) => void;
  reject: (err: Error) => void;
}

interface StepUpState {
  pending: Challenge | null;
  enqueue: (args: {
    purpose: StepUpPurpose;
    hint?: string;
  }) => Promise<string>;
  submit: (code: string) => void;
  cancel: () => void;
  /** Internal — used by the timeout watchdog. */
  _internalReject: (reason: 'TIMEOUT') => void;
}

let resolvers: PendingResolvers | null = null;
let watchdog: ReturnType<typeof setTimeout> | null = null;
const CHALLENGE_TIMEOUT_MS = 4 * 60_000; // 4min — backend OTP is 5min; keep the modal 1min short

/** Clear the watchdog timer so it can't accumulate across rapid challenges. */
function clearWatchdog(): void {
  if (watchdog !== null) {
    clearTimeout(watchdog);
    watchdog = null;
  }
}

export const useStepUpStore = create<StepUpState>()(
  immer((set) => ({
    pending: null,

    enqueue: ({ purpose, hint }) => {
      // Reject any pre-existing pending challenge with REPLACED and
      // clear its watchdog so timers don't accumulate across rapid
      // re-challenges.
      if (resolvers) {
        resolvers.reject(new StepUpError('REPLACED'));
        resolvers = null;
      }
      clearWatchdog();
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      set((s) => {
        s.pending = { id, purpose, hint, createdAt: Date.now() };
      });
      logger.info('step-up challenge raised', { id, purpose });
      return new Promise<string>((resolve, reject) => {
        resolvers = { resolve, reject };
        // Watchdog: auto-cancel if the user never engages the modal.
        watchdog = setTimeout(() => {
          watchdog = null;
          if (resolvers && useStepUpStore.getState().pending?.id === id) {
            useStepUpStore.getState()._internalReject('TIMEOUT');
          }
        }, CHALLENGE_TIMEOUT_MS);
      });
    },

    submit: (code) => {
      const r = resolvers;
      resolvers = null;
      clearWatchdog();
      set((s) => {
        s.pending = null;
      });
      if (r) r.resolve(code);
    },

    cancel: () => {
      const r = resolvers;
      resolvers = null;
      clearWatchdog();
      set((s) => {
        s.pending = null;
      });
      if (r) r.reject(new StepUpError('CANCELLED'));
    },

    _internalReject: (reason) => {
      const r = resolvers;
      resolvers = null;
      clearWatchdog();
      set((s) => {
        s.pending = null;
      });
      if (r) r.reject(new StepUpError(reason));
    },
  })),
);
