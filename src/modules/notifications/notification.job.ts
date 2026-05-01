import { notificationQueue } from '@config/bull';
import logger from '@shared/utils/logger';
import { notificationService } from './notification.service';

export type NotificationJob =
  | { kind: 'salary-credited'; employeeId: string; amount: number; companyName?: string }
  | { kind: 'transfer-sent'; employeeId: string; amount: number; recipientName: string }
  | { kind: 'transfer-received'; employeeId: string; amount: number; senderName: string }
  | { kind: 'cashback'; employeeId: string; amount: number }
  | { kind: 'tracking'; employeeId: string; trackingNumber: string };

let workerInstalled = false;

export function startNotificationWorker(): void {
  if (workerInstalled) return;
  workerInstalled = true;

  notificationQueue.process(async (job) => {
    const data = job.data as NotificationJob;
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

  notificationQueue.on('failed', (job, err) => {
    logger.error('notification job failed', {
      jobId: job.id,
      kind: (job.data as NotificationJob).kind,
      error: err.message,
    });
  });
}

/** Enqueue a notification. No-op in test env so unit tests don't open Redis. */
export async function enqueueNotification(job: NotificationJob): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  startNotificationWorker();
  await notificationQueue.add(job, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
  });
}
