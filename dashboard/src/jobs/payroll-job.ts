/**
 * Payroll Job Queue — In-memory queue system
 *
 * Mimics Bull's API surface so it can be swapped to Bull when Redis is available.
 * Supports concurrency, delay, retry attempts, and job lifecycle tracking.
 */

// ==================== Types ====================

export interface QueueJob<T> {
  id: string;
  name: string;
  data: T;
  attempts: number;
  maxAttempts: number;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  nextAttemptAt?: Date;
  createdAt: Date;
  processedAt?: Date;
  lastError?: string;
  progress: number;
}

export interface AddOptions {
  delay?: number;
  attempts?: number;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export type JobProcessor<T> = (job: QueueJob<T>) => Promise<void>;

// ==================== MemoryQueue ====================

export class MemoryQueue<T> {
  private jobs: Map<string, QueueJob<T>> = new Map();
  private processor: JobProcessor<T> | null = null;
  private concurrency: number;
  private processing = new Set<string>();
  private queueName: string;
  private _isProcessing = false;

  constructor(name: string, options?: { concurrency?: number }) {
    this.queueName = name;
    this.concurrency = options?.concurrency ?? 1;
  }

  /**
   * Add a new job to the queue
   */
  async add(name: string, data: T, options?: AddOptions): Promise<string> {
    const id = `${this.queueName}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const job: QueueJob<T> = {
      id,
      name,
      data,
      attempts: 0,
      maxAttempts: options?.attempts ?? 3,
      status: options?.delay && options.delay > 0 ? 'delayed' : 'waiting',
      nextAttemptAt: options?.delay
        ? new Date(Date.now() + options.delay)
        : undefined,
      createdAt: new Date(),
      progress: 0,
    };

    this.jobs.set(id, job);

    // If not delayed, try to process immediately
    if (job.status === 'waiting') {
      // Use setImmediate to allow the caller to get the job ID first
      setImmediate(() => this.runNext());
    }

    return id;
  }

  /**
   * Register a processor function for jobs
   */
  async process(fn: JobProcessor<T>): Promise<void> {
    this.processor = fn;
    // Start processing any existing waiting jobs
    this.runNext();
  }

  /**
   * Process the next available job(s) up to concurrency limit
   */
  private async runNext(): Promise<void> {
    if (!this.processor || this._isProcessing) return;

    this._isProcessing = true;

    try {
      while (this.processing.size < this.concurrency) {
        const nextJob = this.getNextJob();
        if (!nextJob) break;

        this.processing.add(nextJob.id);
        nextJob.status = 'active';

        // Process in background — don't await here to allow concurrency
        this.processJob(nextJob).catch((err) => {
          console.error(`[Queue:${this.queueName}] Unhandled error in job ${nextJob.id}:`, err);
        });
      }
    } finally {
      this._isProcessing = false;
    }
  }

  /**
   * Get the next job to process (priority: waiting > delayed with passed time)
   */
  private getNextJob(): QueueJob<T> | null {
    const now = new Date();

    // First check for waiting jobs
    for (const job of this.jobs.values()) {
      if (job.status === 'waiting') {
        return job;
      }
    }

    // Then check for delayed jobs whose time has come
    for (const job of this.jobs.values()) {
      if (job.status === 'delayed' && job.nextAttemptAt && job.nextAttemptAt <= now) {
        job.status = 'waiting';
        return job;
      }
    }

    return null;
  }

  /**
   * Process a single job with error handling and retry logic
   */
  private async processJob(job: QueueJob<T>): Promise<void> {
    try {
      if (!this.processor) return;

      await this.processor(job);

      // Success
      job.status = 'completed';
      job.processedAt = new Date();
      job.progress = 100;
      console.log(`[Queue:${this.queueName}] Job ${job.id} (${job.name}) completed`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      job.lastError = errorMsg;
      job.attempts += 1;

      if (job.attempts < job.maxAttempts) {
        // Retry with exponential backoff
        const backoffDelay = this.calculateBackoff(job.attempts);
        job.status = 'delayed';
        job.nextAttemptAt = new Date(Date.now() + backoffDelay);
        console.warn(
          `[Queue:${this.queueName}] Job ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts}). ` +
          `Retrying in ${backoffDelay / 1000}s. Error: ${errorMsg}`
        );

        // Schedule retry check
        setTimeout(() => this.runNext(), backoffDelay);
      } else {
        // Max attempts exceeded
        job.status = 'failed';
        job.processedAt = new Date();
        console.error(
          `[Queue:${this.queueName}] Job ${job.id} failed permanently after ${job.maxAttempts} attempts. ` +
          `Error: ${errorMsg}`
        );
      }
    } finally {
      this.processing.delete(job.id);
      // Try to process next job
      this.runNext();
    }
  }

  /**
   * Calculate exponential backoff delay
   * attempt 1: 60s, attempt 2: 300s (5min), attempt 3+: 900s (15min)
   */
  private calculateBackoff(attempt: number): number {
    const delays = [60_000, 300_000, 900_000]; // 1min, 5min, 15min
    return delays[Math.min(attempt - 1, delays.length - 1)];
  }

  /**
   * Get a specific job by ID
   */
  getJob(id: string): QueueJob<T> | undefined {
    return this.jobs.get(id);
  }

  /**
   * Get all failed jobs
   */
  getFailed(): QueueJob<T>[] {
    return Array.from(this.jobs.values()).filter((j) => j.status === 'failed');
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const stats: QueueStats = {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
    };

    for (const job of this.jobs.values()) {
      stats[job.status]++;
    }

    return stats;
  }

  /**
   * Retry a failed job
   */
  async retry(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) {
      throw new Error(`Job ${id} not found`);
    }
    if (job.status !== 'failed') {
      throw new Error(`Job ${id} is not in failed state (current: ${job.status})`);
    }

    job.status = 'waiting';
    job.nextAttemptAt = undefined;
    job.lastError = undefined;
    job.progress = 0;

    this.runNext();
  }

  /**
   * Remove completed and failed jobs older than the specified duration
   */
  async clean(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanMs);
    for (const [id, job] of this.jobs) {
      if (
        (job.status === 'completed' || job.status === 'failed') &&
        job.processedAt &&
        job.processedAt < cutoff
      ) {
        this.jobs.delete(id);
      }
    }
  }
}

// ==================== Payroll Queue Types ====================

export interface PayrollJobData {
  companyUserId: string;
  scheduledPayrollId?: string;
  batchId: string;
  employeeUserIds?: string[]; // If empty, run for all employees
  triggeredBy: 'SCHEDULE' | 'MANUAL' | 'RETRY';
}

export interface SinglePayrollJobData {
  payrollId: string;
  attempt: number;
}

// ==================== Singleton Queue Instances ====================

/** Main payroll processing queue */
export const payrollQueue = new MemoryQueue<PayrollJobData>('payroll', {
  concurrency: 1,
});

/** Single employee payroll retry queue */
export const retryQueue = new MemoryQueue<SinglePayrollJobData>('payroll-retry', {
  concurrency: 3,
});
