import { Queue } from 'bull';
import { createQueue } from '@config/bull';
import logger from '@shared/utils/logger';

export const PAYROLL_QUEUE_NAME = 'payroll';

interface PayrollJob {
  payrollId?: string;
  kind: 'process-one' | 'process-due';
}

let queue: Queue<PayrollJob> | null = null;
let initialised = false;

function ensureQueue(): Queue<PayrollJob> {
  if (queue && initialised) return queue;
  queue = createQueue<PayrollJob>(PAYROLL_QUEUE_NAME);
  initialised = true;

  queue.process(async (job) => {
    // Lazy import avoids a circular dep with payroll.service.
    const { payrollService } = await import('./payroll.service');
    if (job.data.kind === 'process-due') {
      const results = await payrollService.processDuePayrolls();
      logger.info('payroll due-sweep completed', { count: results.length });
      return { processed: results.length };
    }
    if (!job.data.payrollId) throw new Error('missing payrollId');
    const result = await payrollService.processPayroll(job.data.payrollId);
    logger.info('payroll processed', { payrollId: job.data.payrollId, result });
    return result;
  });

  queue.on('failed', (job, err) => {
    logger.error('payroll job failed', {
      jobId: job.id,
      attempts: job.attemptsMade,
      error: err.message,
    });
  });

  return queue;
}

export function getPayrollQueue(): Queue<PayrollJob> {
  return ensureQueue();
}

/** Schedule a single payroll for processing at a specific delay. */
export async function enqueuePayrollJob(payrollId: string, delayMs: number): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  await ensureQueue().add(
    { kind: 'process-one', payrollId },
    {
      jobId: `payroll:${payrollId}`,
      delay: delayMs,
    },
  );
}

/** Cron-driven sweep of any PENDING payrolls that slipped through. */
export async function enqueueDuePayrolls(): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  await ensureQueue().add(
    { kind: 'process-due' },
    { jobId: `due-${new Date().toISOString().slice(0, 10)}` },
  );
}
