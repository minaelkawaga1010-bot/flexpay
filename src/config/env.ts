import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_PREFIX: z.string().default('/api/v1'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),
  REDIS_OTP_TTL: z.coerce.number().default(300),
  REDIS_RATE_LIMIT_TTL: z.coerce.number().default(3600),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // NymCard
  NYMCARD_API_KEY: z.string().optional(),
  NYMCARD_API_BASE: z.string().url().default('https://sandbox.nymcard.com/v1'),
  NYMCARD_WEBHOOK_SECRET: z.string().optional(),

  // MoneyHash
  MONEYHASH_API_KEY: z.string().optional(),
  MONEYHASH_API_BASE: z.string().url().default('https://sandbox.moneyhash.io/v1'),
  MONEYHASH_WEBHOOK_SECRET: z.string().optional(),

  // FlexxPay
  FLEXXPAY_API_KEY: z.string().optional(),
  FLEXXPAY_API_BASE: z.string().url().default('https://sandbox.flexxpay.com/v1'),
  FLEXXPAY_REDIRECT_URL: z.string().url().default('https://flexpay.ae/ewa/success'),
  FLEXXPAY_WEBHOOK_SECRET: z.string().optional(),

  // Biller rail (Free Bills feature — DEWA/SEWA/Etisalat/etc.)
  BILLER_WEBHOOK_SECRET: z.string().optional(),

  // Firebase
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),

  // Security
  BCRYPT_SALT_ROUNDS: z.coerce.number().default(10),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  WEBHOOK_SIGNATURE_HEADER: z.string().default('x-nymcard-signature'),

  // PII encryption (Bible §5.2 — AES-256-GCM app-layer + KMS envelope)
  // PII_DATA_KEY is the base64-encoded 32-byte data-encryption key. In
  // production this is the KMS-unwrapped DEK injected at boot; in
  // dev/test a static key is acceptable. Optional so unit tests that
  // never touch crypto still boot.
  PII_DATA_KEY: z.string().optional(),
  // Optional pepper appended before hashing Emirates IDs. Leaving it
  // unset yields the Bible's plain SHA-256 (cross-system comparable);
  // setting it hardens against rainbow-table attacks at the cost of
  // cross-system equality. Keep unset unless every consumer shares it.
  EMIRATES_ID_HASH_PEPPER: z.string().optional(),
  // Keyed ledger integrity (Bible §1.3). Unset → plain SHA-256.
  LEDGER_INTEGRITY_KEY: z.string().optional(),

  // Fraud / ML service endpoints (pluggable; heuristic fallback when unset)
  FRAUD_SCORER_URL: z.string().url().optional(),
  PRESIDIO_URL: z.string().url().optional(),
  INJECTION_CLASSIFIER_URL: z.string().url().optional(),
  MOHRE_API_BASE: z.string().url().optional(),
  MOHRE_API_KEY: z.string().optional(),

  // Business Logic
  APP_NAME: z.string().default('FlexPay'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  SUPPORT_EMAIL: z.string().email().default('support@flexpay.ae'),
  CASHBACK_BASIC_RATE: z.coerce.number().default(0.01),
  CASHBACK_LUXURY_RATE: z.coerce.number().default(0.025),
  CASHBACK_BASIC_CAP: z.coerce.number().default(100),
  CASHBACK_LUXURY_CAP: z.coerce.number().default(300),
  PHYSICAL_CARD_FEE: z.coerce.number().default(30),
  P2P_TRANSFER_FEE: z.coerce.number().default(2),
  REMITTANCE_FX_SPREAD: z.coerce.number().default(0.005),
  REMITTANCE_FEE_PERCENT: z.coerce.number().default(0.006),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse({
  ...process.env,
  // Inject sane defaults so the app boots in test even without a .env file.
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me-must-be-32-chars-long',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me-must-be-32-chars-long',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://flexpay:securepass@localhost:5432/flexpay?schema=public',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
});

if (!parsed.success) {
  console.error('Invalid environment variables', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed');
}

export const env: Env = parsed.data;

export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

/**
 * Set when running the e2e suite — `NODE_ENV=test` but actually wired up
 * to real Redis + Postgres. Modules that no-op in test should still run.
 */
export const isE2E = process.env.E2E_MODE === '1' || process.env.E2E_MODE === 'true';
export const isUnitTest = isTest && !isE2E;
