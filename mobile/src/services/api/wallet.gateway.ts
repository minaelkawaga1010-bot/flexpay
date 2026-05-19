import { z } from 'zod';
import mobileGateway, { BiometricStaleError } from './mobileGateway.client';
import { biometricContext } from './biometricContext';
import logger from '@services/utils/logger';
import { useStepUpStore } from '@store/useStepUpStore';

/**
 * Mobile-wallet gateway service.
 *
 * Maps 1:1 to the backend routes in src/modules/mobile-api/wallet.controller.ts:
 *
 *   GET  /balance                — read-only
 *   GET  /cards                  — read-only
 *   POST /step-up-otp/request    — auth required only
 *   POST /advance/request        — JWT × device × biometric × OTP('ADVANCE')
 *   POST /remittance/quote       — auth required only
 *   POST /remittance/send        — JWT × device × biometric × OTP('REMITTANCE')
 *
 * Response validation is Zod end-to-end: parsing failures throw rather
 * than silently corrupting downstream state. Cheap insurance against
 * server-side schema drift slipping through to the UI.
 */

// ───────────────────────────────────────────────────────────────────
// Response schemas — kept in sync with the controller handlers
// ───────────────────────────────────────────────────────────────────

const balanceSchema = z.object({
  walletBalance: z.number(),
  currency: z.literal('AED'),
  accruedWages: z.number(),
  /**
   * Server-computed availableLimit = MAX(0, MIN(DCSE, accrued) - fee).
   * Encodes I1 (advance ≤ accrued) and the fixed processing fee in a
   * single client-binding value. The UI MUST cap user-entered advance
   * amounts at this — the server enforces it again at reserveAdvance,
   * but a UX-level cap stops the round-trip on obvious overrequests.
   */
  availableLimit: z.number(),
  dcse: z.object({
    score: z.number(),
    eligibleForEWA: z.boolean(),
    modelVersion: z.string(),
    nextReviewAt: z.union([z.string(), z.date(), z.null()]).optional(),
  }),
  plan: z.enum(['BASIC', 'LUXURY']),
  cycle: z.object({
    id: z.string().nullable(),
    status: z.enum(['ACTIVE', 'NO_ACTIVE_CYCLE']),
  }),
});
export type WalletBalance = z.infer<typeof balanceSchema>;

const advanceResultSchema = z.object({
  advanceId: z.string(),
  amount: z.number(),
  fee: z.number(),
  currency: z.string(),
  status: z.string(),
  cycleId: z.string(),
  reservedAt: z.union([z.string(), z.date()]),
});
export type AdvanceResult = z.infer<typeof advanceResultSchema>;

const remittanceQuoteSchema = z.object({
  quoteId: z.string(),
  amount: z.number(),
  currency: z.string(),
  rate: z.number(),
  fee: z.number(),
  recipientAmount: z.number(),
  totalDebit: z.number(),
  fxMarginAppliedBps: z.number(),
  validForSeconds: z.number(),
  issuedAt: z.number(),
  disclaimer: z.string(),
});
export type RemittanceQuote = z.infer<typeof remittanceQuoteSchema>;

const remittanceSendResultSchema = z.object({
  transferId: z.string(),
  estimatedDelivery: z.union([z.string(), z.date()]),
  recipientAmount: z.number(),
  fee: z.number(),
});
export type RemittanceSendResult = z.infer<typeof remittanceSendResultSchema>;

const stepUpOtpRequestResultSchema = z.object({
  message: z.string().optional(),
  expiresIn: z.number(),
});
export type StepUpOtpRequestResult = z.infer<typeof stepUpOtpRequestResultSchema>;

// ───────────────────────────────────────────────────────────────────
// Input schemas — fail-fast at the call site
// ───────────────────────────────────────────────────────────────────

export const advanceInputSchema = z.object({
  amount: z.number().positive().max(10_000),
  reason: z.string().max(280).optional(),
});

export const remittanceQuoteInputSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3).toUpperCase(),
});

export const beneficiarySchema = z.object({
  name: z.string().min(2),
  bankAccount: z.string().min(4),
  swiftCode: z.string().min(4),
});
export type Beneficiary = z.infer<typeof beneficiarySchema>;

// ───────────────────────────────────────────────────────────────────
// Service
// ───────────────────────────────────────────────────────────────────

/**
 * Ensure a fresh biometric assertion is loaded before a transactional
 * call. Returns true iff the cache is fresh OR the user just completed
 * a successful prompt. Returns false on user-cancel — caller must NOT
 * proceed with the network call in that case.
 */
async function ensureFreshBiometric(reason: string): Promise<boolean> {
  if (biometricContext.freshHeaders()) return true;
  return biometricContext.authenticateFresh(reason);
}

