import { createHash, createHmac, timingSafeEqual } from 'crypto';

// ============================================================
// Dashboard JWT signing + verification (TASK-006)
//
// No fallback secret in any environment. JWT_ACCESS_SECRET and
// JWT_REFRESH_SECRET must be set, strong and different, or every sign
// throws and every verify returns null (fail closed). Secrets are read on
// use, so `next build` needs none; the first auth request does. Errors
// name the variable and the rule — never the value.
//
// Generate each secret with:  openssl rand -hex 48
// ============================================================

export type TokenType = 'access' | 'refresh';

export interface VerifiedToken {
  userId: string;
  phone?: string;
  role?: string;
  type: TokenType;
  iss: string;
  aud: string;
  /** Milliseconds since epoch (dashboard convention). */
  iat: number;
  /** Milliseconds since epoch (dashboard convention). */
  exp: number;
}

const ISSUER = 'flexpay-dashboard';
const AUDIENCE = 'flexpay-dashboard';
const HEADER = { alg: 'HS256', typ: 'JWT' } as const;

const MIN_SECRET_LENGTH = 32;
const MIN_DISTINCT_CHARS = 10;

/**
 * SHA-256 of every JWT secret literal that has appeared in this public
 * repository (same list as the backend's jwt-secret-policy.ts). Publicly
 * known — never accepted as a signing key.
 */
export const KNOWN_COMPROMISED_SHA256: ReadonlySet<string> = new Set([
  'adb05c14f1258ffbbd64f864f04b0a5f65818f6963e71182dfea23cc49cd0373',
  'afcbeb5009a808a54abe3756edf809ae3be686487979d4e785f0ede8f7ce70fe',
  '39d2bc0d93e13ea64636721334ca50793e26814a0ea5ba1ff75dfde460807a16',
  '487765e5313a3413e838b80871576965511edcb8632c985e59649d86d79bcf49',
  'f104d41fa455d94c5029c7bdc067d1e0eca2f7ded22337ecc7114e9aea22e7eb',
  'a8db4785a0495c66a0bad7cfea921ae6084845eab64ec51fddbe0ccd518f5777',
  '71ace84ef3063c57f2c30cce9d8a26e968ccce1c24a8cb1b761fd7bb08a2489e',
  '552fcca9c8b1d4924565f6d874c3872381b93a3e9e443f02151c2d82400a45bd',
  'a108aa1bb24d362f5be6c952046d8ed01e6b2c50ceeac10277af180975ec1051',
  'fac907382f993b5eac0d2518cb6656b98ef8f36242c71ce6093ddd1fe9e69cde',
  '937de9d3b9dc865cf759b50ed2bb60901175dfaf6f358891adca05f360930d7c',
  '70ed8941d418259ce7f378bfdbc398609fc46466498d6f7ce5f3e720b5706825',
  '652f79d738b94b061dd7814ac6bfdd627589c9b5f75323d32c6f0c2dbb5ec909',
  'bd4b969ec202e3b67240d985aaa4262999c614e4e7a2ccb7fcd314853a8a1d7b',
  '9caf06bb4436cdbfa20af9121a626bc1093c4f54b31c0fa937957856135345b6',
]);

const PLACEHOLDER_PATTERN =
  /change[-_ ]?me|replace|placeholder|example|your[-_ ]|xxxx|do[-_ ]?not[-_ ]?use|dummy|sample|must[-_ ]?be|min[-_ ]?32/i;

export class JwtConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JwtConfigError';
  }
}

type SecretName = 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET';

/** Returns a rule violation for a secret value, or null when acceptable. */
export function secretProblem(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return 'is required and has no default';
  if (value.length < MIN_SECRET_LENGTH) return `must be at least ${MIN_SECRET_LENGTH} characters`;
  const hash = createHash('sha256').update(value, 'utf8').digest('hex');
  if (KNOWN_COMPROMISED_SHA256.has(hash)) return 'is a publicly known value from this repository';
  if (PLACEHOLDER_PATTERN.test(value)) return 'looks like a placeholder';
  if (new Set(value).size < MIN_DISTINCT_CHARS) return 'has too little character variety';
  return null;
}

function readSecret(name: SecretName): string {
  const value = process.env[name];
  const problem = secretProblem(value);
  if (problem) throw new JwtConfigError(`${name} ${problem}`);
  return value as string;
}

/** Both secrets, validated on every call (fail closed). */
export function getJwtSecrets(): { access: string; refresh: string } {
  const access = readSecret('JWT_ACCESS_SECRET');
  const refresh = readSecret('JWT_REFRESH_SECRET');
  if (access === refresh) {
    throw new JwtConfigError('JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET');
  }
  return { access, refresh };
}

let misconfigLogged = false;
function logMisconfigOnce(err: unknown): void {
  if (misconfigLogged) return;
  misconfigLogged = true;
  // Message carries the variable name and rule only — never the value.
  console.error(`JWT configuration rejected: ${(err as Error).message}`);
}

// ==================== ENCODING ====================

const encodeJson = (value: object) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const decodeJson = (part: string): unknown => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
const hmacSha256 = (input: string, secret: string) =>
  createHmac('sha256', secret).update(input).digest('base64url');

// ==================== SIGN / VERIFY ====================

/**
 * Sign a token. Access and refresh tokens use different secrets, so one
 * can never verify as the other.
 */
export function signToken(
  claims: { userId: string; phone?: string; role?: string; type: TokenType },
  ttlMs: number,
): string {
  const secrets = getJwtSecrets();
  const now = Date.now();
  const body = {
    userId: claims.userId,
    ...(claims.phone !== undefined ? { phone: claims.phone } : {}),
    ...(claims.role !== undefined ? { role: claims.role } : {}),
    type: claims.type,
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    exp: now + ttlMs,
  };
  const head = encodeJson(HEADER);
  const payload = encodeJson(body);
  const secret = claims.type === 'access' ? secrets.access : secrets.refresh;
  return `${head}.${payload}.${hmacSha256(`${head}.${payload}`, secret)}`;
}

/**
 * Verify a token. Returns null for anything that is not a genuine,
 * unexpired token from this dashboard — including tokens with any header
 * other than exactly {alg: HS256, typ: JWT}, and every token at all while
 * the secrets are misconfigured.
 */
export function verifySignedToken(token: string, expectedType?: TokenType): VerifiedToken | null {
  let secrets: { access: string; refresh: string };
  try {
    secrets = getJwtSecrets();
  } catch (err) {
    logMisconfigOnce(err);
    return null;
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [head, body, signature] = parts;

    const header = decodeJson(head) as Record<string, unknown>;
    if (
      !header ||
      header.alg !== HEADER.alg ||
      header.typ !== HEADER.typ ||
      Object.keys(header).length !== 2
    ) {
      return null;
    }

    const payload = decodeJson(body) as Partial<VerifiedToken>;
    if (payload?.type !== 'access' && payload?.type !== 'refresh') return null;
    if (expectedType && payload.type !== expectedType) return null;

    // The claimed type only selects which key to check against; a token
    // signed with the other key fails here.
    const secret = payload.type === 'access' ? secrets.access : secrets.refresh;
    const expected = Buffer.from(hmacSha256(`${head}.${body}`, secret));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    if (typeof payload.userId !== 'string' || payload.userId === '') return null;
    if (payload.iss !== ISSUER || payload.aud !== AUDIENCE) return null;
    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
    if (Date.now() >= payload.exp) return null;

    return payload as VerifiedToken;
  } catch {
    return null;
  }
}
