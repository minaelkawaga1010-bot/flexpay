import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { startScheduler } from './jobs/scheduler';

const app = createApp();

app.listen(env.port, () => {
  logger.info(`flexpay-api listening on :${env.port} (env=${env.nodeEnv})`);
  if (env.nodeEnv !== 'test') {
    try {
      startScheduler();
    } catch (err) {
      logger.error({ err }, 'failed to start scheduler');
    }
  }
});

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
process.on('uncaughtException', (err) => logger.error({ err }, 'uncaughtException'));
