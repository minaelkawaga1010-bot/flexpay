import { Response, Router } from 'express';
import { z } from 'zod';
import { Prisma, PayrollCycleStatus } from '@prisma/client';
import { prisma } from '@config/prisma';
import { env } from '@config/env';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { BadRequest, NotFound } from '@shared/utils/errors';
import logger from '@shared/utils/logger';
import { cardsService } from '@modules/cards/cards.service';
import { creditScoringService } from '@modules/scoring/scoring.service';
import {
  reserveAdvance,
  getEmployeeBalance,
  EWA_FIXED_FEE,
  DCSE_MODEL_VERSION,
} from '@modules/payroll-routing/payroll-routing.service';
import { deviceBinding } from './device-binding';
import { requireBiometrics } from './biometrics-verify';
import { requireStepUpOtp, stepUpOtpService } from './step-up-otp';
import {
  advanceRequestSchema,
  remittanceQuoteSchema,
  remittanceSendSchema,
  stepUpOtpRequestSchema,
} from './mobile-api.dto';
import { mobileRemittanceService } from './remittance.service';

/**
 * Mobile API gateway — wallet surface.
 *
 * All routes are mounted under /api/v1/mobile/wallet/* and require, in
 * order:
 *
 *   1. authenticate('employee')       — JWT subject is an active employee
 *   2. deviceBinding                  — known (or TOFU-registered) device
 *
 * Transactional routes additionally require:
 *
 *   3. requireBiometrics              — fresh on-device biometric assertion
 *   4. requireStepUpOtp(<purpose>)    — single-use OTP for the action
 *
 * The four-factor stack (JWT × device × biometric × OTP) is what makes
 * the difference between "session auth" and "transactional auth". Read
 * routes only carry factors 1+2; mutations carry all four.
 */

// EWA_FIXED_FEE + DCSE_MODEL_VERSION are imported from the payroll-routing
// service — single source shared with reserveAdvance + getEmployeeBalance.

export class MobileWalletController {
  public readonly router = Router();

