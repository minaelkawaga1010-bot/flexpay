import { prisma } from '../config/db';
import { logger } from '../config/logger';
import { env } from '../config/env';

let messaging: import('firebase-admin').messaging.Messaging | null = null;

function getMessaging() {
  if (messaging) return messaging;
  if (!env.firebase.credentialsPath) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    messaging = admin.messaging();
    return messaging;
  } catch (err) {
    logger.warn({ err }, 'firebase init failed; push notifications disabled');
    return null;
  }
}

export async function sendPushNotification(
  deviceToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  if (!deviceToken) return;
  const m = getMessaging();
  if (!m) {
    logger.info({ deviceToken, title, body, data }, '[push:stub] notification');
    return;
  }
  try {
    await m.send({ notification: { title, body }, data: data ?? {}, token: deviceToken });
  } catch (err) {
    logger.error({ err, deviceToken }, 'push notification failed');
  }
}

async function pushToEmployee(employeeId: string, title: string, body: string, data?: Record<string, string>) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  await sendPushNotification(employee?.deviceToken, title, body, data);
}

export const notificationService = {
  sendPushNotification,

  notifySalaryCredited(employeeId: string, amount: number) {
    return pushToEmployee(employeeId, 'Salary Credited', `AED ${amount.toFixed(2)} added to your wallet.`);
  },

  notifyTransferReceived(employeeId: string, amount: number, fromName: string) {
    return pushToEmployee(employeeId, 'Money Received', `AED ${amount.toFixed(2)} received from ${fromName}.`);
  },

  notifyTransferSent(employeeId: string, amount: number, toName: string) {
    return pushToEmployee(employeeId, 'Transfer Sent', `AED ${amount.toFixed(2)} sent to ${toName}.`);
  },

  notifyCashback(employeeId: string, amount: number) {
    return pushToEmployee(employeeId, 'Cashback Earned', `You earned AED ${amount.toFixed(2)} in cashback.`);
  },

  notifyTrackingNumber(employeeId: string, trackingNumber: string) {
    return pushToEmployee(employeeId, 'Card Shipped', `Tracking number: ${trackingNumber}`);
  },
};
