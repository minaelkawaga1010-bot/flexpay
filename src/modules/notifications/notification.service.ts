import { prisma } from '@config/prisma';
import { getFirebaseMessaging } from '@config/firebase';
import logger from '@shared/utils/logger';
import { formatAED } from '@shared/utils/currency';

export const notificationService = {
  async sendPush(
    deviceToken: string | null | undefined,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!deviceToken) return;
    const messaging = getFirebaseMessaging();
    if (!messaging) {
      logger.info('[push:stub] notification', { deviceToken, title, body, data });
      return;
    }
    try {
      await messaging.send({ notification: { title, body }, data: data ?? {}, token: deviceToken });
    } catch (err) {
      logger.error('Push notification failed', { error: (err as Error).message });
    }
  },

  async pushToEmployee(
    employeeId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee?.notificationsEnabled) return;
    await this.sendPush(employee.deviceToken, title, body, data);
  },

  notifySalaryCredited(employeeId: string, amount: number) {
    return this.pushToEmployee(employeeId, 'Salary Credited', `${formatAED(amount)} added to your wallet.`);
  },

  notifyTransferReceived(employeeId: string, amount: number, fromName: string) {
    return this.pushToEmployee(employeeId, 'Money Received', `${formatAED(amount)} received from ${fromName}.`);
  },

  notifyTransferSent(employeeId: string, amount: number, toName: string) {
    return this.pushToEmployee(employeeId, 'Transfer Sent', `${formatAED(amount)} sent to ${toName}.`);
  },

  notifyCashback(employeeId: string, amount: number) {
    return this.pushToEmployee(employeeId, 'Cashback Earned', `You earned ${formatAED(amount)} in cashback.`);
  },

  notifyTrackingNumber(employeeId: string, trackingNumber: string) {
    return this.pushToEmployee(employeeId, 'Card Shipped', `Tracking number: ${trackingNumber}`);
  },
};
