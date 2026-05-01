import { payrollQueue } from '@config/bull';
import logger from '@shared/utils/logger';

interface PayrollJob {
  payrollId?: string;
  kind: 'process-one' | 'process-due';
}

let workerInstalled = false;

function installWorker(): void {
  if (workerInstalled) return;
  workerInstalled = true;

  payrollQueue.process(async (job) => {
    const data = job.data as PayrollJob;
    // Lazy import to avoid a circular dep with payroll.service.
    const { payrollService } = await import('./payroll.service');
    if (data.kind === 'process-due') {
      const results = await payrollService.processDuePayrolls();
      logger.info('payroll due-sweep completed', { count: results.length });
      return { processed: results.length };
    }
    if (!data.payrollId) throw new Error('missing payrollId');
    const result = await payrollService.processPayroll(data.payrollId);
    logger.info('payroll processed', { payrollId: data.payrollId, result });
    return result;
  });

  payrollQueue.on('failed', (job, err) => {
    logger.error('payroll job failed', {
      jobId: job.id,
      attempts: job.attemptsMade,
      error: err.message,
    });
  });
}

/** Schedule a single payroll for processing at a specific delay. */
export async function enqueuePayrollJob(payrollId: string, delayMs: number): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  installWorker();
  await payrollQueue.add(
    { kind: 'process-one', payrollId } satisfies PayrollJob,
    {
      jobId: `payroll:${payrollId}`,
      delay: delayMs,
    },
  );
}

/** Cron-driven sweep of any PENDING payrolls that slipped through. */
export async function enqueueDuePayrolls(): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  installWorker();
  await payrollQueue.add(
    { kind: 'process-due' } satisfies PayrollJob,
    { jobId: `due-${new Date().toISOString().slice(0, 10)}` },
  );
}

export function startPayrollWorker(): void {
  installWorker();
}
