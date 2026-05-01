import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload, Role } from '../utils/jwt';
import { Forbidden, Unauthorized } from '../utils/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: JwtPayload;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return next(Unauthorized('Missing bearer token'));
  }
  try {
    const payload = verifyToken(token);
    req.auth = payload;
    next();
  } catch {
    next(Unauthorized('Invalid or expired token'));
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(Unauthorized());
    if (!roles.includes(req.auth.role)) return next(Forbidden('Insufficient role'));
    next();
  };
}
