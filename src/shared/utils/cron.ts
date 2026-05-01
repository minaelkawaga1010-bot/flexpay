import cronLib, { ScheduledTask } from 'node-cron';
import logger from './logger';

const GST_TIMEZONE = 'Asia/Dubai';

interface CronJob {
  name: string;
  expression: string;
  handler: () => Promise<unknown>;
  timezone?: string;
}

class CronManager {
  private readonly jobs: CronJob[] = [];
  private readonly tasks: ScheduledTask[] = [];

  register(job: CronJob): void {
    this.jobs.push(job);
  }

  start(): void {
    for (const job of this.jobs) {
      const task = cronLib.schedule(
        job.expression,
        async () => {
          try {
            await job.handler();
            logger.info('cron job executed', { job: job.name });
          } catch (err) {
            logger.error('cron job failed', { job: job.name, error: (err as Error).message });
          }
        },
        { timezone: job.timezone ?? GST_TIMEZONE },
      );
      this.tasks.push(task);
    }
    logger.info('cron manager started', { jobs: this.jobs.length, timezone: GST_TIMEZONE });
  }

  stop(): void {
    for (const task of this.tasks) task.stop();
    this.tasks.length = 0;
    logger.info('cron manager stopped');
  }
}

export const cron = new CronManager();
