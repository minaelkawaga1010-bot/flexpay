import notifee, {
  AndroidImportance,
  AndroidVisibility,
  EventType,
  type Notification,
} from '@notifee/react-native';
import * as Localize from 'react-native-localize';
import { Platform } from 'react-native';
import logger from '@services/utils/logger';

/**
 * NotificationService — channel orchestration + foreground/background
 * routing for FlexPay's transactional push surface.
 *
 * Split from the legacy `pushService.ts`:
 *   • pushService owns FCM (permissions, token registration, message
 *     listeners) — the transport layer.
 *   • NotificationService owns the Notifee SURFACE — channels, the
 *     locale-aware display path, and the foreground-event router.
 *
 * Why two services:
 *   The transport layer (FCM) and the display layer (Notifee /
 *   on-device notification surface) have independent lifecycles —
 *   Notifee runs even when the device has no FCM token (e.g. when
 *   the app emits a purely local heads-up). Keeping them in one
 *   class conflates the responsibilities and makes the GCC locale
 *   work below harder to test in isolation.
 *
 * Free-function shape (the codebase convention) — no class wrapper,
 * one default initialise() entry point at app boot.
 */

// ───────────────────────────────────────────────────────────────────
// Channel registry — GCC-locale aware
// ───────────────────────────────────────────────────────────────────

/**
 * High-priority channel for payment events (salary credit, bill
 * settlement, refund, card auth). Heads-up + sound + vibration on
 * Android. On iOS the importance is per-message (we set
 * critical-alert eligibility on the relevant push payloads server-
 * side; on the device side we just need a channel id that doesn't
 * fall under the default "minor updates" category).
 */
export const NOTIFICATION_CHANNELS = {
  PAYMENT_HIGH: 'flexpay-payment-high',
  PAYMENT_CONFIRMATION: 'flexpay-payment-confirmation',
  OFFER: 'flexpay-offer',
  SYSTEM: 'flexpay-system',
} as const;

type ChannelId = (typeof NOTIFICATION_CHANNELS)[keyof typeof NOTIFICATION_CHANNELS];

interface ChannelDef {
  id: ChannelId;
  importance: AndroidImportance;
  visibility?: AndroidVisibility;
}

const CHANNELS: ReadonlyArray<ChannelDef> = [
  { id: NOTIFICATION_CHANNELS.PAYMENT_HIGH,         importance: AndroidImportance.HIGH,    visibility: AndroidVisibility.PRIVATE },
  { id: NOTIFICATION_CHANNELS.PAYMENT_CONFIRMATION, importance: AndroidImportance.DEFAULT, visibility: AndroidVisibility.PRIVATE },
  { id: NOTIFICATION_CHANNELS.OFFER,                importance: AndroidImportance.LOW },
  { id: NOTIFICATION_CHANNELS.SYSTEM,               importance: AndroidImportance.DEFAULT },
];

// ───────────────────────────────────────────────────────────────────
// GCC localisation
// ───────────────────────────────────────────────────────────────────

/**
 * GCC tags that should resolve to the Arabic notification copy.
 * UAE / KSA / Bahrain / Kuwait / Qatar / Oman — any of these locales
 * present in the device locale list pulls Arabic strings.
 */
const GCC_LOCALES = new Set(['AE', 'SA', 'BH', 'KW', 'QA', 'OM']);

interface LocalisedChannelCopy {
  name: string;
  description: string;
}

type ChannelCopyMap = Record<ChannelId, LocalisedChannelCopy>;

const COPY_EN: ChannelCopyMap = {
  [NOTIFICATION_CHANNELS.PAYMENT_HIGH]: {
    name: 'Payment alerts',
    description: 'Real-time alerts for salary credits, card authorisations, and bill payments.',
  },
  [NOTIFICATION_CHANNELS.PAYMENT_CONFIRMATION]: {
    name: 'Payment confirmations',
    description: 'Bill and transfer confirmations after the rail settles.',
  },
  [NOTIFICATION_CHANNELS.OFFER]: {
    name: 'Offers',
    description: 'Personalised offers and partner promotions.',
  },
  [NOTIFICATION_CHANNELS.SYSTEM]: {
    name: 'Account & security',
    description: 'Account changes, login alerts, and FlexPay updates.',
  },
};

