/**
 * usePushNotifications + NotificationService — Phase 2 Feature #5 tests.
 *
 * Covers:
 *   • Permission gate denial (status → 'denied', no token register).
 *   • Permission grant + token registration with platform metadata.
 *   • Token refresh re-posts with the same platform tag.
 *   • Foreground FCM message routes to Notifee with the right channel.
 *   • Background handler binds via setBackgroundHandler.
 *   • Channel initialisation registers all four channels.
 *   • GCC locale → Arabic copy resolution.
 *   • Token-empty / token-fetch-failed surfaces explicit error codes.
 *   • API failure surfaces REGISTER_FAILED.
 *
 * Firebase Messaging + Notifee are mocked at the suite boundary in
 * `__tests__/setup.ts`; this file extends with per-test return values.
 */

// Stable singleton override for the FCM mock — the setup.ts mock
// returns a fresh object on every messaging() call, which prevents
// per-test mockResolvedValue tweaks from persisting. We replace it
// here with a singleton, lazy-bound via inner functions so the
// jest.mock factory hoist doesn't capture the singleton in TDZ.
const mockFcm = {
  getToken: jest.fn(),
  requestPermission: jest.fn(),
  onMessage: jest.fn(),
  onTokenRefresh: jest.fn(),
  onNotificationOpenedApp: jest.fn(),
  getInitialNotification: jest.fn(),
};
jest.mock('@react-native-firebase/messaging', () => {
  const stub: any = () => mockFcm;
  stub.AuthorizationStatus = { AUTHORIZED: 1, PROVISIONAL: 2 };
  return { __esModule: true, default: stub };
});

jest.mock('@services/api/client', () => ({
  __esModule: true,
  default: {
    post: jest.fn().mockResolvedValue({ data: {} }),
    get: jest.fn(),
  },
}));

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';
import * as Localize from 'react-native-localize';
import apiClient from '@services/api/client';
import {
  initialiseNotifications,
  _resetNotificationServiceForTesting,
  resolveLocaleCopy,
  setBackgroundHandler,
  displayPaymentNotification,
  NOTIFICATION_CHANNELS,
} from '@services/notifications/NotificationService';
import { usePushNotifications } from '@hooks/usePushNotifications';

const mockedNotifee = notifee as unknown as {
  createChannel: jest.Mock;
  displayNotification: jest.Mock;
  onForegroundEvent: jest.Mock;
  onBackgroundEvent: jest.Mock;
};
const mockedLocalize = Localize as unknown as { getLocales: jest.Mock };
const apiPost = (apiClient as unknown as { post: jest.Mock }).post;

// ───────────────────────────────────────────────────────────────────
// Per-test fresh state for the FCM mock
// ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  _resetNotificationServiceForTesting();
  // Default happy path: permission granted, a fresh token, no-op
  // listeners. Tests override individual fields as needed.
  mockFcm.getToken.mockResolvedValue('fcm-token-abc');
  mockFcm.requestPermission.mockResolvedValue(1); // AUTHORIZED
  mockFcm.onMessage.mockReturnValue(() => {});
  mockFcm.onTokenRefresh.mockReturnValue(() => {});
  mockFcm.onNotificationOpenedApp.mockReturnValue(() => {});
  mockFcm.getInitialNotification.mockResolvedValue(null);
  mockedLocalize.getLocales.mockReturnValue([
    { countryCode: 'AE', languageCode: 'en', languageTag: 'en-AE', isRTL: false },
  ]);
  apiPost.mockResolvedValue({ data: {} });
  (Platform as any).OS = 'android';
});

// ═══════════════════════════════════════════════════════════════════
// Permission gate
// ═══════════════════════════════════════════════════════════════════

