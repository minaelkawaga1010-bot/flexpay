// Loaded by jest.e2e.config.js BEFORE any module is imported.
// We keep NODE_ENV=test so winston/morgan stay quiet, but flip on E2E_MODE
// so Redis connects and Bull enqueues actually run against real services.
process.env.NODE_ENV = 'test';
process.env.E2E_MODE = '1';

// Strong-enough secrets to satisfy Zod's min(32) constraint.
process.env.JWT_ACCESS_SECRET ??= 'e2e-access-secret-must-be-at-least-32-chars-xx';
process.env.JWT_REFRESH_SECRET ??= 'e2e-refresh-secret-must-be-at-least-32-chars-x';

// Defaults that match docker-compose. Override via your shell when needed.
process.env.DATABASE_URL ??= 'postgresql://flexpay:securepass@localhost:5432/flexpay?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
