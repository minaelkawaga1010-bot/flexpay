import 'dotenv/config';
import { z } from 'zod';
import { jwtConfigIssues, parseTtlSeconds } from './jwt-secret-policy';
import { productionIntegrationIssues } from './integration-safety';

const JWT_SECRET_REQUIRED = 'is required and has no default — set it explicitly';

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

  // JWT — no default secret in ANY environment (TASK-006). Strength,
  // distinctness and lifetimes are enforced by jwt-secret-policy.ts below.
  JWT_ACCESS_SECRET: z.string({ required_error: JWT_SECRET_REQUIRED }).min(1, JWT_SECRET_REQUIRED),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string({ required_error: JWT_SECRET_REQUIRED }).min(1, JWT_SECRET_REQUIRED),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  // Comma-separated JWT subjects allowed to act with role=admin. There is
  // no admin login yet, so the default (empty) refuses every admin token.
  ADMIN_SUBJECT_IDS: z.string().default(''),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // NymCard
  NYMCARD_API_KEY: z.string().optional(),
  NYMCARD_API_BASE: z.string().url().default('https://sandbox.nymcard.com/v1'),
  // nCore authenticates webhooks with Basic Auth plus an optional custom
  // header (documented protocol) — not an HMAC signature. TASK-007.
  NYMCARD_WEBHOOK_BASIC_USER: z.string().optional(),
  NYMCARD_WEBHOOK_BASIC_PASSWORD: z.string().optional(),
  NYMCARD_WEBHOOK_HEADER_NAME: z.string().optional(),
  NYMCARD_WEBHOOK_HEADER_VALUE: z.string().optional(),

  // MoneyHash
  MONEYHASH_API_KEY: z.string().optional(),
  MONEYHASH_API_BASE: z.string().url().default('https://sandbox.moneyhash.io/v1'),
  // Organisation webhook signing key (v3 signatures).
  MONEYHASH_WEBHOOK_SECRET: z.string().optional(),
  // Accepted age of the signed `t=` timestamp. Each delivery is signed
  // when created, so 300s absorbs network delay and clock skew while
  // keeping a captured request's replay window short.
  MONEYHASH_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(60).max(900).default(300),

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
  // How long a processed webhook delivery is remembered for duplicate
  // suppression when the provider protocol has no signed timestamp
  // (FlexxPay, biller, NymCard /transaction). 7 days comfortably
  // outlasts documented retry horizons (MoneyHash's is ~46h); the
  // FlexxPay and biller schedules are undocumented.
  WEBHOOK_REPLAY_TTL_SECONDS: z.coerce.number().int().min(3600).max(2592000).default(604800),

  // PII encryption (Bible §5.2 — AES-256-GCM app-layer + KMS envelope)
  // PII_DATA_KEY is the base64-encoded 32-byte data-encryption key. In
  // production this is the KMS-unwrapped DEK injected at boot; in
  // dev/test a static key is acceptable. Optional so unit tests that
  // never touch crypto still boot.
  PII_DATA_KEY: z.string().optional(),
  // TASK-018.2: base64-encoded 32-byte key for the HMAC-SHA256 email blind
  // index. CRYPTOGRAPHICALLY SEPARATE from PII_DATA_KEY (DEK) — never the
  // same key. In production this is a KMS-unwrapped key injected at boot;
  // in dev/test a static disposable key. Optional so code paths that never
  // compute a blind index still boot; the dual-write path fails closed when
  // it is required but absent.
  PII_BLIND_INDEX_KEY: z.string().optional(),
  // AWS KMS envelope unwrap (production DEK source). At boot the infra
  // layer calls KMS Decrypt on KMS_WRAPPED_DEK (a base64 KMS ciphertext
  // blob) and holds the plaintext 32-byte DEK in memory — KMS is never
  // on the hot path. In production these MUST be set or the app
  // fail-closes at boot; in development a MockKeyProvider fallback is
  // used only when they are absent.
  AWS_REGION: z.string().optional(),
  KMS_KEY_ID: z.string().optional(),
  KMS_WRAPPED_DEK: z.string().optional(),
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
  // Local connection defaults only. JWT secrets deliberately have none —
  // see jwt-secret-policy.ts.
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://flexpay:securepass@localhost:5432/flexpay?schema=public',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
});

if (!parsed.success) {
  console.error('Invalid environment variables', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed');
}

// Fail closed on weak, placeholder, publicly-known or shared JWT secrets
// and on out-of-bounds token lifetimes. Reports variable names and rules
// only — never the secret values.
const jwtIssues = jwtConfigIssues(parsed.data);
if (jwtIssues.length > 0) {
  console.error(
    'Invalid JWT configuration',
    jwtIssues.map((issue) => `${issue.variable} ${issue.message}`),
  );
  throw new Error('Environment validation failed');
}

// TASK-007: production never starts while an integration that can move
// or affect real money is in stub, sandbox or bypass mode, or while a
// webhook lacks strong credentials. Names and rules only — no values.
if (parsed.data.NODE_ENV === 'production') {
  const integrationIssues = productionIntegrationIssues(parsed.data);
  if (integrationIssues.length > 0) {
    console.error('Refusing to start in production: unsafe integration configuration', integrationIssues);
    throw new Error('Environment validation failed');
  }
}

export const env: Env = parsed.data;

function validatedTtlSeconds(raw: string): number {
  const seconds = parseTtlSeconds(raw);
  if (seconds === null) throw new Error('Environment validation failed');
  return seconds;
}

/** Token lifetimes in seconds, already bounds-checked above. */
export const jwtTtlSeconds = {
  access: validatedTtlSeconds(env.JWT_ACCESS_EXPIRY),
  refresh: validatedTtlSeconds(env.JWT_REFRESH_EXPIRY),
} as const;

/** JWT subjects permitted to use role=admin (empty → admin refused). */
export const adminSubjectIds: ReadonlySet<string> = new Set(
  env.ADMIN_SUBJECT_IDS.split(',')
    .map((id) => id.trim())
    .filter(Boolean),
);

export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

/**
 * Set when running the e2e suite — `NODE_ENV=test` but actually wired up
 * to real Redis + Postgres. Modules that no-op in test should still run.
 */
export const isE2E = process.env.E2E_MODE === '1' || process.env.E2E_MODE === 'true';
export const isUnitTest = isTest && !isE2E;