describe('usePushNotifications — permission gate', () => {
  it('flips to status=denied when the user refuses the OS prompt', async () => {
    mockFcm.requestPermission.mockResolvedValue(0); // NOT_DETERMINED / DENIED
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.status).toBe('denied'));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('surfaces a PERMISSION_THREW error when requestPermission rejects', async () => {
    mockFcm.requestPermission.mockRejectedValue(new Error('OS error'));
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.code).toBe('PERMISSION_THREW');
    expect(apiPost).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Token registration
// ═══════════════════════════════════════════════════════════════════

describe('usePushNotifications — token registration', () => {
  it('POSTs to /notifications/register-token with token + platform on grant', async () => {
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.status).toBe('granted'));

    expect(apiPost).toHaveBeenCalledWith(
      '/notifications/register-token',
      expect.objectContaining({
        token: 'fcm-token-abc',
        platform: 'android',
      }),
    );
    expect(result.current.token).toBe('fcm-token-abc');
  });

  it('surfaces TOKEN_FETCH_FAILED when getToken throws', async () => {
    mockFcm.getToken.mockRejectedValue(new Error('fcm offline'));
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.code).toBe('TOKEN_FETCH_FAILED');
  });

  it('surfaces TOKEN_EMPTY when getToken returns empty', async () => {
    mockFcm.getToken.mockResolvedValue('');
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.code).toBe('TOKEN_EMPTY');
  });

  it('surfaces REGISTER_FAILED when the backend POST rejects', async () => {
    apiPost.mockRejectedValueOnce(new Error('500 internal'));
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.code).toBe('REGISTER_FAILED');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Token refresh + foreground listener
// ═══════════════════════════════════════════════════════════════════

describe('usePushNotifications — refresh + foreground listener', () => {
  it('subscribes to onTokenRefresh and re-POSTs on rotation', async () => {
    let refreshHandler: ((token: string) => Promise<void>) | null = null;
    const ms = mockFcm;
    ms.onTokenRefresh.mockImplementation((handler: (token: string) => Promise<void>) => {
      refreshHandler = handler;
      return () => {};
    });

    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.status).toBe('granted'));
    apiPost.mockClear();

    await act(async () => {
      await refreshHandler?.('fcm-token-rotated');
    });

    expect(apiPost).toHaveBeenCalledWith(
      '/notifications/register-token',
      expect.objectContaining({ token: 'fcm-token-rotated', platform: 'android' }),
    );
  });

  it('foreground message routes a payment payload to the PAYMENT_HIGH channel', async () => {
    let fgHandler: ((msg: any) => Promise<void>) | null = null;
    const ms = mockFcm;
    ms.onMessage.mockImplementation((handler: (msg: any) => Promise<void>) => {
      fgHandler = handler;
      return () => {};
    });

    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.status).toBe('granted'));

    await act(async () => {
      await fgHandler?.({
        notification: { title: 'Salary deposited', body: 'AED 5,000 received' },
        data: { type: 'SALARY_CREDITED', amount: '5000' },
      });
    });

    expect(mockedNotifee.displayNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Salary deposited',
        body: 'AED 5,000 received',
        android: expect.objectContaining({ channelId: NOTIFICATION_CHANNELS.PAYMENT_HIGH }),
      }),
    );
  });

  it('foreground message with no title/body is a no-op (drops empty payloads)', async () => {
    let fgHandler: ((msg: any) => Promise<void>) | null = null;
    const ms = mockFcm;
    ms.onMessage.mockImplementation((handler: (msg: any) => Promise<void>) => {
      fgHandler = handler;
      return () => {};
    });

    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.status).toBe('granted'));

    await act(async () => {
      await fgHandler?.({ notification: {}, data: {} });
    });
    expect(mockedNotifee.displayNotification).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Channel initialisation
// ═══════════════════════════════════════════════════════════════════

describe('NotificationService — channel init', () => {
  it('registers all four channels on Android', async () => {
    (Platform as any).OS = 'android';
    await initialiseNotifications();
    const calls = mockedNotifee.createChannel.mock.calls;
    expect(calls.length).toBe(4);
    const ids = calls.map((c) => c[0].id);
    expect(new Set(ids)).toEqual(new Set(Object.values(NOTIFICATION_CHANNELS)));
  });

  it('is idempotent — second call does NOT re-register', async () => {
    (Platform as any).OS = 'android';
    await initialiseNotifications();
    mockedNotifee.createChannel.mockClear();
    await initialiseNotifications();
    expect(mockedNotifee.createChannel).not.toHaveBeenCalled();
  });

  it('no-ops on iOS (channels are an Android-only concept)', async () => {
    (Platform as any).OS = 'ios';
    await initialiseNotifications();
    expect(mockedNotifee.createChannel).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// GCC locale
// ═══════════════════════════════════════════════════════════════════

describe('NotificationService — GCC locale resolution', () => {
  it('returns English copy when the device locale is en-US', () => {
    mockedLocalize.getLocales.mockReturnValue([
      { countryCode: 'US', languageCode: 'en', languageTag: 'en-US', isRTL: false },
    ]);
    const copy = resolveLocaleCopy();
    expect(copy[NOTIFICATION_CHANNELS.PAYMENT_HIGH].name).toBe('Payment alerts');
  });

  it('returns Arabic copy when the device locale is in the GCC region', () => {
    mockedLocalize.getLocales.mockReturnValue([
      { countryCode: 'AE', languageCode: 'ar', languageTag: 'ar-AE', isRTL: true },
    ]);
    const copy = resolveLocaleCopy();
    expect(copy[NOTIFICATION_CHANNELS.PAYMENT_HIGH].name).toBe('تنبيهات المدفوعات');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Background handler binding
// ═══════════════════════════════════════════════════════════════════

describe('NotificationService — background handler', () => {
  it('binds via notifee.onBackgroundEvent on setBackgroundHandler', () => {
    const handler = jest.fn();
    setBackgroundHandler(handler);
    expect(mockedNotifee.onBackgroundEvent).toHaveBeenCalledTimes(1);

    // Simulate the native invocation with a PRESS event.
    const nativeHandler = mockedNotifee.onBackgroundEvent.mock.calls[0][0];
    nativeHandler({
      type: EventType.PRESS,
      detail: { notification: { id: 'n-1', body: 'tap' } },
    });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'n-1' }));
  });

  it('ignores non-PRESS events (DISMISSED, ACTION_PRESS)', () => {
    const handler = jest.fn();
    setBackgroundHandler(handler);
    const nativeHandler = mockedNotifee.onBackgroundEvent.mock.calls[0][0];
    nativeHandler({ type: 0 /* DISMISSED */, detail: { notification: { id: 'x' } } });
    expect(handler).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Display path
// ═══════════════════════════════════════════════════════════════════

describe('NotificationService — display path', () => {
  it('routes a payment confirmation through notifee.displayNotification', async () => {
    await displayPaymentNotification({
      title: 'Bill paid',
      body: 'DEWA 2001234567 settled',
      channelId: NOTIFICATION_CHANNELS.PAYMENT_CONFIRMATION,
      data: { billId: 'bp-1' },
    });
    expect(mockedNotifee.displayNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Bill paid',
        body: 'DEWA 2001234567 settled',
        android: expect.objectContaining({
          channelId: NOTIFICATION_CHANNELS.PAYMENT_CONFIRMATION,
        }),
      }),
    );
  });
});
