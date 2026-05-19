import { app } from './app';
import { env } from '@config/env';
import { prisma, disconnectPrisma } from '@config/prisma';
import { closeAllQueues } from '@config/bull';
import redisService from '@config/redis';
import { cron } from '@shared/utils/cron';
import logger from '@shared/utils/logger';
import { startPayrollWorker } from '@modules/payroll/payroll.job';
import { startNotificationWorker } from '@modules/notifications/notification.job';
import { registerCronJobs } from '@modules/savings/savings.job';

async function startServer(): Promise<void> {
  try {
    await prisma.$connect();
    await redisService.connect();

    // Background workers + scheduled jobs
    startPayrollWorker();
    startNotificationWorker();
    registerCronJobs();
    cron.start();

    const server = app.listen(env.PORT, () => {
      logger.info(`FlexPay API listening`, { port: env.PORT, env: env.NODE_ENV });
    });

    const shutdown = async (signal: string) => {
      logger.info('Received signal, shutting down gracefully', { signal });

      // Stop accepting new requests
      server.close(async () => {
        logger.info('HTTP server closed');
        cron.stop();
        try {
          await closeAllQueues();
        } catch (err) {
          logger.error('queue shutdown failed', { error: (err as Error).message });
        }
        try {
          await redisService.disconnect();
        } catch (err) {
          logger.error('redis shutdown failed', { error: (err as Error).message });
        }
        try {
          await disconnectPrisma();
        } catch (err) {
          logger.error('prisma shutdown failed', { error: (err as Error).message });
        }
        logger.info('Graceful shutdown complete');
        process.exit(0);
      });

      // Hard timeout
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30_000).unref();
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (err) {
    logger.error('Failed to start server', { error: (err as Error).message });
    process.exit(1);
  }
}

process.on('unhandledRejection', (err) => logger.error('unhandledRejection', { err }));
process.on('uncaughtException', (err) => logger.error('uncaughtException', { err }));

if (require.main === module) {
  void startServer();
}
