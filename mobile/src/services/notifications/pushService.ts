import messaging, {
  FirebaseMessagingTypes,
} from '@react-native-firebase/messaging';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import { Linking, Platform } from 'react-native';
import apiClient from '@services/api/client';
import logger from '@services/utils/logger';
import { NavigationService } from '@navigation/NavigationService';

export type NotificationKind =
  | 'SALARY_CREDITED'
  | 'TRANSFER_RECEIVED'
  | 'CASHBACK_EARNED'
  | 'CARD_SHIPPED'
  | 'OFFER_AVAILABLE';

export interface NotificationData {
  type?: NotificationKind;
  amount?: string;
  transactionId?: string;
  cardId?: string;
  trackingNumber?: string;
  offerId?: string;
  deepLink?: string;
}

class PushService {
  /**
   * Persistent unsubscribers for the listeners attached on app start.
   * Returned by `setupNotificationListeners` so the App component can
   * tear them down on unmount.
   */
  private unsubscribers: Array<() => void> = [];

  async requestPermission(): Promise<boolean> {
    try {
      const status = await messaging().requestPermission();
      return (
        status === messaging.AuthorizationStatus.AUTHORIZED ||
        status === messaging.AuthorizationStatus.PROVISIONAL
      );
    } catch (err) {
      logger.error('push:requestPermission failed', { error: (err as Error).message });
      return false;
    }
  }

  /**
   * Fetch the current FCM token and POST it to the backend so the
   * notification queue knows where to deliver. Idempotent — the backend's
   * /notifications/register accepts repeat calls with the same token.
   */
  async registerForRemoteNotifications(): Promise<void> {
    try {
      const fcmToken = await messaging().getToken();
      if (!fcmToken) return;
      await apiClient.post('/notifications/register', { deviceToken: fcmToken });
      logger.info('push: device registered', {
        platform: Platform.OS,
        tokenPreview: `${fcmToken.slice(0, 10)}…`,
      });

      // Re-register when FCM rotates the token.
      const unsubscribe = messaging().onTokenRefresh(async (next) => {
        try {
          await apiClient.post('/notifications/register', { deviceToken: next });
          logger.info('push: token refreshed and re-registered');
        } catch (err) {
          logger.warn('push: token re-register failed', { error: (err as Error).message });
        }
      });
      this.unsubscribers.push(unsubscribe);
    } catch (err) {
      logger.warn('push: registerForRemoteNotifications failed', {
        error: (err as Error).message,
      });
    }
  }

  /**
   * Wire up FCM + Notifee handlers. Returns a teardown function so the
   * App root can clean up on unmount.
   */
  async setupNotificationListeners(): Promise<() => void> {
    await this.setupNotifeeChannels();

    const unsubForeground = messaging().onMessage(async (remoteMessage) => {
      await this.displayLocal(remoteMessage);
    });

    const unsubOpened = messaging().onNotificationOpenedApp((remoteMessage) => {
      this.handleNotificationNavigation(remoteMessage.data ?? {});
    });

    // App launched from a terminated state via notification.
    const initial = await messaging().getInitialNotification();
    if (initial) this.handleNotificationNavigation(initial.data ?? {});

    const notifeeUnsub = notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.PRESS && detail.notification?.data) {
        this.handleNotificationNavigation(detail.notification.data as NotificationData);
      }
    });

    this.unsubscribers.push(unsubForeground, unsubOpened, notifeeUnsub);
    return () => this.teardown();
  }

  teardown(): void {
    for (const fn of this.unsubscribers) {
      try {
        fn();
      } catch {
        // ignore — best-effort cleanup
      }
    }
    this.unsubscribers = [];
  }

  async showLocal(title: string, body: string, data?: NotificationData): Promise<void> {
    await notifee.displayNotification({
      title,
      body,
      data: data as Record<string, string> | undefined,
      android: {
        channelId: 'flexpay-default',
        smallIcon: 'ic_notification',
        color: '#1E40AF',
        pressAction: { id: 'default' },
      },
      ios: { sound: 'default' },
    });
  }

  async cancelAll(): Promise<void> {
    await notifee.cancelAllNotifications();
  }

  // -------------------------------------------------------- internals

  private async displayLocal(
    remoteMessage: FirebaseMessagingTypes.RemoteMessage,
  ): Promise<void> {
    const title = remoteMessage.notification?.title ?? '';
    const body = remoteMessage.notification?.body ?? '';
    if (!title && !body) return;

    const channelId =
      (remoteMessage.data?.type as string)?.includes('OFFER')
        ? 'flexpay-offers'
        : 'flexpay-transactions';

    await notifee.displayNotification({
      title,
      body,
      data: remoteMessage.data,
      android: {
        channelId,
        smallIcon: 'ic_notification',
        color: '#1E40AF',
        pressAction: { id: 'default' },
      },
      ios: { sound: 'default' },
    });
  }

  private async setupNotifeeChannels(): Promise<void> {
    if (Platform.OS !== 'android') return;
    await Promise.all([
      notifee.createChannel({
        id: 'flexpay-default',
        name: 'General',
        importance: AndroidImportance.HIGH,
      }),
      notifee.createChannel({
        id: 'flexpay-transactions',
        name: 'Transactions',
        importance: AndroidImportance.HIGH,
        vibration: true,
      }),
      notifee.createChannel({
        id: 'flexpay-offers',
        name: 'Offers & Cashback',
        importance: AndroidImportance.DEFAULT,
      }),
    ]);
  }

  private handleNotificationNavigation(data: NotificationData | Record<string, string>): void {
    const typed = data as NotificationData;

    if (typed.deepLink) {
      Linking.openURL(typed.deepLink).catch((err) =>
        logger.error('push: openURL failed', { error: (err as Error).message }),
      );
      return;
    }

    switch (typed.type) {
      case 'SALARY_CREDITED':
      case 'TRANSFER_RECEIVED':
      case 'CASHBACK_EARNED':
        NavigationService.navigate('App', { screen: 'Wallet' });
        break;
      case 'CARD_SHIPPED':
        NavigationService.navigate('App', { screen: 'Cards' });
        break;
      case 'OFFER_AVAILABLE':
        NavigationService.navigate('App', { screen: 'Offers' });
        break;
      default:
        NavigationService.navigate('App', { screen: 'Home' });
    }
  }
}

export const pushService = new PushService();
