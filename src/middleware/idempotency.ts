import { Request, Response, NextFunction } from 'express';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';

const TTL_SECONDS = 24 * 60 * 60;

interface CachedResponse {
  status: number;
  body: unknown;
}

const memory = new Map<string, { value: CachedResponse; expiresAt: number }>();

async function read(key: string): Promise<CachedResponse | null> {
  if (process.env.NODE_ENV !== 'test') {
    try {
      const raw = await getRedis().get(key);
      if (raw) return JSON.parse(raw) as CachedResponse;
    } catch (err) {
      logger.warn({ err }, 'idempotency: redis read failed');
    }
  }
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

async function write(key: string, response: CachedResponse): Promise<void> {
  if (process.env.NODE_ENV !== 'test') {
    try {
      await getRedis().set(key, JSON.stringify(response), 'EX', TTL_SECONDS);
      return;
    } catch (err) {
      logger.warn({ err }, 'idempotency: redis write failed');
    }
  }
  memory.set(key, { value: response, expiresAt: Date.now() + TTL_SECONDS * 1000 });
}

/**
 * Re-plays a previously seen response when the client supplies the same
 * Idempotency-Key. Scoped to the authenticated subject so two users can't
 * collide. Optional: handlers without an Idempotency-Key are passed through.
 */
export async function idempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.header('idempotency-key');
  if (!key) return next();
  const subject = req.auth?.sub ?? 'anon';
  const fullKey = `idem:${subject}:${req.method}:${req.path}:${key}`;

  const cached = await read(fullKey);
  if (cached) {
    res.status(cached.status).json(cached.body);
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    void write(fullKey, { status: res.statusCode, body });
    return originalJson(body);
  };
  next();
}
