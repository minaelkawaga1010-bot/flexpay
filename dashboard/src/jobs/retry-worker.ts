/**
 * Retry Worker — Periodically checks for failed payroll jobs and retries them
 *
 * Runs every 15 minutes. Uses exponential backoff:
 *   - Attempt 1: retry after 60s
 *   - Attempt 2: retry after 300s (5 min)
 *   - Attempt 3+: skip (max 3 attempts total)
 *
 * Failed payrolls that exceed max attempts get an escalation notification
 * sent to the company admin.
 */

import { db } from '@/lib/db';
import { retryQueue } from '@/jobs/payroll-job';
import { processSingleEmployeePayroll, createPayrollNotification } from '@/jobs/payroll-processor';
import type { SinglePayrollJobData } from '@/jobs/payroll-job';

// ==================== Types ====================

interface RetryWorkerStatus {
  isRunning: boolean;
  lastRun: Date | null;
  jobsRetried: number;
  jobsEscalated: number;
}

// ==================== RetryWorker ====================

class RetryWorker {
  private intervalId: NodeJS.Timeout | null = null;
  private _isRunning = false;
  private lastRun: Date | null = null;
  private jobsRetried = 0;
  private jobsEscalated = 0;
  private readonly RETRY_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  private readonly MAX_ATTEMPTS = 3;
  private readonly LOOKBACK_HOURS = 24;

  /**
   * Start the retry worker
   */
  start(): void {
    if (this.intervalId) {
      console.warn('[RetryWorker] Already running');
      return;
    }

    this._isRunning = true;
    console.log('[RetryWorker] Started — checking every 15 minutes');

    // Register processor for the retry queue
    retryQueue.process(async (job) => {
      console.log(`[RetryWorker] Processing retry for payroll ${job.data.payrollId} (attempt ${job.data.attempt})`);
      await processSingleEmployeePayroll(job.data.payrollId);
    });

    // Run immediately on start
    this.retryFailedJobs().catch((err) => {
      console.error('[RetryWorker] Initial run error:', err);
    });

    // Set up recurring check
    this.intervalId = setInterval(() => {
      this.retryFailedJobs().catch((err) => {
        console.error('[RetryWorker] Retry check error:', err);
      });
    }, this.RETRY_INTERVAL_MS);
  }

