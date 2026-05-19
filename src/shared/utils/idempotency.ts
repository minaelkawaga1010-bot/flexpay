import { Request, Response, NextFunction } from 'express';
import redisService from '@config/redis';
import logger from './logger';

const TTL_SECONDS = 24 * 60 * 60;

interface CachedResponse {
  status: number;
  body: unknown;
}

/**
 * Replays the previously seen response when the client supplies the same
 * `Idempotency-Key`. Scoped to the authenticated subject so two users can't
 * collide. Handlers without a key are passed through untouched.
 */
export async function idempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.header('idempotency-key');
  if (!key) return next();

  const subject = (req as { user?: { id?: string } }).user?.id ?? 'anon';
  const fullKey = `idem:${subject}:${req.method}:${req.path}:${key}`;

  try {
    const cached = await redisService.get(fullKey);
    if (cached) {
      const parsed = JSON.parse(cached) as CachedResponse;
      res.status(parsed.status).json(parsed.body);
      return;
    }
  } catch (err) {
    logger.warn('idempotency: read failed', { error: (err as Error).message });
  }

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    redisService
      .set(fullKey, JSON.stringify({ status: res.statusCode, body }), TTL_SECONDS)
      .catch((err) => logger.warn('idempotency: write failed', { error: (err as Error).message }));
    return originalJson(body);
  };
  next();
}
