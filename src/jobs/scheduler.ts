import cron from 'node-cron';
import { logger } from '../config/logger';
import { enqueueDuePayrolls } from './payrollQueue';
import { savingsService } from '../modules/savings/savingsService';

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
        logger.error({ err }, 'payroll due-sweep failed');
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
        logger.info({ results }, 'monthly auto-save completed');
      } catch (err) {
        logger.error({ err }, 'monthly auto-save failed');
      }
    },
    { timezone: GST_TIMEZONE },
  );

  logger.info('scheduler started (timezone=%s)', GST_TIMEZONE);
}
