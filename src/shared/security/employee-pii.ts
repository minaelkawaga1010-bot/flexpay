import { createHmac } from 'crypto';
import { env } from '@config/env';
import { encryptField } from './pii-crypto';

/**
 * Employee PII dual-write helpers (TASK-018.2).
 *
 * Transitional dual-write: when a NEW Employee phone/email value is written,
 * we populate the protected columns (AES-256-GCM envelope + HMAC blind index)
 * ATOMICALLY in the same Prisma statement as the plaintext column. The
 * plaintext columns remain populated and authoritative for reads, lookups and
 * uniqueness in this phase — a later, separately-approved cutover (TASK-018.4)
 * moves reads/lookups onto the protected columns, and a still-later phase
 * drops the plaintext.
 *
 * Fail-closed: if a required key is missing/invalid, encryptField and
 * blindIndexEmail THROW before the Prisma write is built, so the whole
 * create/update aborts — no plaintext-only row is ever written on a key
 * failure. These helpers encrypt ONLY phone/email (never fullName/salary).
 *
 * The blind-index key is CRYPTOGRAPHICALLY SEPARATE from the AES DEK: the
 * envelope encryption keys off PII_DATA_KEY (via pii-crypto), while the blind
 * index keys off PII_BLIND_INDEX_KEY here. phoneHash is NOT touched — its
 * existing (unused) semantics are preserved.
 */

const BLIND_INDEX_KEY_BYTES = 32;

export class MissingBlindIndexKeyError extends Error {
  constructor() {
    super('PII_BLIND_INDEX_KEY not configured — refusing to compute a PII blind index');
    this.name = 'MissingBlindIndexKeyError';
  }
}

export interface BlindIndexKeyProvider {
  /** Returns the HMAC key. Implementations should cache. */
  getKey(): Buffer;
}

/**
 * Default provider: reads a base64 32-byte key from env.PII_BLIND_INDEX_KEY.
 * Fails closed if unset or the wrong length. Production binds a KMS-backed
 * provider at boot (same shape as pii-crypto's AwsKmsKeyProvider); that
 * wiring is NOT activated here.
 */
class EnvBlindIndexKeyProvider implements BlindIndexKeyProvider {
  private cached: Buffer | null = null;
  getKey(): Buffer {
    if (this.cached) return this.cached;
    if (!env.PII_BLIND_INDEX_KEY) throw new MissingBlindIndexKeyError();
    const key = Buffer.from(env.PII_BLIND_INDEX_KEY, 'base64');
    if (key.length !== BLIND_INDEX_KEY_BYTES) {
      throw new Error(`PII_BLIND_INDEX_KEY must decode to exactly ${BLIND_INDEX_KEY_BYTES} bytes; got ${key.length}`);
    }
    this.cached = key;
    return key;
  }
}

let blindIndexKeyProvider: BlindIndexKeyProvider = new EnvBlindIndexKeyProvider();

/** Bind a KMS-backed (or test) blind-index key provider. */
export function setBlindIndexKeyProvider(provider: BlindIndexKeyProvider): void {
  blindIndexKeyProvider = provider;
}

// ───────────────────────────────────────────────────────────────────
// Deterministic, versioned normalisation (applied on write and, later,
// on lookup — symmetry is what matters).
// ───────────────────────────────────────────────────────────────────

/** E.164 phone: keep a leading '+' and digits only. Input is already validated. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return `+${digits}`;
}

/**
 * Email identity normalisation: trim + lowercase. Mirrors the app's
 * emailSchema (.toLowerCase().trim()) and the standard case-insensitive
 * email identity. NOTE: the plaintext `email` column's UNIQUE is
 * case-sensitive in this transitional phase, so case-variant emails share
 * an emailHash while staying distinct in the plaintext column. Reconciling
 * that is a TASK-018.4 cutover decision; no current behaviour changes
 * because emailHash is not yet used for lookup/uniqueness.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** HMAC-SHA256 blind index of a normalised email, hex. Keyed separately from the DEK. */
export function blindIndexEmail(email: string): string {
  const normalised = normalizeEmail(email);
  return createHmac('sha256', blindIndexKeyProvider.getKey()).update(normalised, 'utf8').digest('hex');
}

// ───────────────────────────────────────────────────────────────────
// Dual-write column builders — spread into the Prisma create/update data.
// ───────────────────────────────────────────────────────────────────

/** Protected column for a phone write: the AES-GCM envelope of E.164(phone). */
export function protectEmployeePhone(phone: string): { phoneEncrypted: string } {
  return { phoneEncrypted: encryptField(normalizePhone(phone))! };
}

/**
 * Protected columns for an email write. A null/undefined/blank email yields
 * NULLs for both protected columns (consistent nullable handling).
 */
export function protectEmployeeEmail(
  email: string | null | undefined,
): { emailEncrypted: string | null; emailHash: string | null } {
  if (email == null || email.trim() === '') {
    return { emailEncrypted: null, emailHash: null };
  }
  const normalised = normalizeEmail(email);
  return { emailEncrypted: encryptField(normalised)!, emailHash: blindIndexEmail(normalised) };
}
