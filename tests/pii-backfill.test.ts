/**
 * TASK-018.3 — backfill preflight classification + consistency (unit).
 * Pure logic + real crypto (keys from tests/setup.ts). DB-level backfill
 * behaviour is in tests/e2e/pii-backfill.e2e.test.ts.
 */

import { classifyEmail, rowIsConsistent } from '@shared/security/pii-backfill';
import { protectEmployeePhone, protectEmployeeEmail } from '@shared/security/employee-pii';
import { decryptField } from '@shared/security/pii-crypto';

describe('classifyEmail (preflight)', () => {
  it('a clean email is normal', () => {
    expect(classifyEmail('user@example.com')).toMatchObject({ normalized: 'user@example.com', empty: false, caseOnly: false, whitespacePadded: false, malformed: false, suspiciousUnicode: false });
  });
  it('detects case-only normalisation (the TASK-018.2 conflict)', () => {
    expect(classifyEmail('Ahmed@Example.com')).toMatchObject({ normalized: 'ahmed@example.com', caseOnly: true });
  });
  it('detects leading/trailing whitespace', () => {
    expect(classifyEmail('  a@b.com ')).toMatchObject({ whitespacePadded: true, normalized: 'a@b.com' });
  });
  it('detects empty / malformed', () => {
    expect(classifyEmail('   ')).toMatchObject({ empty: true });
    expect(classifyEmail('not-an-email')).toMatchObject({ malformed: true });
    expect(classifyEmail('a@@b')).toMatchObject({ malformed: true });
  });
  it('flags suspicious unicode / control chars', () => {
    expect(classifyEmail('a\u0000@b.com').suspiciousUnicode).toBe(true);
  });
});

describe('rowIsConsistent (decrypt-and-compare)', () => {
  const base = { id: 'x', phone: '+971501234567', email: null as string | null, phoneEncrypted: null as string | null, emailEncrypted: null as string | null, emailHash: null as string | null };

  it('true for an all-NULL protected row (nothing to contradict)', () => {
    expect(rowIsConsistent({ ...base })).toBe(true);
  });
  it('true when phone+email protected columns match the plaintext', () => {
    const { phoneEncrypted } = protectEmployeePhone(base.phone);
    const email = 'User@X.com';
    const { emailEncrypted, emailHash } = protectEmployeeEmail(email);
    expect(rowIsConsistent({ ...base, email, phoneEncrypted, emailEncrypted, emailHash })).toBe(true);
  });
  it('false when phoneEncrypted decrypts to a different phone', () => {
    const { phoneEncrypted } = protectEmployeePhone('+971500000000');
    expect(rowIsConsistent({ ...base, phone: '+971509999999', phoneEncrypted })).toBe(false);
  });
  it('false when emailHash does not recompute', () => {
    const email = 'a@b.com';
    const { emailEncrypted } = protectEmployeeEmail(email);
    expect(rowIsConsistent({ ...base, email, emailEncrypted, emailHash: 'deadbeef'.repeat(8) })).toBe(false);
  });
  it('false when a corrupted ciphertext fails to decrypt', () => {
    const { phoneEncrypted } = protectEmployeePhone(base.phone);
    const corrupted = phoneEncrypted.slice(0, -4) + 'AAAA';
    expect(rowIsConsistent({ ...base, phoneEncrypted: corrupted })).toBe(false);
  });
  it('normalises phone before comparing', () => {
    const { phoneEncrypted } = protectEmployeePhone('+971 50 123 4567');
    expect(decrypted(phoneEncrypted)).toBe('+971501234567');
    expect(rowIsConsistent({ ...base, phone: '+971 50 123 4567', phoneEncrypted })).toBe(true);
  });
});

// tiny helper to make the normalise assertion explicit
function decrypted(e: string): string | null { return decryptField(e); }
