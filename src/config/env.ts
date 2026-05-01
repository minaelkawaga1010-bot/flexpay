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

  // Firebase
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),

  // Security
  BCRYPT_SALT_ROUNDS: z.coerce.number().default(10),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  WEBHOOK_SIGNATURE_HEADER: z.string().default('x-nymcard-signature'),

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
