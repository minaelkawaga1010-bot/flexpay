import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { env } from '@config/env';
import redisService from '@config/redis';
import { webhookCredentialIssues, type WebhookProvider } from '@config/integration-safety';
import { AppError } from '@shared/utils/errors';
import logger from '@shared/utils/logger';

/**
 * Inbound webhook authentication and delivery replay protection (TASK-007).
 *
 * Two layers — keep them distinct:
 *
 *  A. Authentication-level replay protection (this file). Proves the
 *     request comes from the provider using that provider's documented
 *     protocol, and refuses the SAME delivery twice:
 *       • MoneyHash — v3 HMAC-SHA256 over base64(raw body) + `t`, with
 *         `t` inside a tolerance window; each signature is single-use.
 *       • FlexxPay, biller — HMAC-SHA256 of the raw body. Their contract
 *         carries no timestamp, so an identical signed delivery is
 *         single-use for WEBHOOK_REPLAY_TTL_SECONDS.
 *       • NymCard — Basic Auth plus an optional custom header. The
 *         protocol has no signature or timestamp, so a captured request
 *         is indistinguishable from a fresh one; only TLS and credential
 *         secrecy protect it.
 *  B. Business-transaction idempotency (handlers and services). Unique
 *     idempotency keys and state checks guarantee one financial effect per
 *     business event, even when a provider legitimately re-delivers it as
 *     a new, freshly signed request.
 *
 * Fail closed: missing or weak credentials reject every request with 503
 * in every environment — there is no development or staging bypass.
 * Nothing here logs secrets, signatures, credentials or payloads.
 */

export type WebhookAuthFailure =
  | 'WEBHOOK_NOT_CONFIGURED'
  | 'INVALID_SIGNATURE'
  | 'INVALID_CREDENTIALS'
  | 'STALE_TIMESTAMP';

export interface WebhookAuthSuccess {
  ok: true;
  /** Identifies this exact delivery for replay suppression; null if the protocol cannot. */
  deliveryKey: string | null;
  deliveryTtlSeconds: number;
}

export type WebhookAuthResult =
  | WebhookAuthSuccess
  | { ok: false; status: 401 | 503; reason: WebhookAuthFailure };

const HEX_SHA256 = /^[0-9a-f]{64}$/i;
/** MoneyHash `t` may run ahead of our clock by at most this much. */
export const MONEYHASH_FUTURE_SKEW_SECONDS = 60;

const digest = (data: string | Buffer) => createHash('sha256').update(data).digest();

/** Constant-time comparison of arbitrary strings (fixed-length digests). */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

function hexEqual(providedHex: string, expectedHex: string): boolean {
  if (!HEX_SHA256.test(providedHex)) return false;
  return timingSafeEqual(
    Buffer.from(providedHex.toLowerCase(), 'hex'),
    Buffer.from(expectedHex, 'hex'),
  );
}

const reportedMisconfig = new Set<WebhookProvider>();

function notConfigured(provider: WebhookProvider, issues: string[]): WebhookAuthResult {
  if (!reportedMisconfig.has(provider)) {
    reportedMisconfig.add(provider);
    // Variable names and rules only.
    logger.error('Webhook refused: credentials not configured', { provider, issues });
  }
  return { ok: false, status: 503, reason: 'WEBHOOK_NOT_CONFIGURED' };
}

const rejected = (reason: WebhookAuthFailure): WebhookAuthResult => ({ ok: false, status: 401, reason });

// ───────────────────────────────────────────────────────────────────
// NymCard (nCore) — Basic Auth + optional custom header
// ───────────────────────────────────────────────────────────────────

export function verifyNymCardRequest(req: Request): WebhookAuthResult {
  const issues = webhookCredentialIssues('nymcard', env);
  if (issues.length > 0) return notConfigured('nymcard', issues);

  const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})\s*$/.exec(req.header('authorization') ?? '');
  const presented = match ? Buffer.from(match[1], 'base64').toString('utf8') : '';
  const credentialsOk = safeEqual(
    presented,
    `${env.NYMCARD_WEBHOOK_BASIC_USER}:${env.NYMCARD_WEBHOOK_BASIC_PASSWORD}`,
  );
  const headerOk = env.NYMCARD_WEBHOOK_HEADER_NAME
    ? safeEqual(req.header(env.NYMCARD_WEBHOOK_HEADER_NAME) ?? '', env.NYMCARD_WEBHOOK_HEADER_VALUE ?? '')
    : true;

  if (!credentialsOk || !headerOk) return rejected('INVALID_CREDENTIALS');
  return { ok: true, deliveryKey: null, deliveryTtlSeconds: env.WEBHOOK_REPLAY_TTL_SECONDS };
}

// ───────────────────────────────────────────────────────────────────
// MoneyHash — documented v3 signature: MoneyHash-Signature: t=…,v3=…
// ───────────────────────────────────────────────────────────────────

function signatureFields(header: string | undefined): Map<string, string> {
  const fields = new Map<string, string>();
  for (const part of (header ?? '').split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) fields.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return fields;
}

