import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import apiClient from '@services/api/client';
import {
  initialiseNotifications,
  displayPaymentNotification,
  NOTIFICATION_CHANNELS,
} from '@services/notifications/NotificationService';
import logger from '@services/utils/logger';

/**
 * usePushNotifications — device-side coordinator for FCM push.
 *
 * Responsibilities:
 *   1. Request native OS notification permission.
 *   2. Initialise Notifee channels (idempotent — safe to call once
 *      we have a permission grant; the call is a no-op on iOS).
 *   3. Fetch the FCM token + POST it to /notifications/register-token
 *      with the device platform tag so the backend's per-platform
 *      payload shaping has the metadata it needs.
 *   4. Subscribe to FCM `onTokenRefresh` and re-register the new
 *      token. Cleanup runs on unmount or auth change.
 *   5. Wire foreground messages → local Notifee display so users see
 *      a heads-up even when the app is in focus.
 *
 * Returns an AsyncValue-shaped view:
 *   status      idle | requesting | granted | denied | error
 *   token       FCM token once registered (null otherwise)
 *   register()  manual entry — useful for permission-re-grant flow
 *   reset()     drop the token and clear listeners
 */

export type PushStatus =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'error';

export interface UsePushNotificationsView {
  status: PushStatus;
  token: string | null;
  error: { code: string; message: string } | null;
  register: () => Promise<void>;
  reset: () => void;
}

export interface UsePushNotificationsOptions {
  /** Skip the auto-register on mount — wire it manually via `register()`. */
  autoRegister?: boolean;
}

export function usePushNotifications(
  options: UsePushNotificationsOptions = {},
): UsePushNotificationsView {
  const [status, setStatus] = useState<PushStatus>('idle');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  // Hold the FCM token-refresh unsubscriber + foreground message
  // unsubscriber across renders. Cleared on reset / unmount.
  const teardownRef = useRef<Array<() => void>>([]);

  const teardown = useCallback(() => {
    for (const u of teardownRef.current) {
      try { u(); } catch { /* best-effort */ }
    }
    teardownRef.current = [];
  }, []);

  const reset = useCallback(() => {
    teardown();
    setStatus('idle');
    setToken(null);
    setError(null);
  }, [teardown]);

  const register = useCallback(async () => {
    setError(null);
    setStatus('requesting');

    // ── 1. Permission gate ──────────────────────────────────────────
    let authStatus: number;
    try {
      authStatus = await messaging().requestPermission();
    } catch (err) {
      logger.warn('push: requestPermission threw', { error: (err as Error).message });
      setError({ code: 'PERMISSION_THREW', message: 'Could not request notification permission.' });
      setStatus('error');
      return;
    }

    const granted =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;

    if (!granted) {
      setStatus('denied');
      return;
    }

    // ── 2. Notifee channels (Android-only inside the helper). ─────
    try {
      await initialiseNotifications();
    } catch (err) {
      logger.warn('push: channel init failed', { error: (err as Error).message });
      // Channel init failure is non-fatal — the token registration can
      // still proceed; the OS surfaces the notification via the default
      // channel.
    }

    // ── 3. Fetch token + register with backend ───────────────────
    let fcmToken: string | null = null;
    try {
      fcmToken = await messaging().getToken();
    } catch (err) {
      logger.warn('push: getToken failed', { error: (err as Error).message });
      setError({ code: 'TOKEN_FETCH_FAILED', message: 'Could not retrieve the device push token.' });
      setStatus('error');
      return;
    }
    if (!fcmToken) {
      setError({ code: 'TOKEN_EMPTY', message: 'Device returned an empty push token.' });
      setStatus('error');
      return;
    }

    try {
      await apiClient.post('/notifications/register-token', {
        token: fcmToken,
        platform: Platform.OS,
        appVersion: undefined, // populated by the App container if available
      });
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'REGISTER_FAILED';
      logger.warn('push: backend register-token failed', { code });
      setError({ code, message: 'Could not register the device with the server.' });
      setStatus('error');
      return;
    }

    setToken(fcmToken);
    setStatus('granted');

    // ── 4. Token refresh subscription ────────────────────────────
    const unsubRefresh = messaging().onTokenRefresh(async (next) => {
      try {
        await apiClient.post('/notifications/register-token', {
          token: next,
          platform: Platform.OS,
        });
        setToken(next);
      } catch (err) {
        logger.warn('push: token refresh re-register failed', {
          error: (err as Error).message,
        });
      }
    });
    teardownRef.current.push(unsubRefresh);

    // ── 5. Foreground message listener ───────────────────────────
    // FCM does NOT auto-display foreground messages on Android. We
    // bridge to Notifee so the user sees a heads-up while in the app.
    const unsubFg = messaging().onMessage(async (remote) => {
      const title = remote.notification?.title ?? '';
      const body = remote.notification?.body ?? '';
      if (!title && !body) return;
      const isPayment =
        (remote.data?.type as string | undefined)?.startsWith('PAYMENT') ||
        remote.data?.type === 'SALARY_CREDITED' ||
        remote.data?.type === 'BILL_PAYMENT_COMPLETED';
      const channelId = isPayment
        ? NOTIFICATION_CHANNELS.PAYMENT_HIGH
        : NOTIFICATION_CHANNELS.SYSTEM;
      await displayPaymentNotification({
        title,
        body,
        channelId,
        data: remote.data as Record<string, string> | undefined,
      });
    });
    teardownRef.current.push(unsubFg);
  }, []);

  // Auto-register on mount unless disabled.
  useEffect(() => {
    if (options.autoRegister === false) return;
    void register();
    return () => teardown();
  }, [options.autoRegister, register, teardown]);

  return { status, token, error, register, reset };
}
