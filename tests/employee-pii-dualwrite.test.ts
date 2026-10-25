/**
 * TASK-018.2 — Employee PII dual-write crypto helpers (unit, adversarial).
 *
 * Real AES-256-GCM + real HMAC-SHA256 (keys from tests/setup.ts — disposable,
 * distinct). Asserts: authenticated encryption round-trips, random nonces, a
 * keyed blind index separate from the DEK, deterministic normalisation,
 * null/blank/Unicode handling, and FAIL-CLOSED on a missing/invalid key (no
 * plaintext fallback). These are actual cryptographic checks, not mocks.
 */

import { decryptField, setKeyProvider, MissingKeyError } from '@shared/security/pii-crypto';
import {
  protectEmployeePhone,
  protectEmployeeEmail,
  blindIndexEmail,
  normalizePhone,
  normalizeEmail,
  setBlindIndexKeyProvider,
  MissingBlindIndexKeyError,
} from '@shared/security/employee-pii';

const realDekProvider = { getKey: () => Buffer.from(process.env.PII_DATA_KEY as string, 'base64') };
const realBlindProvider = { getKey: () => Buffer.from(process.env.PII_BLIND_INDEX_KEY as string, 'base64') };

afterEach(() => {
  // Restore the real providers after any fail-closed override.
  setKeyProvider(realDekProvider);
  setBlindIndexKeyProvider(realBlindProvider);
});

describe('normalisation', () => {
  it('phone → E.164 digits only', () => {
    expect(normalizePhone('+971 50 123 4567')).toBe('+971501234567');
    expect(normalizePhone('+971501234567')).toBe('+971501234567');
  });
  it('email → trim + lowercase', () => {
    expect(normalizeEmail('  Foo.Bar@Example.COM ')).toBe('foo.bar@example.com');
  });
});

describe('protectEmployeePhone', () => {
  it('encrypts E.164(phone) and round-trips under the DEK', () => {
    const { phoneEncrypted } = protectEmployeePhone('+971 50 123 4567');
    expect(phoneEncrypted).toMatch(/^v1:/); // versioned envelope
    expect(decryptField(phoneEncrypted)).toBe('+971501234567');
  });
  it('uses a fresh random nonce each call (distinct ciphertext, same plaintext)', () => {
    const a = protectEmployeePhone('+971501234567').phoneEncrypted;
    const b = protectEmployeePhone('+971501234567').phoneEncrypted;
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe(decryptField(b));
  });
  it('fails closed when the DEK is missing (no plaintext leak)', () => {
    setKeyProvider({ getKey: () => { throw new MissingKeyError(); } });
    expect(() => protectEmployeePhone('+971501234567')).toThrow(MissingKeyError);
  });
});

describe('protectEmployeeEmail', () => {
  it('encrypts + blind-indexes a normalised email', () => {
    const { emailEncrypted, emailHash } = protectEmployeeEmail('  Foo@Example.com ');
    expect(decryptField(emailEncrypted)).toBe('foo@example.com');
    expect(emailHash).toBe(blindIndexEmail('foo@example.com'));
    expect(emailHash).toMatch(/^[0-9a-f]{64}$/); // HMAC-SHA256 hex
  });
  it('null / undefined / blank email → both columns NULL', () => {
    for (const v of [null, undefined, '', '   ']) {
      expect(protectEmployeeEmail(v)).toEqual({ emailEncrypted: null, emailHash: null });
    }
  });
  it('case-variant emails share a blind index (case-insensitive identity)', () => {
    expect(protectEmployeeEmail('USER@x.com').emailHash).toBe(protectEmployeeEmail('user@x.com').emailHash);
  });
  it('a Unicode email round-trips and hashes deterministically', () => {
    const { emailEncrypted, emailHash } = protectEmployeeEmail('tëst.üser@exämple.com');
    expect(decryptField(emailEncrypted)).toBe('tëst.üser@exämple.com');
    expect(emailHash).toBe(blindIndexEmail('tëst.üser@exämple.com'));
  });
  it('fails closed when the blind-index key is missing (no plaintext-only output)', () => {
    setBlindIndexKeyProvider({ getKey: () => { throw new MissingBlindIndexKeyError(); } });
    expect(() => protectEmployeeEmail('foo@x.com')).toThrow(MissingBlindIndexKeyError);
  });
});

describe('blind index keying (separate from DEK)', () => {
  it('is deterministic for the same key and value', () => {
    expect(blindIndexEmail('a@b.com')).toBe(blindIndexEmail('a@b.com'));
  });
  it('different blind-index keys yield distinct indexes for the same email', () => {
    const withReal = blindIndexEmail('a@b.com');
    setBlindIndexKeyProvider({ getKey: () => Buffer.alloc(32, 123) });
    const withOther = blindIndexEmail('a@b.com');
    expect(withOther).not.toBe(withReal);
  });
  it('the blind-index key is NOT the DEK (distinct configured keys)', () => {
    expect(process.env.PII_BLIND_INDEX_KEY).toBeDefined();
    expect(process.env.PII_BLIND_INDEX_KEY).not.toBe(process.env.PII_DATA_KEY);
  });
});

describe('tamper detection (authenticated encryption)', () => {
  it('a flipped ciphertext byte fails the GCM auth tag on decrypt', () => {
    const env = protectEmployeePhone('+971501234567').phoneEncrypted;
    const parts = env.split(':');
    const ct = Buffer.from(parts[3], 'base64url');
    ct[0] ^= 0xff;
    const tampered = [parts[0], parts[1], parts[2], ct.toString('base64url')].join(':');
    expect(() => decryptField(tampered)).toThrow();
  });
});
