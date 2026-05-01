import { Request, Response, NextFunction } from 'express';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';

interface BucketEntry {
  count: number;
  expiresAt: number;
}

const memory = new Map<string, BucketEntry>();

async function increment(key: string, windowSeconds: number): Promise<number> {
  if (process.env.NODE_ENV !== 'test') {
    try {
      const redis = getRedis();
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSeconds);
      return count;
    } catch (err) {
      logger.warn({ err }, 'rate-limit: redis unavailable, falling back to in-memory');
    }
  }
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.expiresAt < now) {
    memory.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

interface Options {
  windowSeconds: number;
  max: number;
  keyFn?: (req: Request) => string;
}

export function rateLimit(prefix: string, opts: Options) {
  const { windowSeconds, max } = opts;
  const keyFn = opts.keyFn ?? ((req: Request) => req.ip ?? 'unknown');
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = `rl:${prefix}:${keyFn(req)}`;
    try {
      const count = await increment(key, windowSeconds);
      if (count > max) {
        res.status(429).json({
          error: { code: 'RATE_LIMITED', message: 'Too many requests' },
        });
        return;
      }
      next();
    } catch (err) {
      logger.error({ err }, 'rate-limit: increment failed');
      next();
    }
  };
}

export const otpRateLimiter = rateLimit('otp', {
  windowSeconds: 60 * 60,
  max: 5,
  keyFn: (req) => (req.body?.phone as string) ?? req.ip ?? 'unknown',
});

export const ipAuthRateLimiter = rateLimit('auth-ip', {
  windowSeconds: 60,
  max: 30,
});
