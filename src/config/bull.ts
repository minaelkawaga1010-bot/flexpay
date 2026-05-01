import Bull, { Queue, QueueOptions } from 'bull';
import { env } from './env';

const defaultOptions: QueueOptions = {
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
};

export function createQueue<T = unknown>(name: string, options?: QueueOptions): Queue<T> {
  return new Bull<T>(name, env.REDIS_URL, { ...defaultOptions, ...options });
}
