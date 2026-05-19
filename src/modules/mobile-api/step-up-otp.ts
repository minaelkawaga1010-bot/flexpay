import { NextFunction, Response } from 'express';
import redisService from '@config/redis';
import { prisma } from '@config/prisma';
import { generateOTP } from '@shared/utils/otp';
import { AuthRequest } from '@shared/middleware/auth';
import { Forbidden, NotFound } from '@shared/utils/errors';
import logger from '@shared/utils/logger';
import { twilioService } from '@modules/auth/twilio.service';
import type { StepUpPurpose } from './mobile-api.dto';

/**
 * Step-up OTP service.
 *
 * Triggered for any transactional execution beyond the trust ceiling of
 * device-binding + biometric assertion alone. Single-use, 5-min TTL,
 * out-of-band SMS delivery via Twilio (Infobip swappable — see
 * `auth/twilio.service.ts`).
 *
 * The purpose dimension partitions the OTP namespace: an `ADVANCE` OTP
 * cannot satisfy a `REMITTANCE` requirement. This prevents an attacker
 * who has phished a step-up code in one flow from using it in another.
 */

const TTL_SECONDS = 5 * 60;

function key(employeeId: string, purpose: StepUpPurpose): string {
  return `step-up:${employeeId}:${purpose}`;
}

export const stepUpOtpService = {
  /**
   * Issue a fresh OTP for the given purpose and SMS it to the
   * employee's registered phone. Overwrites any prior unconsumed OTP
   * for the same (employee, purpose) — a user who taps "resend" should
   * receive a new code, not stack them.
   */
  async request(employeeId: string, purpose: StepUpPurpose): Promise<{ expiresIn: number }> {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { phone: true, status: true },
    });
    if (!employee) throw NotFound('Employee not found');
    if (employee.status !== 'ACTIVE') {
      throw Forbidden('Account is not active');
    }

    const code = generateOTP();
    await redisService.set(key(employeeId, purpose), code, TTL_SECONDS);

    const labels: Record<StepUpPurpose, string> = {
      ADVANCE: 'salary advance',
      REMITTANCE: 'remittance',
      CARD_TOKENIZE: 'wallet pay setup',
      P2P_HIGH_VALUE: 'transfer',
    };

    await twilioService.sendSms(
      employee.phone,
      `FlexPay ${labels[purpose]} verification code: ${code}. Expires in 5 minutes. Never share this code.`,
    );

    logger.info('step-up OTP issued', { employeeId, purpose });
    return { expiresIn: TTL_SECONDS };
  },

  /**
   * Verify and consume the OTP. Returns true exactly once for a given
   * code; subsequent calls (replay or brute force) return false.
   */
  async verify(employeeId: string, purpose: StepUpPurpose, code: string): Promise<boolean> {
    const stored = await redisService.get(key(employeeId, purpose));
    if (!stored || stored !== code) return false;
    await redisService.del(key(employeeId, purpose));
    return true;
  },
};

/**
 * Middleware factory: requires X-Step-Up-OTP header matching a
 * previously issued OTP for the given purpose.
 *
 * Usage on the route definition:
 *   this.router.post('/advance/request',
 *     requireStepUpOtp('ADVANCE'),
 *     validate(advanceRequestSchema),
 *     asyncHandler(this.requestAdvance),
 *   );
 */
export function requireStepUpOtp(purpose: StepUpPurpose) {
  return async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) return next(Forbidden('Authenticated session required'));
    const code = req.header('x-step-up-otp');
    if (!code || !/^\d{6}$/.test(code)) {
      return next(Forbidden('Step-up OTP required for this action'));
    }
    const ok = await stepUpOtpService.verify(req.user.id, purpose, code);
    if (!ok) {
      logger.warn('step-up OTP rejected', { employeeId: req.user.id, purpose });
      return next(Forbidden('Invalid or expired step-up OTP'));
    }
    next();
  };
}
