import { useCallback, useEffect, useRef, useState } from 'react';
import { cardsService, type SensitiveCardDetails } from '@services/api/cards';
import { useBiometrics } from '@hooks/useBiometrics';
import logger from '@services/utils/logger';

/**
 * useCardReveal — biometric-gated, auto-clearing card-detail reveal.
 *
 * Security invariants:
 *
 *   1. **Zero cross-screen persistence.** The unmasked PAN / CVV are
 *      held in COMPONENT-LOCAL state via this hook's `details` field.
 *      They are NEVER written to Zustand, AsyncStorage, Keychain, or
 *      any cache the React tree can read from elsewhere. Unmounting
 *      the component clears the state — same lifecycle as plain
 *      `useState`.
 *
 *   2. **Auto-clear timer.** After `autoClearMs` (default 30s) the
 *      hook re-masks the card without user action. The user must
 *      re-authenticate to view again. A new biometric prompt is
 *      cheaper than holding sensitive data resident in memory.
 *
 *   3. **Biometric gate FIRST.** The backend reveal endpoint also
 *      gates via step-up OTP — but we ALSO require a local biometric
 *      prompt before the network call so a borrowed-and-unlocked
 *      phone cannot pull the PAN. Cancelled biometrics short-circuit
 *      before any network traffic.
 *
 *   4. **No PAN in logs.** The hook logs only state transitions and
 *      cardId; the sensitive payload is never put through `logger`.
 *
 * Returns an AsyncValue-shaped view: idle / loading / error / revealed,
 * plus an explicit `reveal()` action and `hide()` to clear early.
 */

export type CardRevealStatus = 'idle' | 'authenticating' | 'loading' | 'revealed' | 'error';

export interface CardRevealView {
  status: CardRevealStatus;
  /** Set ONLY while status === 'revealed'. Cleared on hide / unmount / auto-clear. */
  details: SensitiveCardDetails | null;
  /** Seconds remaining on the auto-clear countdown. Null when not revealed. */
  secondsRemaining: number | null;
  error: { code: string; message: string } | null;
  reveal: () => Promise<void>;
  hide: () => void;
}

interface UseCardRevealOptions {
  cardId: string;
  /** Auto-clear timeout. Default 30 s — short enough to limit memory residency,
   *  long enough for a user to copy the number into a checkout form. */
  autoClearMs?: number;
  /** Reason string shown by the biometric prompt. */
  biometricPromptReason?: string;
}

const DEFAULT_AUTO_CLEAR_MS = 30_000;

export function useCardReveal({
  cardId,
  autoClearMs = DEFAULT_AUTO_CLEAR_MS,
  biometricPromptReason = 'Show full card details',
}: UseCardRevealOptions): CardRevealView {
  const biometrics = useBiometrics();
  const [status, setStatus] = useState<CardRevealStatus>('idle');
  const [details, setDetails] = useState<SensitiveCardDetails | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimers = useCallback(() => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    if (tickTimerRef.current) {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    stopTimers();
    setDetails(null);
    setSecondsRemaining(null);
    setStatus('idle');
    setError(null);
  }, [stopTimers]);

  // Unmount guarantees no sensitive data outlives the component.
  useEffect(() => () => hide(), [hide]);

  const reveal = useCallback(async () => {
    if (status === 'loading' || status === 'authenticating') return;
    setError(null);

    // ── 1. Biometric gate. Cancelled bio short-circuits with no
    //      network traffic and no audit-trail noise. The hook stays
    //      in `idle` so the user can retry without a state reset.
    if (biometrics.available) {
      setStatus('authenticating');
      const ok = await biometrics.authenticate(biometricPromptReason);
      if (!ok) {
        setStatus('idle');
        return;
      }
    } else {
      // Defensive: in dev / simulator the sensor may report
      // unavailable. We do NOT silently bypass — we surface a
      // distinct error so the test build doesn't hand out PANs.
      setError({ code: 'BIOMETRICS_UNAVAILABLE', message: 'Biometric authentication is required to reveal card details.' });
      setStatus('error');
      return;
    }

    // ── 2. Network fetch. The backend additionally gates on
    //      step-up OTP, but the gateway interceptor handles that
    //      transparently — we just await the success path here.
    setStatus('loading');
    try {
      const payload = await cardsService.revealCard(cardId);
      setDetails(payload);
      setStatus('revealed');

      // ── 3. Auto-clear timer + 1Hz countdown for the UI.
      const startedAt = Date.now();
      setSecondsRemaining(Math.ceil(autoClearMs / 1000));
      tickTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, autoClearMs - elapsed);
        setSecondsRemaining(Math.ceil(remaining / 1000));
      }, 1000);
      clearTimerRef.current = setTimeout(() => {
        logger.debug('card-reveal: auto-clear fired', { cardId });
        hide();
      }, autoClearMs);
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'REVEAL_FAILED';
      const message = (err as Error).message ?? 'Could not retrieve card details.';
      logger.warn('card-reveal: fetch failed', { cardId, code });
      setError({ code, message });
      setStatus('error');
    }
  }, [autoClearMs, biometricPromptReason, biometrics, cardId, hide, status]);

  return { status, details, secondsRemaining, error, reveal, hide };
}
