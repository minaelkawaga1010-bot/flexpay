import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
    client.on('error', (err) => logger.error({ err }, 'redis error'));
  }
  return client;
}
