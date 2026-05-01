import { createApp } from './app';
import { env, isTest } from '@config/env';
import logger from '@shared/utils/logger';
import redisService from '@config/redis';
import { startScheduler } from '@modules/savings/savings.job';

async function bootstrap() {
  await redisService.connect();
  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info(`flexpay-api listening`, { port: env.PORT, env: env.NODE_ENV });
    if (!isTest) {
      try {
        startScheduler();
      } catch (err) {
        logger.error('failed to start scheduler', { error: (err as Error).message });
      }
    }
  });
}

bootstrap().catch((err) => {
  logger.error('bootstrap failed', { error: (err as Error).message });
  process.exit(1);
});

process.on('unhandledRejection', (err) => logger.error('unhandledRejection', { err }));
process.on('uncaughtException', (err) => logger.error('uncaughtException', { err }));
