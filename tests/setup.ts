process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-must-be-at-least-32-chars-xx';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-must-be-at-least-32-chars-x';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
// A.7 PII crypto — deterministic 32-byte (base64) data key for the
// envelope-encryption unit tests. NOT a production key.
process.env.PII_DATA_KEY = Buffer.alloc(32, 7).toString('base64');
