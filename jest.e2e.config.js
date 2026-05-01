/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/e2e'],
  testMatch: ['**/*.e2e.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@webhooks/(.*)$': '<rootDir>/src/webhooks/$1',
  },
  setupFiles: ['<rootDir>/tests/e2e/setup.ts'],
  // E2E suites must serialise — they share a real DB row space.
  maxWorkers: 1,
  testTimeout: 30_000,
};