export const walletGateway = {
  // ─────── Read-only ───────

  async fetchBalance(): Promise<WalletBalance> {
    const { data } = await mobileGateway.get('/balance');
    return balanceSchema.parse(data);
  },

  async fetchCards(): Promise<{ cards: unknown[] }> {
    const { data } = await mobileGateway.get('/cards');
    return data as { cards: unknown[] };
  },

  // ─────── Step-up OTP lifecycle ───────

  /**
   * Request the backend to SMS a single-use OTP for the given purpose.
   * The mobile gateway's `requireStepUpOtp` middleware will accept the
   * resulting code only against the matching purpose — so an ADVANCE
   * code cannot satisfy a REMITTANCE requirement. This is the call the
   * step-up modal triggers BEFORE the user starts typing.
   */
  async requestStepUpOtp(
    purpose: 'ADVANCE' | 'REMITTANCE' | 'CARD_TOKENIZE' | 'P2P_HIGH_VALUE',
  ): Promise<StepUpOtpRequestResult> {
    const { data } = await mobileGateway.post('/step-up-otp/request', { purpose });
    return stepUpOtpRequestResultSchema.parse(data);
  },

  // ─────── Transactional ───────

  /**
   * Reserve an EWA advance.
   *
   * Two-stage call:
   *   1. Prompt FaceID / TouchID / fallback to passcode — fail-fast if
   *      sensor refuses, before any header machinery engages.
   *   2. Fire POST /advance/request with meta.requiresBiometric +
   *      meta.stepUpPurpose. The gateway interceptor handles the OTP
   *      modal handshake on the FIRST request (the backend returns 403
   *      "Step-up OTP required" if X-Step-Up-OTP is missing), then the
   *      retry carries the OTP and lands.
   *
   * Caller passes `bypassOtp` only when the OTP was already obtained
   * out-of-band (e.g. the UI pre-requested it). Without it, the modal
   * fires reactively on the first 403.
   */
  async requestEwaAdvance(args: {
    amount: number;
    reason?: string;
    /** Pre-obtained OTP — when omitted, the interceptor pulls one via the modal. */
    otp?: string;
  }): Promise<AdvanceResult> {
    const payload = advanceInputSchema.parse({
      amount: args.amount,
      reason: args.reason,
    });

    const fresh = await ensureFreshBiometric(`Authorize advance of ${payload.amount} AED`);
    if (!fresh) throw new BiometricStaleError();

    const { data } = await mobileGateway.post('/advance/request', payload, {
      meta: {
        requiresBiometric: true,
        stepUpPurpose: 'ADVANCE',
      },
      headers: args.otp ? { 'X-Step-Up-OTP': args.otp } : undefined,
    });
    return advanceResultSchema.parse(data);
  },

  /**
   * Quote a remittance — locks the priced quote in the backend's Redis
   * for 60s. The returned `validForSeconds` is the UI's countdown for
   * the confirm screen.
   *
   * No biometric or OTP required at quote-time — the lock itself binds
   * the user (server enforces `quote.employeeId === req.user.id`) and
   * a stale quote auto-expires server-side.
   */
  async requestRemittanceQuote(input: {
    amount: number;
    currency: string;
  }): Promise<RemittanceQuote> {
    const payload = remittanceQuoteInputSchema.parse(input);
    const { data } = await mobileGateway.post('/remittance/quote', payload);
    return remittanceQuoteSchema.parse(data);
  },

  /**
   * Confirm + execute a previously-quoted remittance.
   *
   * Carries the four-factor stack identical to /advance/request, plus
   * the locked quoteId — the backend single-uses the lock so a network
   * retry can't double-execute.
   */
  async confirmRemittance(args: {
    quoteId: string;
    beneficiary: Beneficiary;
    otp?: string;
  }): Promise<RemittanceSendResult> {
    const beneficiary = beneficiarySchema.parse(args.beneficiary);

    const fresh = await ensureFreshBiometric('Authorize international transfer');
    if (!fresh) throw new BiometricStaleError();

    const { data } = await mobileGateway.post(
      '/remittance/send',
      { quoteId: args.quoteId, beneficiary },
      {
        meta: {
          requiresBiometric: true,
          stepUpPurpose: 'REMITTANCE',
        },
        headers: args.otp ? { 'X-Step-Up-OTP': args.otp } : undefined,
      },
    );
    return remittanceSendResultSchema.parse(data);
  },

  /**
   * Convenience: pre-request the OTP and present the modal explicitly,
   * for UI flows where the confirmation screen primes the OTP rather
   * than reacting to a 403 on first submit.
   */
  async primeStepUp(
    purpose: 'ADVANCE' | 'REMITTANCE',
    hint?: string,
  ): Promise<string> {
    await this.requestStepUpOtp(purpose);
    const code = await useStepUpStore.getState().enqueue({ purpose, hint });
    logger.info('step-up primed by UI', { purpose });
    return code;
  },
};

export default walletGateway;
