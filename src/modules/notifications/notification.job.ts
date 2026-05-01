import { Queue } from 'bull';
import { createQueue } from '@config/bull';
import logger from '@shared/utils/logger';
import { notificationService } from './notification.service';

export type NotificationJob =
  | { kind: 'salary-credited'; employeeId: string; amount: number; companyName?: string }
  | { kind: 'transfer-sent'; employeeId: string; amount: number; recipientName: string }
  | { kind: 'transfer-received'; employeeId: string; amount: number; senderName: string }
  | { kind: 'cashback'; employeeId: string; amount: number }
  | { kind: 'tracking'; employeeId: string; trackingNumber: string };

export const NOTIFICATION_QUEUE_NAME = 'notifications';

let queue: Queue<NotificationJob> | null = null;
let initialised = false;

export function getNotificationQueue(): Queue<NotificationJob> {
  if (queue && initialised) return queue;
  queue = createQueue<NotificationJob>(NOTIFICATION_QUEUE_NAME);
  initialised = true;

  queue.process(async (job) => {
    const data = job.data;
    switch (data.kind) {
      case 'salary-credited':
        return notificationService.notifySalaryCredited(data.employeeId, data.amount);
      case 'transfer-sent':
        return notificationService.notifyTransferSent(data.employeeId, data.amount, data.recipientName);
      case 'transfer-received':
        return notificationService.notifyTransferReceived(data.employeeId, data.amount, data.senderName);
      case 'cashback':
        return notificationService.notifyCashback(data.employeeId, data.amount);
      case 'tracking':
        return notificationService.notifyTrackingNumber(data.employeeId, data.trackingNumber);
    }
  });

  queue.on('failed', (job, err) => {
    logger.error('notification job failed', {
      jobId: job.id,
      kind: job.data.kind,
      error: err.message,
    });
  });

  return queue;
}

/** Enqueue a notification. Falls back to in-process delivery in test env. */
export async function enqueueNotification(job: NotificationJob): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    // Avoid spinning up a Bull worker during unit tests.
    return;
  }
  await getNotificationQueue().add(job, { attempts: 5, backoff: { type: 'exponential', delay: 5000 } });
}
