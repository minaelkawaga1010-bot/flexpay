import { randomBytes } from 'crypto';

// Loaded by jest.e2e.config.js BEFORE any module is imported.
// We keep NODE_ENV=test so winston/morgan stay quiet, but flip on E2E_MODE
// so Redis connects and Bull enqueues actually run against real services.
process.env.NODE_ENV = 'test';
process.env.E2E_MODE = '1';

// TASK-006: per-process random JWT secrets. No fixed test key exists that
// could be copied into a real environment, and the startup secret policy
// (src/config/jwt-secret-policy.ts) applies unchanged under test.
process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(48).toString('hex');
// TASK-007: per-process random webhook credentials (verifiers fail closed without them).
process.env.NYMCARD_WEBHOOK_BASIC_USER = 'flexpay-e2e';
process.env.NYMCARD_WEBHOOK_BASIC_PASSWORD = randomBytes(32).toString('hex');
process.env.MONEYHASH_WEBHOOK_SECRET = randomBytes(32).toString('hex');
process.env.FLEXXPAY_WEBHOOK_SECRET = randomBytes(32).toString('hex');
process.env.BILLER_WEBHOOK_SECRET = randomBytes(32).toString('hex');

// Defaults that match docker-compose. Override via your shell when needed.
process.env.DATABASE_URL ??= 'postgresql://flexpay:securepass@localhost:5432/flexpay?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
