import { NextFunction, Response } from 'express';
import { AuthRequest } from '@shared/middleware/auth';
import { Forbidden } from '@shared/utils/errors';
import logger from '@shared/utils/logger';
import { biometricHeadersSchema } from './mobile-api.dto';

/**
 * The window within which a biometric assertion is considered fresh.
 * Anything older than this forces a re-auth on-device.
 *
 * Rationale: a user who completed FaceID 90 seconds ago and then walked
 * away from their phone should not be able to authorise a high-value
 * action with the same gesture. 60s is short enough that the device is
 * almost certainly still with the user; long enough to cover OTP entry
 * + confirmation taps.
 */
const FRESHNESS_WINDOW_MS = 60 * 1000;

/**
 * Skew tolerance for the mobile clock. Devices with NTP-drifted clocks
 * would otherwise fail the freshness check spuriously.
 */
const CLOCK_SKEW_MS = 30 * 1000;

/**
 * Middleware factory: rejects the request unless the mobile included a
 * fresh biometric assertion header tuple.
 *
 * The biometric type itself doesn't carry security weight here — it's
 * for analytics + downstream policy (e.g., "FaceID-only on advances
 * > 1000 AED"). The freshness window is what makes the assertion
 * non-replayable across screen-locks.
 */
export function requireBiometrics(
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): void {
  const parsed = biometricHeadersSchema.safeParse({
    'x-biometric-type': req.header('x-biometric-type'),
    'x-biometric-verified-at': req.header('x-biometric-verified-at'),
  });
  if (!parsed.success) {
    next(Forbidden('Biometric assertion missing'));
    return;
  }
  const verifiedAt = parsed.data['x-biometric-verified-at'];
  const now = Date.now();
  const age = now - verifiedAt;

  if (age < -CLOCK_SKEW_MS) {
    next(Forbidden('Biometric assertion future-dated beyond clock skew'));
    return;
  }
  if (age > FRESHNESS_WINDOW_MS + CLOCK_SKEW_MS) {
    next(Forbidden('Biometric assertion stale — re-authenticate on device'));
    return;
  }

  logger.debug('biometric assertion accepted', {
    type: parsed.data['x-biometric-type'],
    ageMs: age,
    employeeId: req.user?.id,
  });
  next();
}
