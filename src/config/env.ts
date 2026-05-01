import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    if (process.env.NODE_ENV === 'test') return fallback ?? '';
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '4000'), 10),
  databaseUrl: required('DATABASE_URL', 'postgresql://flexpay:flexpay@localhost:5432/flexpay'),
  redisUrl: optional('REDIS_URL', 'redis://localhost:6379'),
  jwt: {
    secret: required('JWT_SECRET', 'dev-secret-change-me'),
    accessTtl: optional('JWT_ACCESS_TTL', '15m'),
    refreshTtl: optional('JWT_REFRESH_TTL', '7d'),
  },
  twilio: {
    accountSid: optional('TWILIO_ACCOUNT_SID'),
    authToken: optional('TWILIO_AUTH_TOKEN'),
    fromNumber: optional('TWILIO_FROM_NUMBER', '+15555550100'),
  },
  nymcard: {
    baseUrl: optional('NYMCARD_BASE_URL', 'https://sandbox.nymcard.com/api'),
    apiKey: optional('NYMCARD_API_KEY'),
    webhookSecret: optional('NYMCARD_WEBHOOK_SECRET'),
  },
  moneyhash: {
    baseUrl: optional('MONEYHASH_BASE_URL', 'https://sandbox.moneyhash.io/api'),
    apiKey: optional('MONEYHASH_API_KEY'),
  },
  flexxpay: {
    baseUrl: optional('FLEXXPAY_BASE_URL', 'https://sandbox.flexxpay.com/api'),
    apiKey: optional('FLEXXPAY_API_KEY'),
  },
  firebase: {
    credentialsPath: optional('GOOGLE_APPLICATION_CREDENTIALS'),
  },
} as const;

export type AppEnv = typeof env;
