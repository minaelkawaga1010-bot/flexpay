import {
  randomBytes,
  createHmac,
  timingSafeEqual,
  pbkdf2,
} from 'crypto';
import { db } from './db';

// ==================== TYPES ====================

export interface TokenPayload {
  userId: string;
  phone: string;
  role: string;
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
}

export interface StoredRefreshToken {
  userId: string;
  expiresAt: number;
}

interface OTPEntry {
  otp: string;
  expiresAt: number;
  attempts: number;
  phone: string;
}

// ==================== CONSTANTS ====================

const JWT_SECRET = process.env.JWT_SECRET || 'flexpay-dev-secret-key-do-not-use-in-prod';
const JWT_ACCESS_EXPIRY = 15 * 60 * 1000; // 15 minutes
const JWT_REFRESH_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days
const OTP_TTL = 5 * 60 * 1000; // 5 minutes
const OTP_MAX_ATTEMPTS = 3;
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LENGTH = 64;
const HASH_PREFIX = 'fp$';

// ==================== IN-MEMORY STORES ====================
// Replaceable with Redis in production

const otpStore = new Map<string, OTPEntry>();
const refreshStore = new Map<string, StoredRefreshToken>();
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

// ==================== BASE64URL ENCODING ====================

function base64urlEncode(data: string): string {
  return Buffer.from(data, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(str: string): string {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf-8');
}

// ==================== HMAC SIGNATURE ====================

async function createHmacSignature(payload: string, secret: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hmac = createHmac('sha256', secret);
    hmac.on('error', reject);
    hmac.on('data', (data: Buffer) => {
      resolve(data.toString('base64url'));
    });
    hmac.end(payload);
  });
}

// ==================== JWT TOKEN FUNCTIONS ====================

export async function generateAccessToken(payload: {
  userId: string;
  phone: string;
  role: string;
}): Promise<string> {
  const now = Date.now();
  const tokenPayload = {
    userId: payload.userId,
    phone: payload.phone,
    role: payload.role,
    type: 'access' as const,
    iat: now,
    exp: now + JWT_ACCESS_EXPIRY,
  };

  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64urlEncode(JSON.stringify(tokenPayload));
  const signature = await createHmacSignature(`${header}.${body}`, JWT_SECRET);

  return `${header}.${body}.${signature}`;
}

export async function generateRefreshToken(payload: { userId: string }): Promise<string> {
  const now = Date.now();
  const tokenPayload = {
    userId: payload.userId,
    type: 'refresh' as const,
    iat: now,
    exp: now + JWT_REFRESH_EXPIRY,
  };

  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64urlEncode(JSON.stringify(tokenPayload));
  const signature = await createHmacSignature(`${header}.${body}`, JWT_SECRET);

  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;

    const expectedSig = createHmac('sha256', JWT_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');

    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null;
    }

    const payload = JSON.parse(base64urlDecode(body)) as TokenPayload;

    if (Date.now() > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// ==================== OTP ====================

export function generateOTP(): string {
  const bytes = randomBytes(3);
  const value = bytes.readUIntBE(0, 3);
  return (value % 1000000).toString().padStart(6, '0');
}

export function storeOTP(phone: string, otp: string, purpose: string): void {
  const key = `${phone}:${purpose}`;
  otpStore.set(key, {
    otp,
    expiresAt: Date.now() + OTP_TTL,
    attempts: 0,
    phone,
  });
}

export function verifyOTP(phone: string, otp: string, purpose: string): { valid: boolean; reason?: string } {
  const key = `${phone}:${purpose}`;
  const entry = otpStore.get(key);

  if (!entry) {
    return { valid: false, reason: 'No OTP found. Please request a new one.' };
  }

  if (Date.now() > entry.expiresAt) {
    otpStore.delete(key);
    return { valid: false, reason: 'OTP has expired. Please request a new one.' };
  }

  entry.attempts += 1;

  if (entry.attempts > OTP_MAX_ATTEMPTS) {
    otpStore.delete(key);
    return { valid: false, reason: 'Too many attempts. Please request a new OTP.' };
  }

  if (entry.otp !== otp) {
    return { valid: false, reason: 'Invalid OTP. Please try again.' };
  }

  otpStore.delete(key);
  return { valid: true };
}

// ==================== REFRESH TOKEN STORE ====================

export function storeRefreshToken(token: string, userId: string): void {
  const payload = verifyToken(token);
  if (!payload) return;
  refreshStore.set(token, { userId, expiresAt: payload.exp });
}

export function getRefreshToken(token: string): StoredRefreshToken | undefined {
  return refreshStore.get(token);
}

export function removeRefreshToken(token: string): void {
  refreshStore.delete(token);
}

export function rotateRefreshToken(oldToken: string, newToken: string): void {
  const entry = refreshStore.get(oldToken);
  if (entry) {
    refreshStore.delete(oldToken);
    const payload = verifyToken(newToken);
    if (payload) {
      refreshStore.set(newToken, { userId: entry.userId, expiresAt: payload.exp });
    }
  }
}

// ==================== RATE LIMITING ====================

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

export function checkRateLimit(phone: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(phone);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(phone, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  entry.count += 1;
  return { allowed: true };
}

// ==================== PASSWORD HASHING (PBKDF2) ====================

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);

  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, 'sha512', (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      const hash = derivedKey.toString('hex');
      resolve(`${HASH_PREFIX}${salt.toString('hex')}$${hash}`);
    });
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash.startsWith(HASH_PREFIX)) return false;

  const parts = hash.slice(HASH_PREFIX.length).split('$');
  if (parts.length !== 2) return false;

  const [saltHex, storedHash] = parts;
  const salt = Buffer.from(saltHex, 'hex');

  return new Promise((resolve) => {
    pbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, 'sha512', (err, derivedKey) => {
      if (err) {
        resolve(false);
        return;
      }
      const computedHash = derivedKey.toString('hex');
      resolve(timingSafeEqual(Buffer.from(computedHash), Buffer.from(storedHash)));
    });
  });
}

// ==================== AUDIT LOGGING ====================

export async function createAuditLog(
  userId: string,
  action: string,
  resource: string,
  details?: Record<string, unknown>,
  ipAddress?: string,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId,
        action,
        resource,
        details: details ? JSON.stringify(details) : null,
        ipAddress: ipAddress || null,
      },
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
}

// ==================== PHONE VALIDATION ====================

export function validatePhone(phone: string): boolean {
  // Must start with + and be 10-15 characters total
  const phoneRegex = /^\+[1-9]\d{9,14}$/;
  return phoneRegex.test(phone);
}

// ==================== TOKEN EXTRACTION FROM REQUEST ====================

export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  return parts[1];
}

// ==================== CLEANUP (run periodically in prod) ====================

export function cleanupExpiredEntries(): void {
  const now = Date.now();

  // Clean expired OTPs
  for (const [key, entry] of otpStore.entries()) {
    if (now > entry.expiresAt) {
      otpStore.delete(key);
    }
  }

  // Clean expired refresh tokens
  for (const [key, entry] of refreshStore.entries()) {
    if (now > entry.expiresAt) {
      refreshStore.delete(key);
    }
  }

  // Clean expired rate limits
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}

// Run cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredEntries, 5 * 60 * 1000);
}