export function verifyMoneyHashRequest(req: Request): WebhookAuthResult {
  const issues = webhookCredentialIssues('moneyhash', env);
  if (issues.length > 0) return notConfigured('moneyhash', issues);

  const body = Buffer.isBuffer(req.body) ? req.body : null;
  const fields = signatureFields(req.header('MoneyHash-Signature'));
  const t = fields.get('t') ?? '';
  const v3 = fields.get('v3') ?? '';
  // Only v3 is accepted: v1/v2 sign re-serialised JSON, and v1 is keyed
  // by the account API key rather than the webhook signing key.
  if (!body || !/^\d{10}$/.test(t) || !HEX_SHA256.test(v3)) return rejected('INVALID_SIGNATURE');

  const expected = createHmac('sha256', env.MONEYHASH_WEBHOOK_SECRET as string)
    .update(Buffer.from(body.toString('base64') + t, 'utf8'))
    .digest('hex');
  if (!hexEqual(v3, expected)) return rejected('INVALID_SIGNATURE');

  const ageSeconds = Math.floor(Date.now() / 1000) - Number(t);
  if (ageSeconds > env.MONEYHASH_WEBHOOK_TOLERANCE_SECONDS || ageSeconds < -MONEYHASH_FUTURE_SKEW_SECONDS) {
    return rejected('STALE_TIMESTAMP');
  }
  return {
    ok: true,
    deliveryKey: `moneyhash:${v3.toLowerCase()}`,
    // A signature can only be accepted while `t` is inside the window.
    deliveryTtlSeconds: env.MONEYHASH_WEBHOOK_TOLERANCE_SECONDS + MONEYHASH_FUTURE_SKEW_SECONDS,
  };
}

// ───────────────────────────────────────────────────────────────────
// FlexxPay, biller — HMAC-SHA256 of the raw body, hex, optional sha256=
// (FlexPay's existing contract; no provider documentation was found)
// ───────────────────────────────────────────────────────────────────

const RAW_HMAC_HEADER = { flexxpay: 'x-flexxpay-signature', biller: 'x-biller-signature' } as const;

export function verifyRawBodyHmacRequest(req: Request, provider: 'flexxpay' | 'biller'): WebhookAuthResult {
  const issues = webhookCredentialIssues(provider, env);
  if (issues.length > 0) return notConfigured(provider, issues);

  const body = Buffer.isBuffer(req.body) ? req.body : null;
  const header = (req.header(RAW_HMAC_HEADER[provider]) ?? '').trim();
  const provided = header.startsWith('sha256=') ? header.slice(7) : header;
  if (!body || !HEX_SHA256.test(provided)) return rejected('INVALID_SIGNATURE');

  const secret = provider === 'flexxpay' ? env.FLEXXPAY_WEBHOOK_SECRET : env.BILLER_WEBHOOK_SECRET;
  const expected = createHmac('sha256', secret as string).update(body).digest('hex');
  if (!hexEqual(provided, expected)) return rejected('INVALID_SIGNATURE');

  return {
    ok: true,
    deliveryKey: `${provider}:${provided.toLowerCase()}`,
    deliveryTtlSeconds: env.WEBHOOK_REPLAY_TTL_SECONDS,
  };
}

// ───────────────────────────────────────────────────────────────────
// Rejection + delivery replay guard
// ───────────────────────────────────────────────────────────────────

/** Throw the HTTP error for a failed authentication (401, or 503 when unconfigured). */
export function assertWebhookAuthenticated(
  result: WebhookAuthResult,
  provider: WebhookProvider,
): asserts result is WebhookAuthSuccess {
  if (result.ok) return;
  logger.warn('Webhook rejected', { provider, reason: result.reason });
  if (result.status === 503) {
    throw new AppError(503, 'WEBHOOK_NOT_CONFIGURED', 'Webhook endpoint is not configured');
  }
  throw new AppError(401, 'UNAUTHORIZED', result.reason);
}

/** Delivery key for protocols without a signature: the exact raw body. */
export function rawBodyDeliveryKey(scope: string, body: unknown): string | null {
  return Buffer.isBuffer(body) ? `${scope}:${createHash('sha256').update(body).digest('hex')}` : null;
}

/** How long an in-flight claim blocks a duplicate; a crashed worker's claim lapses. */
export const DELIVERY_PROCESSING_LEASE_SECONDS = 120;

/**
 * Run `handle` at most once per authenticated delivery. The marker is
 * claimed atomically before processing (a short lease), set to "done"
 * once the delivery is acknowledged (2xx) and released on any error or
 * non-2xx response so a provider retry of a failed attempt is not
 * mistaken for a replay. A replay of an acknowledged delivery gets 200
 * without side effects; anything else that finds the marker gets 409 and
 * is retried by the provider — never silently dropped. Business
 * idempotency still guards every financial effect behind this.
 */
export async function processDeliveryOnce(
  res: Response,
  provider: WebhookProvider,
  delivery: { key: string | null; ttlSeconds: number },
  handle: () => Promise<void>,
): Promise<void> {
  if (!delivery.key) {
    await handle();
    return;
  }

  const marker = `webhook:delivery:${createHash('sha256').update(delivery.key).digest('hex')}`;
  const lease = Math.min(DELIVERY_PROCESSING_LEASE_SECONDS, delivery.ttlSeconds);
  if (!(await redisService.setIfAbsent(marker, 'processing', lease))) {
    const state = await redisService.get(marker);
    logger.warn('Webhook delivery replay suppressed', { provider, state: state ?? 'expired' });
    if (state === 'done') {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
    res.status(409).json({ error: 'DELIVERY_IN_PROGRESS' });
    return;
  }

  let acknowledged = false;
  try {
    await handle();
    acknowledged = res.statusCode >= 200 && res.statusCode < 300;
  } finally {
    // Recording the outcome must never mask the handler's own result.
    await (acknowledged
      ? redisService.set(marker, 'done', delivery.ttlSeconds)
      : redisService.del(marker)
    ).catch(() => logger.warn('Webhook delivery marker update failed', { provider }));
  }
}
