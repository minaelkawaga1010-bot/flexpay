/**
 * Payroll Scheduler — Cron-style scheduler for automated payroll runs
 *
 * Runs on a 1-minute interval, checks the ScheduledPayroll table for active
 * schedules whose nextRunAt has passed, and enqueues payroll processing jobs.
 * Target run time: 2:00 AM GST (UTC+4).
 */

import { db } from '@/lib/db';
import { payrollQueue } from '@/jobs/payroll-job';
import { generateBatchId, processCompanyPayroll, calculateNextRunDate } from '@/jobs/payroll-processor';
import type { PayrollJobData } from '@/jobs/payroll-job';

// ==================== Types ====================

interface SchedulerStatus {
  isRunning: boolean;
  lastTick: Date | null;
  lastTickError: string | null;
  schedulesProcessed: number;
}

// ==================== PayrollScheduler ====================

class PayrollScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private _isRunning = false;
  private lastTick: Date | null = null;
  private lastTickError: string | null = null;
  private schedulesProcessed = 0;
  private readonly TICK_INTERVAL_MS = 60_000; // 1 minute

  /**
   * Start the scheduler — begins ticking every minute
   */
  start(): void {
    if (this.intervalId) {
      console.warn('[PayrollScheduler] Already running');
      return;
    }

    this._isRunning = true;
    console.log('[PayrollScheduler] Started — checking every 60 seconds');

    // Run immediately on start
    this.tick().catch((err) => {
      console.error('[PayrollScheduler] Initial tick error:', err);
    });

    // Set up recurring tick
    this.intervalId = setInterval(() => {
      this.tick().catch((err) => {
        console.error('[PayrollScheduler] Tick error:', err);
      });
    }, this.TICK_INTERVAL_MS);
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this._isRunning = false;
    console.log('[PayrollScheduler] Stopped');
  }

  /**
   * Single tick — check for schedules that need to run
   */
  private async tick(): Promise<void> {
    // Prevent overlapping ticks
    if (this.schedulesProcessed > 0) {
      // Already processed in this startup; skip re-processing same schedules
    }

    try {
      const now = new Date();

      // Find all active scheduled payrolls whose nextRunAt has passed
      const dueSchedules = await db.scheduledPayroll.findMany({
        where: {
          isActive: true,
          nextRunAt: { lte: now },
        },
        orderBy: { nextRunAt: 'asc' },
      });

      if (dueSchedules.length === 0) {
        this.lastTick = new Date();
        this.lastTickError = null;
        return;
      }

      console.log(`[PayrollScheduler] Found ${dueSchedules.length} schedule(s) due`);

      for (const schedule of dueSchedules) {
        try {
          await this.queuePayroll(schedule);
          this.schedulesProcessed++;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(
            `[PayrollScheduler] Failed to queue schedule ${schedule.id} (${schedule.name}): ${errorMsg}`
          );
          this.lastTickError = errorMsg;
        }
      }

      this.lastTick = new Date();
      this.lastTickError = null;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.lastTickError = errorMsg;
      console.error(`[PayrollScheduler] Tick error: ${errorMsg}`);
    }
  }

  /**
   * Check if a schedule should run now
   */
  private shouldRun(schedule: { nextRunAt: Date; isActive: boolean }): boolean {
    if (!schedule.isActive) return false;
    return new Date() >= schedule.nextRunAt;
  }

  /**
   * Generate batch ID and queue payroll for a scheduled payroll
   */
  private async queuePayroll(schedule: {
    id: string;
    companyUserId: string;
    name: string;
    frequency: string;
    payDay: number;
  }): Promise<void> {
    const batchId = await generateBatchId();

    const jobData: PayrollJobData = {
      companyUserId: schedule.companyUserId,
      scheduledPayrollId: schedule.id,
      batchId,
      triggeredBy: 'SCHEDULE',
    };

    const jobId = await payrollQueue.add('process-payroll', jobData, {
      attempts: 3,
    });

    console.log(
      `[PayrollScheduler] Queued payroll for schedule "${schedule.name}" ` +
      `(${schedule.frequency}, day ${schedule.payDay}) → job ${jobId}, batch ${batchId}`
    );

    // Immediately update nextRunAt so we don't re-process
    const nextRun = calculateNextRunDate(schedule.frequency, schedule.payDay);
    await db.scheduledPayroll.update({
      where: { id: schedule.id },
      data: {
        lastRunAt: new Date(),
        nextRunAt: nextRun,
      },
    });
  }

  /**
   * Get scheduler status
   */
  getStatus(): SchedulerStatus {
    return {
      isRunning: this._isRunning,
      lastTick: this.lastTick,
      lastTickError: this.lastTickError,
      schedulesProcessed: this.schedulesProcessed,
    };
  }
}

// ==================== Initialize Queue Processor ====================

// Register the payroll processor to handle queued jobs
payrollQueue.process(async (job) => {
  console.log(`[PayrollQueue] Processing job ${job.id} — batch ${job.data.batchId}`);
  await processCompanyPayroll(
    job.data.companyUserId,
    job.data.batchId,
    job.data.employeeUserIds,
    job.data.scheduledPayrollId,
  );
});

// ==================== Singleton Export ====================

export const payrollScheduler = new PayrollScheduler();
