import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '@config/env';
import redisService from '@config/redis';
import logger from '@shared/utils/logger';

export const authRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: 5,
  message: { error: 'TOO_MANY_ATTEMPTS', retryAfter: Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000 / 60) },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.body?.phone) return `auth:otp:${req.body.phone}`;
    return `auth:ip:${req.ip ?? 'unknown'}`;
  },
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', { ip: req.ip, path: req.path });
    res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', retryAfter: 15 });
  },
});

export const otpRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => `otp:${req.body?.phone ?? req.ip ?? 'unknown'}`,
  message: { error: 'OTP_LIMIT_EXCEEDED', retryAfter: 3600 },
});

export const transferRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => `transfer:${(req as { user?: { id?: string } }).user?.id ?? req.ip ?? 'unknown'}`,
  message: { error: 'TRANSFER_LIMIT_EXCEEDED' },
});

/**
 * Per-user (or per-IP) sliding window backed by Redis. Used by general
 * authenticated endpoints — intentionally distinct from the express-rate-limit
 * instance above so we can scope the limit on `userId` from JWT.
 */
export const apiRateLimiter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as { user?: { id?: string } }).user?.id;
    const key = userId ? `api:user:${userId}` : `api:ip:${req.ip ?? 'unknown'}`;
    const count = await redisService.incrementRateLimit(key);
    if (count > env.RATE_LIMIT_MAX_REQUESTS) {
      const ttl = await redisService.getRateLimitTtl(key);
      res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', retryAfter: Math.max(1, ttl) });
      return;
    }
    next();
  } catch (err) {
    logger.error('Rate limiter error', { error: (err as Error).message });
    next();
  }
};