const COPY_AR: ChannelCopyMap = {
  [NOTIFICATION_CHANNELS.PAYMENT_HIGH]: {
    name: 'تنبيهات المدفوعات',
    description: 'تنبيهات فورية لاستلام الراتب، عمليات البطاقة، ودفع الفواتير.',
  },
  [NOTIFICATION_CHANNELS.PAYMENT_CONFIRMATION]: {
    name: 'تأكيدات الدفع',
    description: 'تأكيدات دفع الفواتير والتحويلات بعد تسوية المعاملة.',
  },
  [NOTIFICATION_CHANNELS.OFFER]: {
    name: 'العروض',
    description: 'عروض شخصية وعروض الشركاء.',
  },
  [NOTIFICATION_CHANNELS.SYSTEM]: {
    name: 'الحساب والأمان',
    description: 'تنبيهات الحساب وتسجيل الدخول وتحديثات فليكس باي.',
  },
};

export function resolveLocaleCopy(): ChannelCopyMap {
  try {
    const locales = Localize.getLocales();
    const inGcc = locales.some((l) => GCC_LOCALES.has((l.countryCode ?? '').toUpperCase()));
    const arabic = locales.some((l) => (l.languageCode ?? '').toLowerCase() === 'ar');
    return arabic || inGcc ? COPY_AR : COPY_EN;
  } catch {
    return COPY_EN;
  }
}

// ───────────────────────────────────────────────────────────────────
// Initialisation — idempotent channel registration
// ───────────────────────────────────────────────────────────────────

let initialised = false;

/**
 * Register every channel with Notifee. Idempotent — running this
 * twice is safe; Notifee de-dupes by channel id. Pulls the locale-
 * appropriate channel names + descriptions so the user-facing
 * settings screen renders in the right language.
 *
 * No-op on iOS — channels are an Android-only concept; the iOS path
 * uses per-notification sound + critical-alert flags instead.
 */
export async function initialiseNotifications(): Promise<void> {
  if (initialised) return;
  if (Platform.OS !== 'android') {
    initialised = true;
    return;
  }
  const copy = resolveLocaleCopy();
  for (const def of CHANNELS) {
    await notifee.createChannel({
      id: def.id,
      name: copy[def.id].name,
      description: copy[def.id].description,
      importance: def.importance,
      visibility: def.visibility,
      // sound left to Notifee's default — server-side payloads name a
      // sound file explicitly when a louder alert is warranted.
    });
  }
  initialised = true;
  logger.info('notifications: channels initialised', { count: CHANNELS.length });
}

/** Exposed for tests so the next initialise() picks a fresh locale. */
export function _resetNotificationServiceForTesting(): void {
  initialised = false;
}

// ───────────────────────────────────────────────────────────────────
// Foreground / background routing
// ───────────────────────────────────────────────────────────────────

export type ForegroundEventHandler = (notification: Notification) => void;
export type BackgroundEventHandler = (notification: Notification) => void;

/**
 * Bind a handler for tap events while the app is foregrounded.
 * Returns a teardown that should be called on unmount.
 */
export function onForegroundPress(handler: ForegroundEventHandler): () => void {
  const unsub = notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS && detail.notification) {
      try {
        handler(detail.notification);
      } catch (err) {
        logger.warn('notifications: foreground handler threw', {
          error: (err as Error).message,
        });
      }
    }
  });
  return unsub;
}

/**
 * Bind a handler for background / quit-state taps. Notifee's
 * background-event API is module-global (registered once at the
 * native module's lifecycle), so this binder is also module-global:
 * subsequent calls replace the handler. The intent is one
 * registration per app process.
 */
export function setBackgroundHandler(handler: BackgroundEventHandler): void {
  notifee.onBackgroundEvent(async ({ type, detail }) => {
    if (type === EventType.PRESS && detail.notification) {
      try {
        handler(detail.notification);
      } catch (err) {
        logger.warn('notifications: background handler threw', {
          error: (err as Error).message,
        });
      }
    }
  });
}

// ───────────────────────────────────────────────────────────────────
// Display path
// ───────────────────────────────────────────────────────────────────

export interface DisplayPaymentArgs {
  title: string;
  body: string;
  channelId: ChannelId;
  data?: Record<string, string>;
}

export async function displayPaymentNotification(args: DisplayPaymentArgs): Promise<void> {
  await notifee.displayNotification({
    title: args.title,
    body: args.body,
    data: args.data,
    android: {
      channelId: args.channelId,
      smallIcon: 'ic_notification',
      color: '#1E40AF',
      pressAction: { id: 'default' },
    },
    ios: { sound: 'default' },
  });
}
