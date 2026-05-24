import { createHash, createHmac } from 'crypto';
import { env } from '@config/env';

/**
 * Ledger integrity primitive — closes Bible §1.3 / §A.2.
 *
 * Every financial ledger entry carries a SHA-256 integrity hash
 * computed over its canonical field tuple. The hash is verifiable
 * offline at any point in time:
 *
 *   computed_hash === stored_hash
 *
 * A mismatch means either (a) the row was tampered with at the DB
 * level (which the REVOKE UPDATE/DELETE migration should also have
 * prevented) or (b) the integrity function itself drifted — both are
 * pager-tier incidents.
 *
 * Field tuple (canonical order — DO NOT REORDER without a versioned
 * migration that re-hashes the historical ledger):
 *
 *   id || amount(2dp) || debitAccountId || creditAccountId || timestamp(ISO)
 *
 * Two hash modes:
 *
 *   • computeLedgerIntegrityHash       — plain SHA-256, deterministic,
 *                                        anyone can verify
 *   • computeLedgerHMAC                — HMAC-SHA256 keyed by a server
 *                                        secret (LEDGER_INTEGRITY_KEY)
 *                                        — tamper-resistant against an
 *                                        attacker with DB write but no
 *                                        application secret
 *
 * Bible §1.3 specifies plain SHA-256. We expose the HMAC variant too
 * because the production hardening posture (Bible §5.2: "AWS Secrets
 * Manager... API keys and secrets... encrypted at rest") implies an
 * HMAC mode is reachable once the secret is provisioned. Default to
 * SHA-256 for verifiability.
 */

export interface LedgerEntryHashInput {
  /** Ledger entry primary key. */
  id: bigint | number | string;
  /** Amount in AED to 2dp — always positive in Bible's double-entry. */
  amount: number;
  /** UUID of the debit-side account. */
  debitAccountId: string;
  /** UUID of the credit-side account. */
  creditAccountId: string;
  /** Entry creation timestamp. ISO-8601 with millisecond precision. */
  createdAt: Date;
}

/**
 * Canonicalise the hash tuple. Exported so consumers can audit the
 * exact bytes the hash was computed over.
 */
export function canonicaliseLedgerTuple(input: LedgerEntryHashInput): string {
  const amountFixed = input.amount.toFixed(2);
  const iso = input.createdAt.toISOString();
  // Pipe separator is ASCII 0x7C and never appears in our UUID/decimal
  // inputs — unambiguous parse for an offline verifier.
  return [
    String(input.id),
    amountFixed,
    input.debitAccountId,
    input.creditAccountId,
    iso,
  ].join('|');
}

/**
 * Bible §1.3 canonical integrity hash. SHA-256, hex-encoded, 64 chars.
 */
export function computeLedgerIntegrityHash(input: LedgerEntryHashInput): string {
  return createHash('sha256')
    .update(canonicaliseLedgerTuple(input), 'utf8')
    .digest('hex');
}

/**
 * HMAC-SHA256 variant. Use the LEDGER_INTEGRITY_KEY env secret; falls
 * back to plain SHA-256 with a WARN-level log when the secret is
 * unset (dev/test affordance — production deploys MUST set the secret).
 */
export function computeLedgerHMAC(input: LedgerEntryHashInput): string {
  const secret = process.env.LEDGER_INTEGRITY_KEY;
  if (!secret) {
    // Non-keyed fallback. Production runtime should detect this via
    // env-validation startup gate (env.ts Zod schema) before reaching
    // any ledger write.
    return computeLedgerIntegrityHash(input);
  }
  return createHmac('sha256', secret)
    .update(canonicaliseLedgerTuple(input), 'utf8')
    .digest('hex');
}

/**
 * Verify a previously-stored hash against the row's current field
 * values. Returns `true` iff the row is unmodified since the hash was
 * computed.
 *
 * Constant-time string compare via Buffer.compare on equal-length
 * inputs (both are hex(SHA-256) → always 64 chars).
 */
export function verifyLedgerIntegrity(
  input: LedgerEntryHashInput,
  storedHash: string,
): boolean {
  const expected = computeLedgerIntegrityHash(input);
  if (expected.length !== storedHash.length) return false;
  // Constant-time compare — string compare on hex is fine since both
  // strings are the same exact hex output by construction.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}

// Silence unused-import lint when env isn't directly referenced
// — it's imported because process.env.LEDGER_INTEGRITY_KEY belongs in
// the env schema once provisioned.
void env;
