/** @type {import('jest').Config} */
module.exports = {
  preset: 'react-native',
  setupFiles: ['./__tests__/setup.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|react-native-.*|@notifee|@sentry)/)',
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
    '^@types/(.*)$': '<rootDir>/src/types/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@i18n/(.*)$': '<rootDir>/src/i18n/$1',
  },
};
