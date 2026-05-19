/** @type {import('jest').Config} */
module.exports = {
  preset: 'react-native',
  // Native module mocks + jest-native matcher registration.
  setupFiles: ['<rootDir>/__tests__/setup.ts'],
  roots: ['<rootDir>/__tests__/unit'],
  testMatch: ['**/__tests__/unit/**/*.test.(ts|tsx)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|react-native-.*|@notifee|@sentry|@testing-library)/)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@components/(.*)$': '<rootDir>/src/components/$1',
    '^@screens/(.*)$': '<rootDir>/src/screens/$1',
    '^@navigation/(.*)$': '<rootDir>/src/navigation/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@store/(.*)$': '<rootDir>/src/store/$1',
    '^@hooks/(.*)$': '<rootDir>/src/hooks/$1',
    '^@theme(/.*)?$': '<rootDir>/src/theme$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@i18n/(.*)$': '<rootDir>/src/i18n/$1',
  },
};
