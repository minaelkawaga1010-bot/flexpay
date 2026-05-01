import Bull from 'bull';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { payrollService } from '../modules/companies/companyService';

export const PAYROLL_QUEUE_NAME = 'payroll';

let queue: Bull.Queue | null = null;

export function getPayrollQueue(): Bull.Queue {
  if (queue) return queue;
  queue = new Bull(PAYROLL_QUEUE_NAME, env.redisUrl, {
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    },
  });

  queue.process('process-due', async () => {
    const results = await payrollService.processDuePayrolls();
    logger.info({ results }, 'payroll processor completed');
    return { processed: results.length };
  });

  queue.on('failed', (job, err) => {
    logger.error({ err, jobId: job.id, attempts: job.attemptsMade }, 'payroll job failed');
  });

  return queue;
}

export async function enqueueDuePayrolls(): Promise<void> {
  const q = getPayrollQueue();
  await q.add('process-due', {}, { jobId: `due-${new Date().toISOString().slice(0, 10)}` });
}
