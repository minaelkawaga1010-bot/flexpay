import { createLogger, format, transports } from 'winston';
import { env, isProd, isTest } from '@config/env';

const logger = createLogger({
  level: isTest ? 'silent' : isProd ? 'info' : 'debug',
  defaultMeta: { service: 'flexpay-api', env: env.NODE_ENV },
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    isProd ? format.json() : format.colorize(),
    isProd ? format.json() : format.simple(),
  ),
  transports: [
    new transports.Console({ silent: isTest }),
  ],
});

export default logger;