  constructor() {
    // Common middleware for the whole mobile-wallet surface.
    this.router.use(authenticate('employee'));
    this.router.use(deviceBinding);

    // ───────────── Read-only ─────────────
    this.router.get('/balance', asyncHandler(this.getBalance));
    this.router.get('/cards', asyncHandler(this.getCards));

    // ───────────── Step-up OTP lifecycle ─────────────
    this.router.post(
      '/step-up-otp/request',
      validate(stepUpOtpRequestSchema),
      asyncHandler(this.requestStepUpOtp),
    );

    // ───────────── Transactional ─────────────
    this.router.post(
      '/advance/request',
      requireBiometrics,
      requireStepUpOtp('ADVANCE'),
      validate(advanceRequestSchema),
      asyncHandler(this.requestAdvance),
    );

    // Remittance lives under /wallet/remittance to keep one mounted router.
    this.router.post(
      '/remittance/quote',
      validate(remittanceQuoteSchema),
      asyncHandler(this.quoteRemittance),
    );
    this.router.post(
      '/remittance/send',
      requireBiometrics,
      requireStepUpOtp('REMITTANCE'),
      validate(remittanceSendSchema),
      asyncHandler(this.sendRemittance),
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Handlers
  // ──────────────────────────────────────────────────────────────────

  /**
   * GET /wallet/balance
   *
   * Returns the worker's three-axis liquidity view:
   *   - walletBalance:  AED already in the wallet (settled credits)
   *   - accruedWages:   wages already earned this cycle per HR-tech feed
   *   - availableLimit: max EWA they can take right now, =
   *                     MIN(DCSE limit, accruedWages, hard floor)
   *
   * The availableLimit is what the mobile UI shows as the "Get Advance"
   * ceiling — never the DCSE limit alone, because the WPS invariant I1
   * (`advance ≤ accrued`) is the floor.
   */
  private getBalance = async (req: AuthRequest, res: Response): Promise<void> => {
    // Single-source delegation: all EWA-availability math (I1 ×
    // failsafe × HR-lag buffer × fee) lives in getEmployeeBalance, the
    // same function reserveAdvance's gates derive from. The active
    // cycle is resolved server-side inside the helper — never supplied
    // by the client. No arithmetic here.
    const view = await getEmployeeBalance(req.user!.id);
    res.json(view);
  };

  /**
   * POST /wallet/advance/request
   *
   * Reserves an EWA advance against the worker's active payroll cycle.
   * Atomicity + invariants are enforced inside reserveAdvance() — this
   * handler's job is the gateway-level concerns: authorization (already
   * applied via middleware stack), cycle lookup, and DCSE snapshot.
   */
  private requestAdvance = async (req: AuthRequest, res: Response): Promise<void> => {
    const employeeId = req.user!.id;
    const { amount } = req.body as z.infer<typeof advanceRequestSchema>;

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { companyId: true },
    });
    if (!employee?.companyId) throw NotFound('Employee not linked to a company');

    const cycle = await prisma.payrollCycle.findFirst({
      where: {
        companyId: employee.companyId,
        status: { in: [PayrollCycleStatus.OPEN, PayrollCycleStatus.INTENTS_READY] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!cycle) throw NotFound('No active payroll cycle');

    const score = await creditScoringService.computeScore(employeeId);
    if (!score.eligibleForEWA) {
      throw BadRequest(`Not eligible for EWA at current score (${score.score})`);
    }
    if (amount > score.maxEWAAmount) {
      throw BadRequest(`Requested ${amount} exceeds DCSE limit ${score.maxEWAAmount}`);
    }

    const advance = await reserveAdvance({
      employeeId,
      cycleId: cycle.id,
      amount,
      fee: EWA_FIXED_FEE,
      dcseModelVersion: DCSE_MODEL_VERSION,
      dcseLimitAtReq: score.maxEWAAmount,
      dcseRiskScoreAtReq: score.score,
    });

    logger.info('mobile advance reserved', {
      employeeId,
      advanceId: advance.id,
      amount,
      deviceId: req.device?.id,
    });

    res.status(201).json({
      advanceId: advance.id,
      amount: advance.amount,
      fee: advance.fee,
      currency: advance.currency,
      status: advance.status,
      cycleId: advance.cycleId,
      reservedAt: advance.reservedAt,
    });
  };

  /**
   * GET /wallet/cards
   *
   * NymCard tokenization proxy: returns the worker's cards with
   * server-side card metadata + masked details. The actual
   * tokenization to Apple/Google Pay is initiated via a separate
   * endpoint (cards.controller.ts /tokenize) gated on its own step-up.
   *
   * Sensitive fields (full PAN, CVV) are never present in this
   * response — they live only inside NymCard and the secure element on
   * the device after tokenization.
   */
  private getCards = async (req: AuthRequest, res: Response): Promise<void> => {
    const cards = await cardsService.listForEmployee(req.user!.id);
    res.json({ cards });
  };

  /**
   * POST /wallet/step-up-otp/request
   *
   * Issues a fresh OTP for the requested purpose. Hard-coded to require
   * an active session + bound device — the same trust chain as the
   * transactional endpoints. Without this, the OTP itself becomes a
   * weak-link in a phishing flow.
   */
  private requestStepUpOtp = async (req: AuthRequest, res: Response): Promise<void> => {
    const { purpose } = req.body as z.infer<typeof stepUpOtpRequestSchema>;
    const result = await stepUpOtpService.request(req.user!.id, purpose);
    res.json({ message: 'Step-up OTP sent via SMS', ...result });
  };

  // ──────────────────────────────────────────────────────────────────
  // Remittance — mounted on the same router for atomicity of the
  // mobile gateway. Could live in a sibling controller if surface
  // grows, but currently three endpoints don't justify the split.
  // ──────────────────────────────────────────────────────────────────

  private quoteRemittance = async (req: AuthRequest, res: Response): Promise<void> => {
    const { amount, currency } = req.body as z.infer<typeof remittanceQuoteSchema>;
    const quote = await mobileRemittanceService.quote(
      req.user!.id,
      amount,
      currency.toUpperCase(),
    );
    res.json({
      ...quote,
      disclaimer: `Recipient amount is indicative; final settlement reflects FX at execution. FlexPay corporate FX margin: ${quote.fxMarginAppliedBps} bps (0.5%).`,
    });
  };

  private sendRemittance = async (req: AuthRequest, res: Response): Promise<void> => {
    const { quoteId, beneficiary } = req.body as z.infer<typeof remittanceSendSchema>;
    const result = await mobileRemittanceService.send(req.user!.id, quoteId, beneficiary);
    res.json(result);
  };
}

export const mobileWalletController = new MobileWalletController();

// Silence the lint for env import — kept for forward use when the
// fixed EWA fee becomes env-driven.
void env;
void Prisma;
