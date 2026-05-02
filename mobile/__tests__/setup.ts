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
