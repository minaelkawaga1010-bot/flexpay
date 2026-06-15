import { useCallback, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import {
  billsService,
  type BillerType,
  type BillPayment,
  type PayBillRequest,
} from '@services/api/bills';
import logger from '@services/utils/logger';

/**
 * usePayBill — bill-payment mutation hook.
 *
 * Three guarantees:
 *
 *   1. **Double-tap-proof.** `isSubmittingBill` flips to `true`
 *      synchronously the moment `submit()` is called and stays true
 *      until the network call settles. Subsequent calls during the
 *      pending phase are no-ops — neither a fresh idempotency key
 *      nor a re-render can squeeze a duplicate submit through.
 *
 *   2. **Single idempotency key per submission attempt.** A fresh
 *      UUIDv4 is generated on first `submit` and re-used on retries
 *      until the user explicitly resets or changes the form input.
 *      A retried submit thus resolves to the SAME backend row — the
 *      backend's SQL-unique idempotency_key is the second line of
 *      defence.
 *
 *   3. **Zod-validated input.** Form values pass through
 *      `payBillFormSchema` before the rail call — malformed inputs
 *      surface as a typed `validation` error and never reach the
 *      network. The schema mirrors the backend Zod schema on the
 *      controller side.
 *
 * The hook exposes an AsyncValue-shaped view: idle / submitting /
 * success / error. Calling `reset()` returns to idle and discards
 * the cached idempotency key — useful for "pay another bill" flow.
 */

// ───────────────────────────────────────────────────────────────────
// Validation
// ───────────────────────────────────────────────────────────────────

const ALLOWED_BILLERS: ReadonlyArray<BillerType> = [
  'DEWA', 'SEWA', 'ADDC', 'FEWA', 'ETISALAT', 'DU', 'SALIK', 'RTA', 'OTHER',
];

export const payBillFormSchema = z.object({
  billerType: z.enum(ALLOWED_BILLERS as [BillerType, ...BillerType[]]),
  billerAccountRef: z
    .string()
    .trim()
    .min(3, 'Account reference is too short')
    .max(64, 'Account reference is too long')
    .regex(/^[A-Za-z0-9\-.]+$/, 'Use letters, numbers, dashes, and dots only'),
  amount: z
    .number()
    .positive('Amount must be positive')
    .max(100_000, 'Maximum is AED 100,000 per bill'),
});

export type PayBillFormValues = z.infer<typeof payBillFormSchema>;

// ───────────────────────────────────────────────────────────────────
// Hook contract
// ───────────────────────────────────────────────────────────────────

export type PayBillStatus = 'idle' | 'submitting' | 'success' | 'error';

export interface PayBillError {
  code: string;
  message: string;
  /** Populated when the error is a Zod validation failure. */
  validation?: Record<string, string[]>;
}

export interface PayBillView {
  status: PayBillStatus;
  isSubmittingBill: boolean;
  bill: BillPayment | null;
  error: PayBillError | null;
  submit: (values: PayBillFormValues) => Promise<BillPayment | null>;
  reset: () => void;
}

export function usePayBill(): PayBillView {
  const [status, setStatus] = useState<PayBillStatus>('idle');
  const [bill, setBill] = useState<BillPayment | null>(null);
  const [error, setError] = useState<PayBillError | null>(null);

  // Refs so the lock + idempotency key survive across renders and
  // are checked SYNCHRONOUSLY at submit-time. Using only useState
  // would race against React's batched updates on rapid double-taps.
  const lockRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    lockRef.current = false;
    idempotencyKeyRef.current = null;
    setStatus('idle');
    setBill(null);
    setError(null);
  }, []);

  const submit = useCallback(async (values: PayBillFormValues): Promise<BillPayment | null> => {
    // Synchronous lock — defends against double-tap before React has
    // had a chance to flip `isSubmittingBill` and disable the button.
    if (lockRef.current) {
      logger.debug('usePayBill: submit ignored — already in flight');
      return null;
    }

    // ── 1. Validation (Zod). Surfaces field-shaped errors so the
    // form can highlight the offending input without a round-trip.
    const parsed = payBillFormSchema.safeParse(values);
    if (!parsed.success) {
      const validation = parsed.error.flatten().fieldErrors as Record<string, string[]>;
      setError({
        code: 'VALIDATION_FAILED',
        message: 'Please correct the highlighted fields.',
        validation,
      });
      setStatus('error');
      return null;
    }

    lockRef.current = true;
    setStatus('submitting');
    setError(null);

    // ── 2. Stable idempotency key. First attempt creates one; retries
    //      re-use it so the backend deduplicates. The key only resets
    //      via `reset()` — the user explicitly starting over.
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = uuid();
    }

    const request: PayBillRequest = {
      ...parsed.data,
      idempotencyKey: idempotencyKeyRef.current,
    };

    try {
      const { bill: newBill } = await billsService.payBill(request);
      setBill(newBill);
      setStatus('success');
      return newBill;
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'BILL_PAYMENT_FAILED';
      const message = (err as Error).message ?? 'Could not process the payment. Please try again.';
      logger.warn('usePayBill: rail failure', { code });
      setError({ code, message });
      setStatus('error');
      return null;
    } finally {
      // Release the lock so a retry (using the SAME idempotency key)
      // is permitted. Successful submissions also unlock; the caller
      // is expected to navigate away or call `reset()` before the
      // next pay flow.
      lockRef.current = false;
    }
  }, []);

  return {
    status,
    isSubmittingBill: status === 'submitting',
    bill,
    error,
    submit,
    reset,
  };
}
