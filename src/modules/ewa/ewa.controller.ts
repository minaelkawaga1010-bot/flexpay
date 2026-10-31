import { Response, Router } from 'express';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { AppError } from '@shared/utils/errors';
import logger from '@shared/utils/logger';

/**
 * Legacy EWA issuance endpoint — DISABLED (TASK-014).
 *
 * POST /api/v1/ewa/request historically created a Loan row and a FlexxPay
 * advance-request directly, checking only the per-request `maxEWAAmount`.
 * It never enforced the cumulative per-cycle advance limit, never took the
 * EWA/WALLET_DEBIT advisory lock, and bypassed the protected reserveAdvance
 * path (TASK-009) entirely — so an employee could create unbounded PENDING
 * advances, each at or below the single-request cap, summing far beyond
 * their cumulative eligibility.
 *
 * New advance issuance now flows exclusively through the protected
 * /mobile/wallet/advance/request → reserveAdvance path (JWT × device ×
 * biometric × step-up OTP, with the cumulative limit enforced atomically
 * under the advisory lock). This route is contained: it FAILS CLOSED with
 * 410 Gone before any database write, provider submission, advance/loan
 * creation, or wallet effect. It is deliberately NOT auto-redirected to the
 * new flow — that flow has device-binding, step-up, KYC and limit checks
 * this route cannot satisfy (TASK-014 §8). Historical loans, settlements,
 * repayments, and reconciliation records are untouched.
 */

const LEGACY_DISABLED_MESSAGE =
  'This endpoint is no longer available. Earned-wage advances are issued only through the FlexPay mobile app.';

export class EwaController {
  public readonly router = Router();

  constructor() {
    // Authentication is preserved so the route's contract is unchanged, but
    // issuance is gone: the handler refuses every request variation
    // (any payload, any Idempotency-Key, concurrent or repeated) before any
    // side effect can occur.
    this.router.post('/request', authenticate('employee'), asyncHandler(this.requestAdvanceDisabled));
  }

  private requestAdvanceDisabled = async (req: AuthRequest, _res: Response): Promise<void> => {
    logger.warn('Legacy EWA issuance endpoint called — refused (TASK-014)', {
      employeeId: req.user?.id,
    });
    throw new AppError(410, 'EWA_LEGACY_ENDPOINT_DISABLED', LEGACY_DISABLED_MESSAGE);
  };
}

export const ewaController = new EwaController();