  /**
   * Stop the retry worker
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this._isRunning = false;
    console.log('[RetryWorker] Stopped');
  }

  /**
   * Find failed payrolls and either retry or escalate them
   */
  private async retryFailedJobs(): Promise<void> {
    try {
      const lookbackDate = new Date(Date.now() - this.LOOKBACK_HOURS * 60 * 60 * 1000);

      // Get all failed payrolls from the last 24 hours
      const failedPayrolls = await db.payroll.findMany({
        where: {
          status: 'FAILED',
          createdAt: { gte: lookbackDate },
        },
        include: {
          company: true,
          employee: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      if (failedPayrolls.length === 0) {
        this.lastRun = new Date();
        return;
      }

      console.log(`[RetryWorker] Found ${failedPayrolls.length} failed payroll(s)`);

      for (const payroll of failedPayrolls) {
        // Count previous attempts from transaction metadata
        const attemptCount = await this.countAttempts(payroll.id);

        if (attemptCount >= this.MAX_ATTEMPTS) {
          // Max attempts exceeded — escalate
          await this.escalatePayroll(payroll);
          this.jobsEscalated++;
          continue;
        }

        // Calculate if backoff period has passed
        const backoffDelay = this.getBackoffDelay(attemptCount);
        const timeSinceFailure = Date.now() - (payroll.updatedAt?.getTime() ?? payroll.createdAt.getTime());

        if (timeSinceFailure < backoffDelay) {
          // Not yet time to retry
          continue;
        }

        // Queue the retry
        const jobData: SinglePayrollJobData = {
          payrollId: payroll.id,
          attempt: attemptCount + 1,
        };

        await retryQueue.add('retry-payroll', jobData, {
          attempts: 1, // Only one attempt per queue job; we manage retries ourselves
        });

        // Update payroll status to indicate retry is in progress
        await db.payroll.update({
          where: { id: payroll.id },
          data: {
            status: 'PENDING',
            failureReason: `Retry queued (attempt ${attemptCount + 1}/${this.MAX_ATTEMPTS})`,
          },
        });

        this.jobsRetried++;
        console.log(
          `[RetryWorker] Queued retry for payroll ${payroll.id} ` +
          `(attempt ${attemptCount + 1}/${this.MAX_ATTEMPTS})`
        );
      }

      this.lastRun = new Date();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[RetryWorker] Error: ${errorMsg}`);
    }
  }

  /**
   * Count how many times a payroll has been attempted (failed + retried)
   * We estimate this from the failureReason history or just count 1 for each FAILED status
   */
  private async countAttempts(payrollId: string): Promise<number> {
    // Use a simple heuristic: check metadata in transactions linked to this payroll's batch
    const payroll = await db.payroll.findUnique({
      where: { id: payrollId },
    });

    if (!payroll) return 0;

    // Parse retry count from failure reason if it contains "attempt X/"
    const match = payroll.failureReason?.match(/attempt (\d+)\//);
    if (match) {
      return parseInt(match[1], 10);
    }

    // Default: 1 (the original failure)
    return 1;
  }

  /**
   * Calculate exponential backoff delay based on attempt count
   * attempt 1: 60s, attempt 2: 300s, attempt 3+: skip (max exceeded)
   */
  getBackoffDelay(attempt: number): number {
    const delays = [60_000, 300_000]; // 1min, 5min
    if (attempt > delays.length) {
      return Infinity; // Max attempts exceeded
    }
    return delays[attempt - 1] ?? 60_000;
  }

  /**
   * Escalate a payroll that has exceeded max retry attempts.
   * Creates an URGENT notification for the company admin.
   */
  private async escalatePayroll(payroll: {
    id: string;
    companyUserId: string;
    employeeUserId: string;
    batchId: string;
    netAmount: number;
    failureReason: string | null;
    employee?: { employeeId: string; user?: { fullName?: string } } | null;
    company?: { fullName?: string } | null;
  }): Promise<void> {
    const employeeName = payroll.employee?.user?.fullName ?? payroll.employee?.employeeId ?? 'Unknown';
    const companyName = payroll.company?.fullName ?? 'Company';

    // Mark payroll as permanently failed with escalation note
    await db.payroll.update({
      where: { id: payroll.id },
      data: {
        failureReason: `ESCALATED: Max retry attempts (${this.MAX_ATTEMPTS}) exceeded. Manual intervention required. Last error: ${payroll.failureReason ?? 'Unknown'}`,
      },
    });

    // Create URGENT notification for company admin
    await db.notification.create({
      data: {
        userId: payroll.companyUserId,
        type: 'PAYROLL',
        title: 'Payroll Escalation — Manual Action Required',
        body:
          `Salary payment of AED ${payroll.netAmount.toFixed(2)} for ${employeeName} has failed ` +
          `after ${this.MAX_ATTEMPTS} retry attempts. Batch: ${payroll.batchId}. ` +
          `Please review and process manually.`,
        channel: 'IN_APP',
        priority: 'URGENT',
        data: JSON.stringify({
          payrollId: payroll.id,
          batchId: payroll.batchId,
          employeeUserId: payroll.employeeUserId,
          amount: payroll.netAmount,
          escalated: true,
          reason: payroll.failureReason,
        }),
      },
    });

    // Create audit log for escalation
    await db.auditLog.create({
      data: {
        userId: payroll.companyUserId,
        action: 'PAYROLL_ESCALATED',
        resource: 'Payroll',
        details: JSON.stringify({
          payrollId: payroll.id,
          batchId: payroll.batchId,
          employeeUserId: payroll.employeeUserId,
          maxAttempts: this.MAX_ATTEMPTS,
          lastError: payroll.failureReason,
        }),
      },
    });

    console.warn(
      `[RetryWorker] ESCALATED payroll ${payroll.id} for employee ${employeeName} ` +
      `(${companyName}) — batch ${payroll.batchId}`
    );
  }

  /**
   * Get retry worker status
   */
  getStatus(): RetryWorkerStatus {
    return {
      isRunning: this._isRunning,
      lastRun: this.lastRun,
      jobsRetried: this.jobsRetried,
      jobsEscalated: this.jobsEscalated,
    };
  }
}

// ==================== Singleton Export ====================

export const retryWorker = new RetryWorker();
