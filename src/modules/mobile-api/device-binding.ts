import { Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '@config/prisma';
import { AuthRequest } from '@shared/middleware/auth';
import { BadRequest, Forbidden, Unauthorized } from '@shared/utils/errors';
import logger from '@shared/utils/logger';
import { deviceHeadersSchema } from './mobile-api.dto';

/**
 * Multi-device binding with trust-on-first-use registration.
 *
 * Contract:
 *   1. Mobile sends X-Device-Fingerprint, X-Device-Platform, X-App-Version
 *      on every authenticated request.
 *   2. If (employeeId, fingerprint) doesn't exist yet, register it. The
 *      registration is audit-logged.
 *   3. If it exists but is revoked, reject with 403.
 *   4. If it exists, update lastSeenAt + appVersion.
 *
 * Future hardening (Phase 2, STRATEGY.md §15.4):
 *   - Replace TOFU with attestation-backed registration (Apple App Attest
 *     / Google Play Integrity).
 *   - Add a per-device asymmetric keypair stored in the secure enclave,
 *     and require a signed challenge on every transactional request.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      device?: {
        id: string;
        fingerprint: string;
        platform: 'ios' | 'android';
        appVersion: string;
        firstSeen: boolean;
      };
    }
  }
}

export async function deviceBinding(
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(Unauthorized());
      return;
    }

    const parsed = deviceHeadersSchema.safeParse({
      'x-device-fingerprint': req.header('x-device-fingerprint'),
      'x-device-platform': req.header('x-device-platform'),
      'x-app-version': req.header('x-app-version'),
    });
    if (!parsed.success) {
      next(BadRequest('Missing or invalid device headers', parsed.error.flatten()));
      return;
    }

    const fingerprint = parsed.data['x-device-fingerprint'];
    const platform = parsed.data['x-device-platform'];
    const appVersion = parsed.data['x-app-version'];

    const existing = await prisma.device.findUnique({
      where: { employeeId_fingerprint: { employeeId: req.user.id, fingerprint } },
    });

    if (existing?.revoked) {
      next(Forbidden('Device has been revoked'));
      return;
    }

    let device = existing;
    let firstSeen = false;

    if (!device) {
      firstSeen = true;
      device = await prisma.device.create({
        data: {
          employeeId: req.user.id,
          fingerprint,
          platform,
          appVersion,
        },
      });
      await prisma.auditLog.create({
        data: {
          actorType: 'employee',
          actorId: req.user.id,
          action: 'DEVICE_REGISTERED',
          resourceType: 'Device',
          resourceId: device.id,
          ipAddress: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
          metadata: { platform, appVersion } as Prisma.InputJsonValue,
        },
      });
      logger.info('mobile device registered (TOFU)', {
        employeeId: req.user.id,
        deviceId: device.id,
        platform,
      });
    } else {
      // Touch last-seen + drift app version. Don't audit-log on every
      // request — only on registration and revocation.
      await prisma.device.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date(), appVersion },
      });
    }

    req.device = {
      id: device.id,
      fingerprint,
      platform,
      appVersion,
      firstSeen,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Programmatic device revocation. Called from ops dashboard or by the
 * user via the "log out other devices" flow.
 */
export async function revokeDevice(
  deviceId: string,
  reason: string,
  actorId: string,
): Promise<void> {
  const device = await prisma.device.update({
    where: { id: deviceId },
    data: {
      revoked: true,
      revokedAt: new Date(),
      revokedReason: reason,
    },
  });
  await prisma.auditLog.create({
    data: {
      actorType: 'employee',
      actorId,
      action: 'DEVICE_REVOKED',
      resourceType: 'Device',
      resourceId: device.id,
      metadata: { reason } as Prisma.InputJsonValue,
    },
  });
}
