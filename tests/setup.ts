import { randomBytes } from 'crypto';

process.env.NODE_ENV = 'test';
// TASK-006: per-process random JWT secrets. No fixed test key exists that
// could be copied into a real environment, and the startup secret policy
// (src/config/jwt-secret-policy.ts) applies unchanged under test.
process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(48).toString('hex');
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
// A.7 PII crypto — deterministic 32-byte (base64) data key for the
// envelope-encryption unit tests. NOT a production key.
process.env.PII_DATA_KEY = Buffer.alloc(32, 7).toString('base64');
