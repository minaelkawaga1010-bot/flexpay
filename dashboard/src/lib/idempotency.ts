import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of every entry stored in the idempotency cache. */
interface CachedResponse {
  /** JSON-serialisable response body. */
  body: unknown;
  /** HTTP status code returned by the original handler. */
  status: number;
  /** Custom headers to forward when replaying. */
  headers: Record<string, string>;
  /** Unix timestamp (ms) of when the entry was created. */
  createdAt: number;
}

/** Return type of {@link handleIdempotency}. */
export interface IdempotencyCheckResult {
  /** A replayed `NextResponse` if a matching key was found, otherwise `null`. */
  cached: NextResponse | null;
  /** The validated idempotency key extracted from the request, or `null`. */
  key: string | null;
}

/** Result of idempotency-key validation. */
type ValidationResult = { valid: true; key: string } | { valid: false };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum time (ms) a cached response is kept alive. */
const TTL_MS = 60 * 60 * 1000; // 1 hour

/** Interval (ms) between automatic expiry clean-ups. */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Header name expected on incoming requests. */
const HEADER_KEY = 'Idempotency-Key';

/** Header added when a cached response is replayed. */
const HEADER_REPLAYED = 'X-Idempotency-Replayed';

/** Header added when a fresh response is cached. */
const HEADER_CREATED = 'X-Idempotency-Created';

/** Methods that are eligible for idempotency protection. */
const IDEMPOTENT_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Canonical UUID v4 regular expression.
 * Matches 8-4-4-4-12 hex groups, with the 3rd group starting with `4` and
 * the 4th group starting with `8`, `9`, `a`, or `b`.
 */
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Minimum length for non-UUID idempotency keys. */
const MIN_KEY_LENGTH = 16;

// ---------------------------------------------------------------------------
// In-memory store (Map-based — can be swapped for Redis)
// ---------------------------------------------------------------------------

const store = new Map<string, CachedResponse>();

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate an idempotency key.
 *
 * A key is considered valid when **one** of the following holds:
 * - It is a syntactically valid **UUID v4** string.
 * - It is a plain string of **at least** `MIN_KEY_LENGTH` characters.
 *
 * @param key - The raw header value to validate.
 * @returns A discriminated union indicating whether the key is valid.
 */
function validateKey(key: string | null): ValidationResult {
  if (!key) return { valid: false };

  const trimmed = key.trim();

  if (UUID_V4_RE.test(trimmed)) return { valid: true, key: trimmed };
  if (trimmed.length >= MIN_KEY_LENGTH) return { valid: true, key: trimmed };

  return { valid: false };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Remove all entries from the store whose `createdAt` timestamp is older than
 * the configured TTL.
 *
 * This is called automatically every 5 minutes (see {@link startCleanupTimer})
 * but can also be invoked manually when needed.
 */
export function cleanupExpiredEntries(): void {
  const now = Date.now();
  const cutoff = now - TTL_MS;

  for (const [key, entry] of store) {
    if (entry.createdAt < cutoff) {
      store.delete(key);
    }
  }
}

/**
 * Start the periodic clean-up timer.
 *
 * Uses `setInterval` with {@link CLEANUP_INTERVAL_MS}.  In serverless
 * environments the timer will be reset on each cold-start, which is
 * acceptable because entries are also lazily checked on access.
 *
 * @returns The `NodeJS.Timeout` handle (useful for testing / graceful
 *          shutdown).
 */
function startCleanupTimer(): NodeJS.Timeout {
  return setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL_MS);
}

// Start the timer when the module is first imported.
const _cleanupTimer = startCleanupTimer();

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Extract a serialisable subset of `NextResponse` headers.
 *
 * `NextResponse.headers` is a `Headers` instance which cannot be stored
 * directly in JSON; this helper copies key/value pairs into a plain object.
 */
function extractHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    // Skip hop-by-hop / idempotency-internal headers
    if (
      name.toLowerCase() === 'set-cookie' ||
      name === HEADER_REPLAYED ||
      name === HEADER_CREATED
    ) {
      return;
    }
    result[name] = value;
  });
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether an incoming request carries a valid, previously-seen
 * idempotency key.
 *
 * - If the key is **missing or invalid**, returns `{ cached: null, key: null }`
 *   and the route handler should proceed normally (no caching will happen).
 * - If the key is **valid and already cached**, returns the stored response
 *   (with `X-Idempotency-Replayed: true`) so the route handler can short-
 *   circuit.
 * - If the key is **valid but new**, returns `{ cached: null, key }` and the
 *   route handler should process the request, then call
 *   {@link storeIdempotentResponse} with the key.
 *
 * @param request - The incoming `NextRequest`.
 * @returns An {@link IdempotencyCheckResult}.
 *
 * @example
 * ```ts
 * import { handleIdempotency, storeIdempotentResponse } from '@/lib/idempotency';
 *
 * export async function POST(request: NextRequest) {
 *   const { cached, key } = handleIdempotency(request);
 *   if (cached) return cached;
 *
 *   // ... normal handler logic ...
 *   const response = NextResponse.json({ ok: true });
 *
 *   if (key) storeIdempotentResponse(key, response);
 *   return response;
 * }
 * ```
 */
