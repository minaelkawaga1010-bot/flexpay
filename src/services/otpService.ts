import { getRedis } from '../config/redis';
import { logger } from '../config/logger';

const OTP_TTL_SECONDS = 5 * 60;

const memory = new Map<string, { code: string; expiresAt: number }>();

function key(phone: string): string {
  return `otp:${phone}`;
}

function useRedis(): boolean {
  return process.env.NODE_ENV !== 'test';
}

export const otpService = {
  generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  },

  async storeOtp(phone: string, code: string): Promise<void> {
    if (useRedis()) {
      try {
        const redis = getRedis();
        await redis.set(key(phone), code, 'EX', OTP_TTL_SECONDS);
        return;
      } catch (err) {
        logger.warn({ err }, 'redis unavailable, falling back to in-memory OTP store');
      }
    }
    memory.set(key(phone), { code, expiresAt: Date.now() + OTP_TTL_SECONDS * 1000 });
  },

  async verifyOtp(phone: string, code: string): Promise<boolean> {
    if (useRedis()) {
      try {
        const redis = getRedis();
        const stored = await redis.get(key(phone));
        if (stored && stored === code) {
          await redis.del(key(phone));
          return true;
        }
        return false;
      } catch (err) {
        logger.warn({ err }, 'redis unavailable, falling back to in-memory OTP store');
      }
    }
    const entry = memory.get(key(phone));
    if (!entry) return false;
    if (entry.expiresAt < Date.now()) {
      memory.delete(key(phone));
      return false;
    }
    if (entry.code !== code) return false;
    memory.delete(key(phone));
    return true;
  },
};
