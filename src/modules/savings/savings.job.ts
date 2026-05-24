import { cron } from '@shared/utils/cron';
import logger from '@shared/utils/logger';
import { savingsService } from './savings.service';
import { enqueueDuePayrolls } from '@modules/payroll/payroll.job';
import { creditScoringService } from '@modules/scoring/scoring.service';
import { registerReconciliationCrons } from '@modules/payroll-routing/reconciliation.worker';
import { registerFraudMonitorCron } from '@modules/ops-intel/fraud-monitor.service';
import { metricsService } from '@modules/ops-intel/metrics.service';

/**
 * Register every recurring task in one place. Called once during boot.
 */
export function registerCronJobs(): void {
  cron.register({
    name: 'payroll-due-sweep',
    expression: '0 2 * * *', // 02:00 GST daily
    handler: enqueueDuePayrolls,
  });

  cron.register({
    name: 'savings-monthly-auto-save',
    expression: '0 9 1 * *', // 1st of month, 09:00 GST
    handler: async () => {
      const results = await savingsService.runMonthlyAutoSave();
      logger.info('monthly auto-save completed', { count: results.length });
    },
  });

  cron.register({
    name: 'credit-score-batch-refresh',
    expression: '0 4 * * *', // 04:00 GST daily
    handler: async () => {
      const result = await creditScoringService.batchUpdateScores();
      logger.info('credit-score batch refresh completed', result);
    },
  });

  // WPS routing reconciliation (twice daily, 14:00 + 22:00 UAE)
  // See docs/STRATEGY.md Appendix C.1.
  registerReconciliationCrons();

  // Ops-intel: 15-minute velocity + attendance-drop scan.
  registerFraudMonitorCron();

  // DCSE cohort canary sweep (STRATEGY §C.3). Hourly: recompute the
  // rolling-30d per-cohort uncollectible rate and trip the failsafe
  // circuit breaker for any cohort ≥ 1.5%. Clearing is a deliberate
  // two-person action, never automatic.
  cron.register({
    name: 'dcse-canary-sweep',
    expression: '15 * * * *', // hourly at :15
    handler: async () => {
      const r = await metricsService.runCanarySweep();
      logger.info('dcse canary sweep complete', r);
    },
  });
}
