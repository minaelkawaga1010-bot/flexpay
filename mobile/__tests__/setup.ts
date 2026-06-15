// Extend `expect` with React Native matchers (toBeFocused, toBeOnTheScreen,
// toHaveTextContent, etc). Safe to import at setupFiles time — the package
// guards against a missing `expect` and re-runs registration when needed.
import '@testing-library/jest-native/extend-expect';

// Native module shims so unit tests don't need the iOS/Android linker.
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'a', WHEN_UNLOCKED: 'b' },
  ACCESS_CONTROL: { BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'c' },
  setGenericPassword: jest.fn().mockResolvedValue(true),
  getGenericPassword: jest.fn().mockResolvedValue(false),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
}));

jest.mock('@react-native-firebase/messaging', () => ({
  __esModule: true,
  default: () => ({
    getToken: jest.fn().mockResolvedValue('fake-fcm-token'),
    requestPermission: jest.fn().mockResolvedValue(1),
    onMessage: jest.fn().mockReturnValue(() => {}),
    onTokenRefresh: jest.fn(),
    onNotificationOpenedApp: jest.fn(),
    getInitialNotification: jest.fn().mockResolvedValue(null),
  }),
  AuthorizationStatus: { AUTHORIZED: 1, PROVISIONAL: 2 },
}));

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    displayNotification: jest.fn().mockResolvedValue(undefined),
    createChannel: jest.fn().mockResolvedValue(undefined),
    cancelAllNotifications: jest.fn().mockResolvedValue(undefined),
    onForegroundEvent: jest.fn().mockReturnValue(() => {}),
    onBackgroundEvent: jest.fn(),
  },
  AndroidImportance: { HIGH: 4, DEFAULT: 3, LOW: 2 },
  AndroidVisibility: { PRIVATE: 0, PUBLIC: 1, SECRET: -1 },
  EventType: { PRESS: 1, DISMISSED: 0, ACTION_PRESS: 2 },
}));

jest.mock('react-native-localize', () => ({
  getLocales: jest.fn().mockReturnValue([
    { countryCode: 'AE', languageCode: 'en', languageTag: 'en-AE', isRTL: false },
  ]),
}));

jest.mock('react-native-haptic-feedback', () => ({
  __esModule: true,
  default: { trigger: jest.fn() },
  trigger: jest.fn(),
}));

jest.mock('react-native-biometrics', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      isSensorAvailable: jest.fn().mockResolvedValue({ available: false, biometryType: null }),
      simplePrompt: jest.fn().mockResolvedValue({ success: false }),
    })),
    BiometryTypes: { TouchID: 'TouchID', FaceID: 'FaceID', Biometrics: 'Biometrics' },
  };
});
