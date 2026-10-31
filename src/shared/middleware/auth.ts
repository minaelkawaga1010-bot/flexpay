import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JWTPayload } from '@shared/utils/jwt';
import { adminSubjectIds } from '@config/env';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';

export interface AuthRequest extends Request {
  user?: JWTPayload & { id: string };
}

type Role = 'employee' | 'company' | 'admin';

export const authenticate = (requiredRole?: Role) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'MISSING_AUTH_HEADER' });
        return;
      }

      const token = authHeader.substring(7);
      const payload = verifyAccessToken(token);

      if (requiredRole && payload.role !== requiredRole) {
        res.status(403).json({ error: 'INSUFFICIENT_PERMISSIONS' });
        return;
      }

      // Verify the underlying account is still active.
      if (payload.role === 'employee') {
        const employee = await prisma.employee.findFirst({
          where: { id: payload.userId, status: 'ACTIVE' },
        });
        if (!employee) {
          res.status(401).json({ error: 'ACCOUNT_NOT_FOUND_OR_INACTIVE' });
          return;
        }
      } else if (payload.role === 'company') {
        const company = await prisma.company.findFirst({
          where: { id: payload.userId, status: 'ACTIVE' },
        });
        if (!company) {
          res.status(401).json({ error: 'COMPANY_NOT_FOUND' });
          return;
        }
      } else if (payload.role === 'admin') {
        // There is no admin account store: a validly signed admin-role
        // token is honoured only for an explicitly allowlisted subject.
        if (!adminSubjectIds.has(payload.userId)) {
          logger.warn('Admin-role token refused: subject not allowlisted', { path: req.path });
          res.status(403).json({ error: 'INSUFFICIENT_PERMISSIONS' });
          return;
        }
      }

      req.user = { ...payload, id: payload.userId };
      next();
    } catch (error) {
      const msg = (error as Error).message;
      logger.warn('Authentication failed', { error: msg, path: req.path });
      if (msg === 'ACCESS_TOKEN_EXPIRED') {
        res.status(401).json({ error: 'ACCESS_TOKEN_EXPIRED', hint: 'Use refresh token' });
        return;
      }
      if (msg === 'INVALID_ACCESS_TOKEN') {
        res.status(401).json({ error: 'INVALID_TOKEN' });
        return;
      }
      res.status(500).json({ error: 'AUTH_ERROR' });
    }
  };
};

export const optionalAuth = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyAccessToken(token);
      // Same admin rule as authenticate(): never attach an admin identity
      // for a subject that is not allowlisted.
      if (payload.role !== 'admin' || adminSubjectIds.has(payload.userId)) {
        req.user = { ...payload, id: payload.userId };
      }
    }
  } catch {
    // Allow unauthenticated requests through.
  }
  next();
};
