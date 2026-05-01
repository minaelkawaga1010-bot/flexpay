import { createQueue } from '@config/bull';
import logger from '@shared/utils/logger';
import { payrollService } from './payroll.service';

export const PAYROLL_QUEUE_NAME = 'payroll';

let initialised = false;

export function getPayrollQueue() {
  const queue = createQueue(PAYROLL_QUEUE_NAME);
  if (initialised) return queue;
  initialised = true;

  queue.process('process-due', async () => {
    const results = await payrollService.processDuePayrolls();
    logger.info('payroll processor completed', { count: results.length });
    return { processed: results.length };
  });

  queue.on('failed', (job, err) => {
    logger.error('payroll job failed', { jobId: job.id, attempts: job.attemptsMade, error: err.message });
  });

  return queue;
}

export async function enqueueDuePayrolls(): Promise<void> {
  const queue = getPayrollQueue();
  await queue.add('process-due', {}, { jobId: `due-${new Date().toISOString().slice(0, 10)}` });
}
