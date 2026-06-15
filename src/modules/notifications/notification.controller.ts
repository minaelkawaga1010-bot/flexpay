import { Prisma } from '@prisma/client';
import { Response, Router } from 'express';
import { z } from 'zod';
import { prisma } from '@config/prisma';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import logger from '@shared/utils/logger';

const registerSchema = z.object({ deviceToken: z.string().min(10) });

/**
 * V2 schema for `/register-token`. Carries the device platform and
 * (optionally) the app version so server-side payload shaping can
 * tune per-platform fields (iOS critical-alert flags, Android
 * channel id, action button shape).
 */
const registerTokenSchema = z.object({
  token: z.string().min(10, 'Token is too short').max(4096, 'Token is too long'),
  platform: z.enum(['ios', 'android', 'web']),
  appVersion: z.string().max(32).optional(),
});

export class NotificationsController {
  public readonly router = Router();

  constructor() {
    this.router.use(authenticate('employee'));
    this.router.post('/register', validate(registerSchema), asyncHandler(this.register));
    this.router.post(
      '/register-token',
      validate(registerTokenSchema),
      asyncHandler(this.registerToken),
    );
    this.router.post('/unregister', asyncHandler(this.unregister));
  }

  private register = async (req: AuthRequest, res: Response): Promise<void> => {
    await prisma.employee.update({
      where: { id: req.user!.id },
      data: { deviceToken: req.body.deviceToken, notificationsEnabled: true },
    });
    res.json({ message: 'Device registered' });
  };

  /**
   * V2 token-binding handler.
   *
   * Binds the platform-tagged token to the authenticated EmployeeId.
   * Idempotent: re-posting the same token is a no-op on the Employee
   * row but always writes an audit-log entry so we can trace
   * device-rotation history.
   *
   * Anti-hijack:
   *   • The token is bound to req.user!.id from the validated JWT —
   *     the body cannot carry an employeeId override. A stolen
   *     token combined with a stolen JWT is still scoped to the
   *     legitimate employee.
   */
  private registerToken = async (req: AuthRequest, res: Response): Promise<void> => {
    const { token, platform, appVersion } = req.body as z.infer<typeof registerTokenSchema>;

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.employee.update({
        where: { id: req.user!.id },
        data: { deviceToken: token, notificationsEnabled: true },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'employee',
          actorId: req.user!.id,
          action: 'PUSH_TOKEN_REGISTERED',
          resourceType: 'Employee',
          resourceId: req.user!.id,
          metadata: {
            platform,
            appVersion: appVersion ?? null,
            // Token PREVIEW only — never the full token in the audit
            // trail. The full value lives on Employee.deviceToken.
            tokenPreview: `${token.slice(0, 8)}…`,
          } as Prisma.InputJsonValue,
        },
      });
    });

    logger.info('push: token registered', {
      employeeId: req.user!.id,
      platform,
      tokenPreview: `${token.slice(0, 8)}…`,
    });

    res.json({ message: 'Device token registered', platform });
  };

  private unregister = async (req: AuthRequest, res: Response): Promise<void> => {
    await prisma.employee.update({
      where: { id: req.user!.id },
      data: { deviceToken: null, notificationsEnabled: false },
    });
    res.json({ message: 'Device unregistered' });
  };
}

export const notificationsController = new NotificationsController();
