import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { env } from '@config/env';
import logger from '@shared/utils/logger';

/**
 * PII crypto — Bible §5.2 (AES-256-GCM at rest + KMS key management +
 * SHA-256 Emirates-ID hashing). Closes Review A.7.
 *
 * Two surfaces:
 *
 *   1. Field encryption (reversible) — worker names, salary amounts.
 *      AES-256-GCM via Node crypto. Authenticated: a tampered
 *      ciphertext fails the GCM auth tag on decrypt rather than
 *      silently returning garbage.
 *
 *   2. Emirates-ID hashing (one-way) — SHA-256. Per Bible §5.2 the
 *      Emirates ID is "stored as hash... only equality checks, no
 *      decryption possible". We never store the plaintext EID.
 *
 * Key management — KMS envelope pattern:
 *
 *   The 32-byte Data Encryption Key (DEK) is wrapped by an AWS KMS
 *   Customer Master Key. At boot, the infra layer unwraps the DEK once
 *   (KMS Decrypt) and injects it via `setKeyProvider`. All field crypto
 *   then uses the in-memory DEK — KMS is never on the hot path. This is
 *   the "Application-level decryption only (not raw DB access)" model
 *   the Bible mandates for salary.
 *
 *   In dev/test, the DEK comes from env.PII_DATA_KEY (base64). A
 *   missing key fails closed on the first encrypt/decrypt — never
 *   silently stores plaintext.
 *
 * Ciphertext envelope format (versioned for key rotation):
 *
 *   v1:<base64url iv>:<base64url authTag>:<base64url ciphertext>
 *
 * The version prefix lets a future DEK rotation decrypt-old / encrypt-
 * new without ambiguity.
 */

const ENVELOPE_VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // AES-256
const AUTH_TAG_BYTES = 16;

// ───────────────────────────────────────────────────────────────────
// Key provider — pluggable so prod binds KMS, dev/test uses env.
// ───────────────────────────────────────────────────────────────────

export interface KeyProvider {
  /** Returns the 32-byte DEK. Implementations should cache. */
  getKey(): Buffer;
}

export class MissingKeyError extends Error {
  constructor() {
    super('PII_DATA_KEY not configured — refusing to encrypt/decrypt PII');
    this.name = 'MissingKeyError';
  }
}

/**
 * Default provider: reads a base64 32-byte key from env.PII_DATA_KEY.
 * Fails closed if unset or wrong length.
 */
class EnvKeyProvider implements KeyProvider {
  private cached: Buffer | null = null;
  getKey(): Buffer {
    if (this.cached) return this.cached;
    if (!env.PII_DATA_KEY) throw new MissingKeyError();
    const key = Buffer.from(env.PII_DATA_KEY, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `PII_DATA_KEY must decode to exactly ${KEY_BYTES} bytes; got ${key.length}`,
      );
    }
    this.cached = key;
    return key;
  }
}

let keyProvider: KeyProvider = new EnvKeyProvider();

/**
 * Bind a KMS-backed key provider at boot. The infra layer unwraps the
 * DEK via KMS Decrypt and passes a provider whose getKey() returns the
 * plaintext DEK held in memory.
 */
export function setKeyProvider(provider: KeyProvider): void {
  keyProvider = provider;
  logger.info('PII key provider bound', { provider: provider.constructor.name });
}

// ───────────────────────────────────────────────────────────────────
// Field encryption
// ───────────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext field. Returns the versioned envelope string
 * suitable for storage in a Postgres TEXT column. Returns null for
 * null/undefined input so optional columns round-trip cleanly.
 */
export function encryptField(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined) return null;
  const key = keyProvider.getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    ENVELOPE_VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

/**
 * Decrypt a versioned envelope back to plaintext. Throws on a tampered
 * ciphertext (GCM auth-tag failure) or a malformed envelope. Returns
 * null for null input.
 */
export function decryptField(envelope: string | null | undefined): string | null {
  if (envelope === null || envelope === undefined) return null;
  const parts = envelope.split(':');
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error('malformed PII envelope or unknown version');
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64url');
  const authTag = Buffer.from(tagB64, 'base64url');
  const ciphertext = Buffer.from(ctB64, 'base64url');
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new Error('PII envelope iv/authTag length mismatch');
  }
  const key = keyProvider.getKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  // .final() throws "Unsupported state or unable to authenticate data"
  // if the auth tag doesn't verify — i.e. on tamper.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Encrypt a numeric field (salary) by stringifying. Decryption side
 * parses back to number. Keeps the storage envelope identical to the
 * string path so one column type (TEXT) serves both.
 */
export function encryptNumber(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return encryptField(value.toString());
}

export function decryptNumber(envelope: string | null | undefined): number | null {
  const s = decryptField(envelope);
  if (s === null) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error('decrypted salary is not a finite number');
  return n;
}

// ───────────────────────────────────────────────────────────────────
// Emirates ID hashing (one-way, equality-only)
// ───────────────────────────────────────────────────────────────────

/**
 * SHA-256 hash of a normalised Emirates ID. Bible §5.2: stored as a
 * non-reversible hash; only equality checks.
 *
 * Normalisation strips the hyphens so 784-1990-1234567-1 and
 * 784199012345671 hash identically — the canonical form is the
 * 15-digit string. An optional pepper (env.EMIRATES_ID_HASH_PEPPER)
 * hardens against rainbow tables; leave unset for cross-system
 * comparability (the Bible's default).
 */
export function hashEmiratesId(emiratesId: string): string {
  const normalised = emiratesId.replace(/[^0-9]/g, '');
  const pepper = env.EMIRATES_ID_HASH_PEPPER ?? '';
  return createHash('sha256').update(`${pepper}${normalised}`, 'utf8').digest('hex');
}

/**
 * Generic SHA-256 hash for other equality-only identifiers (phone
 * hash for OTP keys, etc). Bible §1.5 uses phone_hash for the otp
 * Redis key.
 */
export function hashIdentifier(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Mask an Emirates ID for display: keep the 784 prefix and the final
 * two significant digits, asterisk the rest. Stored in
 * KycDocument.emiratesIdNumber as the only on-row representation of
 * the EID — the full plaintext never persists.
 *
 *   784-1990-1234567-1  →  784-****-*****67-1
 */
export function maskEmiratesId(emiratesId: string): string {
  const digits = emiratesId.replace(/[^0-9]/g, '');
  if (digits.length !== 15) {
    // Unknown shape — mask everything but the last 2 to be safe.
    const tail = digits.slice(-2);
    return `${'*'.repeat(Math.max(0, digits.length - 2))}${tail}`;
  }
  const prefix = digits.slice(0, 3); // 784
  const last2 = digits.slice(12, 14);
  const check = digits.slice(14); // single check digit
  return `${prefix}-****-*****${last2}-${check}`;
}
