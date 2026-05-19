import { Platform } from 'react-native';
import HapticFeedback from 'react-native-haptic-feedback';

const options = { enableVibrateFallback: true, ignoreAndroidSystemSettings: false };

type Notification = 'success' | 'warning' | 'error';

export const haptics = {
  selection() {
    HapticFeedback.trigger('selection', options);
  },
  impact(intensity: 'light' | 'medium' | 'heavy' = 'medium') {
    HapticFeedback.trigger(`impact${intensity[0].toUpperCase() + intensity.slice(1)}` as never, options);
  },
  success() {
    HapticFeedback.trigger(Platform.OS === 'ios' ? 'notificationSuccess' : 'effectClick', options);
  },
  notification(kind: Notification) {
    const map: Record<Notification, string> = {
      success: 'notificationSuccess',
      warning: 'notificationWarning',
      error: 'notificationError',
    };
    HapticFeedback.trigger(map[kind] as never, options);
  },
};
