/**
 * A.7 PII crypto — unit tests.
 *
 * Covers:
 *   • AES-256-GCM field encrypt/decrypt round-trip (string + number)
 *   • Null passthrough for optional columns
 *   • Tamper detection (GCM auth-tag failure on a flipped byte)
 *   • Versioned-envelope rejection of malformed input
 *   • Emirates-ID SHA-256 hash determinism + hyphen-normalisation
 *   • EID masking shape
 *   • Fail-closed when the key is absent
 */

import {
  encryptField,
  decryptField,
  encryptNumber,
  decryptNumber,
  hashEmiratesId,
  hashIdentifier,
  maskEmiratesId,
  setKeyProvider,
  MissingKeyError,
  type KeyProvider,
} from '../src/shared/security/pii-crypto';

describe('PII field encryption', () => {
  it('round-trips a UTF-8 string through AES-256-GCM', () => {
    const plain = 'Mohammed Al Falasi — موظف';
    const envelope = encryptField(plain);
    expect(envelope).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(decryptField(envelope)).toBe(plain);
  });

  it('produces a different ciphertext each call (random IV) but same plaintext', () => {
    const a = encryptField('same input');
    const b = encryptField('same input');
    expect(a).not.toBe(b); // distinct IVs → distinct envelopes
    expect(decryptField(a)).toBe('same input');
    expect(decryptField(b)).toBe('same input');
  });

  it('round-trips a salary number', () => {
    const envelope = encryptNumber(7350.5);
    expect(decryptNumber(envelope)).toBe(7350.5);
  });

  it('passes null/undefined through unchanged (optional columns)', () => {
    expect(encryptField(null)).toBeNull();
    expect(encryptField(undefined)).toBeNull();
    expect(decryptField(null)).toBeNull();
    expect(encryptNumber(null)).toBeNull();
    expect(decryptNumber(null)).toBeNull();
  });

  it('detects tampering — a flipped ciphertext byte fails the GCM auth tag', () => {
    const envelope = encryptField('AED 9000 salary')!;
    const parts = envelope.split(':');
    // Flip a character in the ciphertext segment.
    const ct = parts[3];
    const flipped = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1);
    const tampered = [parts[0], parts[1], parts[2], flipped].join(':');
    expect(() => decryptField(tampered)).toThrow();
  });

  it('rejects a malformed or unknown-version envelope', () => {
    expect(() => decryptField('garbage')).toThrow(/malformed/);
    expect(() => decryptField('v2:a:b:c')).toThrow(/version/);
  });
});

describe('Emirates ID hashing', () => {
  it('is deterministic and hyphen-insensitive', () => {
    const hyphenated = hashEmiratesId('784-1990-1234567-1');
    const bare = hashEmiratesId('784199012345671');
    expect(hyphenated).toBe(bare);
    expect(hyphenated).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different EIDs hash differently', () => {
    expect(hashEmiratesId('784199012345671')).not.toBe(hashEmiratesId('784199012345672'));
  });

  it('hashIdentifier is plain SHA-256', () => {
    expect(hashIdentifier('+971500000000')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Emirates ID masking', () => {
  it('keeps prefix + last two significant digits + check digit', () => {
    expect(maskEmiratesId('784-1990-1234567-1')).toBe('784-****-*****67-1');
  });

  it('masks unknown-shape inputs conservatively', () => {
    expect(maskEmiratesId('12345')).toBe('***45');
  });
});

describe('key provider fail-closed', () => {
  afterEach(() => {
    // Restore the env-backed provider for subsequent suites by
    // re-binding a fresh env provider via a known-good key.
    const key = Buffer.alloc(32, 7);
    setKeyProvider({ getKey: () => key });
  });

  it('throws MissingKeyError when the bound provider has no key', () => {
    setKeyProvider({
      getKey: () => {
        throw new MissingKeyError();
      },
    } as KeyProvider);
    expect(() => encryptField('x')).toThrow(MissingKeyError);
  });
});
