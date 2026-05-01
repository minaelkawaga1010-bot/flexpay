import { createClient, RedisClientType } from 'redis';
import { env, isTest } from './env';
import logger from '@shared/utils/logger';

class RedisService {
  public client: RedisClientType;
  private connected = false;
  private memory = new Map<string, { value: string; expiresAt: number }>();

  constructor() {
    this.client = createClient({ url: env.REDIS_URL }) as RedisClientType;
    this.client.on('error', (err) => logger.error('Redis error', { error: (err as Error).message }));
    this.client.on('connect', () => {
      this.connected = true;
      logger.info('Redis connected');
    });
  }

  async connect(): Promise<void> {
    if (this.connected || isTest) return;
    try {
      await this.client.connect();
    } catch (err) {
      logger.warn('Redis connect failed; falling back to in-memory store', {
        error: (err as Error).message,
      });
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.client.quit();
    this.connected = false;
  }

  // ---------------------------------------------------------------- OTP store

  async storeOTP(phone: string, otp: string): Promise<void> {
    await this.set(`otp:${phone}`, otp, env.REDIS_OTP_TTL);
  }

  async verifyOTP(phone: string, otp: string): Promise<boolean> {
    const key = `otp:${phone}`;
    const stored = await this.get(key);
    if (!stored || stored !== otp) return false;
    await this.del(key);
    return true;
  }

  async deleteOTP(phone: string): Promise<void> {
    await this.del(`otp:${phone}`);
  }

  // -------------------------------------------------------------- Rate limit

  async incrementRateLimit(key: string, ttlSeconds = env.REDIS_RATE_LIMIT_TTL): Promise<number> {
    const redisKey = `rate:${key}`;
    if (this.connected) {
      const count = await this.client.incr(redisKey);
      if (count === 1) await this.client.expire(redisKey, ttlSeconds);
      return count;
    }
    const entry = this.memory.get(redisKey);
    const now = Date.now();
    if (!entry || entry.expiresAt < now) {
      this.memory.set(redisKey, { value: '1', expiresAt: now + ttlSeconds * 1000 });
      return 1;
    }
    const count = parseInt(entry.value, 10) + 1;
    entry.value = String(count);
    return count;
  }

  async getRateLimitTtl(key: string): Promise<number> {
    if (this.connected) return await this.client.ttl(`rate:${key}`);
    const entry = this.memory.get(`rate:${key}`);
    if (!entry) return 0;
    return Math.max(0, Math.floor((entry.expiresAt - Date.now()) / 1000));
  }

  // ----------------------------------------------------------------- Generic

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.connected) {
      if (ttlSeconds) await this.client.setEx(key, ttlSeconds, value);
      else await this.client.set(key, value);
      return;
    }
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : Number.MAX_SAFE_INTEGER;
    this.memory.set(key, { value, expiresAt });
  }

  async get(key: string): Promise<string | null> {
    if (this.connected) return await this.client.get(key);
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return entry.value;
  }

  async del(key: string): Promise<void> {
    if (this.connected) await this.client.del(key);
    this.memory.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }
}

export const redisService = new RedisService();
export default redisService;
