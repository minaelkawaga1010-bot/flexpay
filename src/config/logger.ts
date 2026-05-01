import pino from 'pino';
import { env } from './env';

export const logger = pino({
  level: env.nodeEnv === 'test' ? 'silent' : 'info',
  base: { service: 'flexpay-api' },
});
