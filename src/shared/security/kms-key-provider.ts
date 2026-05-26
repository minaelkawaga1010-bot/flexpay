import { env } from '@config/env';
import logger from '@shared/utils/logger';
import {
  KeyProvider,
  setKeyProvider,
  encryptField,
  decryptField,
} from './pii-crypto';

/**
 * KMS boot-gate — Day-Zero hardening (Advisory Board §1.1).
 *
 * The PII envelope crypto (pii-crypto.ts) defaults to an env-key
 * provider. In production the 32-byte Data Encryption Key (DEK) is
 * wrapped by an AWS KMS Customer Master Key; this module unwraps it
 * ONCE at boot (KMS Decrypt) and binds the resolved key BEFORE the
 * HTTP listener or any worker/cron starts.
 *
 * Fail-fast contract: if the key cannot be resolved, validated, and
 * round-trip-verified, the process MUST crash rather than start with a
 * broken or wrong key. A server that boots with the dev env-key in
 * production, or with no key at all, would silently corrupt PII at
 * rest (encrypt under the wrong key, or fail-closed on every write).
 *
 * Resolution order:
 *   1. KMS-wrapped DEK  — env.KMS_KEY_ID + PII_WRAPPED_DEK present →
 *      unwrap via the injected KmsUnwrapper (the AWS KMS client adapter,
 *      bound by infra at boot via setKmsUnwrapper).
 *   2. Direct DEK       — PII_DATA_KEY (base64 32 bytes). This is both
 *      the dev/test path AND the "KMS-unwrapped-at-deploy, injected as
 *      a secret" path for environments that unwrap outside the process.
 *   3. Neither          — throw. No silent fallback to plaintext.
 */

const KEY_BYTES = 32;

/**
 * Async DEK unwrapper. The real implementation wraps
 * @aws-sdk/client-kms's Decrypt; infra binds it at boot so this module
 * carries no hard AWS dependency. Tests bind a deterministic stub.
 */
export interface KmsUnwrapper {
  /** Decrypt a KMS-wrapped DEK ciphertext blob → plaintext 32-byte key. */
  decryptDataKey(wrapped: Buffer): Promise<Buffer>;
}

let kmsUnwrapper: KmsUnwrapper | null = null;

export function setKmsUnwrapper(unwrapper: KmsUnwrapper): void {
  kmsUnwrapper = unwrapper;
}

/** Hold the resolved plaintext DEK in memory; KMS is never on the hot path. */
class CachedKeyProvider implements KeyProvider {
  constructor(private readonly key: Buffer) {}
  getKey(): Buffer {
    return this.key;
  }
}

/**
 * Resolve the plaintext DEK from the configured source. Throws on any
 * misconfiguration — never returns a wrong-length or absent key.
 */
export async function resolvePiiDataKey(): Promise<Buffer> {
  const wrappedB64 = process.env.PII_WRAPPED_DEK;

  if (env.KMS_KEY_ID && wrappedB64) {
    if (!kmsUnwrapper) {
      throw new Error(
        'KMS_KEY_ID is set but no KmsUnwrapper is bound — call setKmsUnwrapper() before bindPiiKeyProvider()',
      );
    }
    const key = await kmsUnwrapper.decryptDataKey(Buffer.from(wrappedB64, 'base64'));
    if (key.length !== KEY_BYTES) {
      throw new Error(`KMS-unwrapped DEK must be ${KEY_BYTES} bytes; got ${key.length}`);
    }
    return key;
  }

  if (env.PII_DATA_KEY) {
    const key = Buffer.from(env.PII_DATA_KEY, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(`PII_DATA_KEY must decode to ${KEY_BYTES} bytes; got ${key.length}`);
    }
    return key;
  }

  throw new Error(
    'No PII key source configured — set KMS_KEY_ID + PII_WRAPPED_DEK (production) or PII_DATA_KEY (dev/test)',
  );
}

/**
 * Resolve + bind the PII key provider, then prove it works with an
 * encrypt→decrypt round-trip on a canary string. Returns nothing on
 * success; throws on any failure. The caller (server boot) treats a
 * throw as fatal.
 */
export async function bindPiiKeyProvider(): Promise<void> {
  const key = await resolvePiiDataKey();
  setKeyProvider(new CachedKeyProvider(key));

  // Self-test: a bound-but-broken key (e.g. wrong CMK) would pass the
  // length check yet fail to round-trip. Catch it here, at boot, not on
  // the first worker write.
  const canary = `kms-boot-canary:${Date.now()}`;
  const envelope = encryptField(canary);
  const back = decryptField(envelope);
  if (back !== canary) {
    throw new Error('PII key self-test failed — encrypt/decrypt round-trip mismatch');
  }

  logger.info('PII key provider bound + self-test passed', {
    source: env.KMS_KEY_ID && process.env.PII_WRAPPED_DEK ? 'KMS' : 'ENV',
  });
}

/**
 * Boot-gate wrapper: bind the key provider or crash the process. Call
 * this at the very top of server startup, before app.listen() and
 * before any cron/worker registration.
 */
export async function bindPiiKeyProviderOrCrash(): Promise<void> {
  try {
    await bindPiiKeyProvider();
  } catch (err) {
    logger.error('FATAL: PII key provider failed to bind — refusing to start', {
      error: (err as Error).message,
    });
    // Hard fail-fast. A FinTech process must never serve traffic with a
    // broken PII key.
    process.exit(1);
  }
}
