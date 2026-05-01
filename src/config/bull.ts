import Bull, { Queue, QueueOptions } from 'bull';
import { env } from './env';

const baseOptions: QueueOptions = {
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
};

function createQueueInternal<T = unknown>(name: string, options?: QueueOptions): Queue<T> {
  return new Bull<T>(name, env.REDIS_URL, { ...baseOptions, ...options });
}

// Public factory used when a module needs an ad-hoc queue.
export function createQueue<T = unknown>(name: string, options?: QueueOptions): Queue<T> {
  return createQueueInternal<T>(name, options);
}

// =====================================================================
// Named queues — single source of truth for the app's background work
// =====================================================================

export const payrollQueue = createQueueInternal<unknown>('payroll');
export const notificationQueue = createQueueInternal<unknown>('notifications');
export const webhookQueue = createQueueInternal<unknown>('webhooks');

const allQueues: Record<string, Queue> = {
  payroll: payrollQueue,
  notifications: notificationQueue,
  webhooks: webhookQueue,
};

/**
 * Probe each queue's underlying Redis client. Returns a per-queue boolean
 * map so the health endpoint can report partial degradation.
 */
export async function checkQueueHealth(): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};
  for (const [name, queue] of Object.entries(allQueues)) {
    try {
      // `client` is a lazy ioredis instance — `ping` round-trips to Redis.
      const client = await queue.client;
      const reply = await client.ping();
      result[name] = reply === 'PONG';
    } catch {
      result[name] = false;
    }
  }
  return result;
}

export async function closeAllQueues(): Promise<void> {
  await Promise.all(Object.values(allQueues).map((q) => q.close()));
}
