import cron from 'node-cron';
import logger from '@shared/utils/logger';
import { savingsService } from './savings.service';
import { enqueueDuePayrolls } from '@modules/payroll/payroll.job';

const GST_TIMEZONE = 'Asia/Dubai';

export function startScheduler(): void {
  // Daily payroll sweep at 02:00 GST
  cron.schedule(
    '0 2 * * *',
    async () => {
      try {
        await enqueueDuePayrolls();
        logger.info('payroll due-sweep enqueued');
      } catch (err) {
        logger.error('payroll due-sweep failed', { error: (err as Error).message });
      }
    },
    { timezone: GST_TIMEZONE },
  );

  // Monthly auto-save on the 1st at 09:00 GST
  cron.schedule(
    '0 9 1 * *',
    async () => {
      try {
        const results = await savingsService.runMonthlyAutoSave();
        logger.info('monthly auto-save completed', { count: results.length });
      } catch (err) {
        logger.error('monthly auto-save failed', { error: (err as Error).message });
      }
    },
    { timezone: GST_TIMEZONE },
  );

  logger.info('scheduler started', { timezone: GST_TIMEZONE });
}