export function handleIdempotency(request: NextRequest): IdempotencyCheckResult {
  const rawKey = request.headers.get(HEADER_KEY);
  const validation = validateKey(rawKey);

  if (!validation.valid) {
    return { cached: null, key: null };
  }

  const { key } = validation;
  const entry = store.get(key);

  // Lazy TTL check — discard stale entries on read.
  if (entry && Date.now() - entry.createdAt < TTL_MS) {
    const replayed = NextResponse.json(entry.body, {
      status: entry.status,
    });

    // Restore original headers
    for (const [name, value] of Object.entries(entry.headers)) {
      replayed.headers.set(name, value);
    }

    replayed.headers.set(HEADER_REPLAYED, 'true');

    return { cached: replayed, key };
  }

  // Either no entry or expired — remove if it existed
  if (entry) {
    store.delete(key);
  }

  return { cached: null, key };
}

/**
 * Cache a response for a given idempotency key.
 *
 * The response body is cloned into the in-memory store so it can be replayed
 * on subsequent requests carrying the same key.  The `X-Idempotency-Created`
 * header is set on the **original** response as a signal to the caller.
 *
 * @param key   - A previously-validated idempotency key (from
 *                {@link handleIdempotency}).
 * @param response - The `NextResponse` returned by the route handler.
 *
 * @example
 * ```ts
 * const { cached, key } = handleIdempotency(request);
 * if (cached) return cached;
 *
 * const result = await doExpensiveWork();
 * const response = NextResponse.json(result, { status: 201 });
 *
 * if (key) storeIdempotentResponse(key, response);
 * return response;
 * ```
 */
export function storeIdempotentResponse(
  key: string,
  response: NextResponse,
): void {
  // Read the body before caching — NextResponse.json() bodies are readable only once.
  // We use response.clone() to avoid consuming the original body stream.
  const cloned = response.clone();

  cloned
    .json()
    .then((body: unknown) => {
      store.set(key, {
        body,
        status: response.status,
        headers: extractHeaders(response.headers),
        createdAt: Date.now(),
      });

      // Mark the original response so callers know it was cached
      response.headers.set(HEADER_CREATED, 'true');
    })
    .catch(() => {
      // If we cannot parse the body (e.g. non-JSON response), silently skip caching.
      // The response is still returned to the client — we just don't store it.
    });
}

/**
 * Higher-order function that wraps any route handler with automatic idempotency
 * support.
 *
 * The wrapper **only activates** for mutating HTTP methods (`POST`, `PUT`,
 * `PATCH`).  For `GET`, `DELETE`, and all other methods the handler is invoked
 * directly with no idempotency overhead.
 *
 * @param handler - An async function that receives a `NextRequest` and returns
 *                  a `NextResponse`.
 * @returns A wrapped handler with the same signature.
 *
 * @example
 * ```ts
 * import { withIdempotency } from '@/lib/idempotency';
 * import { NextRequest, NextResponse } from 'next/server';
 *
 * async function createOrder(req: NextRequest) {
 *   const body = await req.json();
 *   const order = await db.order.create({ data: body });
 *   return NextResponse.json(order, { status: 201 });
 * }
 *
 * export const POST = withIdempotency(createOrder);
 * ```
 */
export function withIdempotency(
  handler: (req: NextRequest) => Promise<NextResponse>,
): (req: NextRequest) => Promise<NextResponse> {
  return async function idempotentHandler(
    request: NextRequest,
  ): Promise<NextResponse> {
    // Only apply idempotency to mutating methods
    const method = request.method.toUpperCase();
    if (!IDEMPOTENT_METHODS.has(method)) {
      return handler(request);
    }

    const { cached, key } = handleIdempotency(request);

    // Short-circuit: return the cached response immediately
    if (cached) return cached;

    // No cache hit — run the original handler
    const response = await handler(request);

    // Cache the response if we have a valid key
    if (key) {
      storeIdempotentResponse(key, response);
    }

    return response;
  };
}
