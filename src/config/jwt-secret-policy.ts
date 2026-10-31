import { createHash } from 'crypto';

/**
 * JWT secret + lifetime policy (TASK-006).
 *
 * There is NO fallback secret in any environment. Every JWT secret must
 * be explicitly configured and strong; a missing, short, placeholder,
 * low-variety, or publicly-known value aborts startup. Error messages
 * name the variable and the rule that failed — never the value.
 *
 * Generate a secret with:  openssl rand -hex 48
 */

export const MIN_JWT_SECRET_LENGTH = 32;
const MIN_DISTINCT_CHARS = 10;

/**
 * SHA-256 of every JWT secret literal that has appeared in this public
 * repository — code fallbacks, `.env.example` placeholders, CI values,
 * test fixtures and docs samples, in the working tree and in git history.
 * They are public knowledge and must never sign a token. Kept as hashes so
 * the values are not re-published here.
 */
export const KNOWN_COMPROMISED_JWT_SECRET_SHA256: ReadonlySet<string> = new Set([
  // backend src/config/env.ts runtime fallbacks (access, refresh)
  'adb05c14f1258ffbbd64f864f04b0a5f65818f6963e71182dfea23cc49cd0373',
  'afcbeb5009a808a54abe3756edf809ae3be686487979d4e785f0ede8f7ce70fe',
  // .env.example placeholders (access, refresh) — also baked into the Docker image
  '39d2bc0d93e13ea64636721334ca50793e26814a0ea5ba1ff75dfde460807a16',
  '487765e5313a3413e838b80871576965511edcb8632c985e59649d86d79bcf49',
  // dashboard src/lib/auth.ts runtime fallback
  'f104d41fa455d94c5029c7bdc067d1e0eca2f7ded22337ecc7114e9aea22e7eb',
  // .github/workflows/ci.yml dashboard job (access, refresh)
  'a8db4785a0495c66a0bad7cfea921ae6084845eab64ec51fddbe0ccd518f5777',
  '71ace84ef3063c57f2c30cce9d8a26e968ccce1c24a8cb1b761fd7bb08a2489e',
  // former static unit-test fixtures (access, refresh)
  '552fcca9c8b1d4924565f6d874c3872381b93a3e9e443f02151c2d82400a45bd',
  'a108aa1bb24d362f5be6c952046d8ed01e6b2c50ceeac10277af180975ec1051',
  // former static e2e fixtures (access, refresh)
  'fac907382f993b5eac0d2518cb6656b98ef8f36242c71ce6093ddd1fe9e69cde',
  '937de9d3b9dc865cf759b50ed2bb60901175dfaf6f358891adca05f360930d7c',
  // dashboard backend-overview page env sample (access, refresh)
  '70ed8941d418259ce7f378bfdbc398609fc46466498d6f7ce5f3e720b5706825',
  '652f79d738b94b061dd7814ac6bfdd627589c9b5f75323d32c6f0c2dbb5ec909',
  // git history: initial scaffold single-secret default + its test fixture
  'bd4b969ec202e3b67240d985aaa4262999c614e4e7a2ccb7fcd314853a8a1d7b',
  '9caf06bb4436cdbfa20af9121a626bc1093c4f54b31c0fa937957856135345b6',
]);

const PLACEHOLDER_PATTERN =
  /change[-_ ]?me|replace|placeholder|example|your[-_ ]|xxxx|do[-_ ]?not[-_ ]?use|dummy|sample|must[-_ ]?be|min[-_ ]?32/i;

export type JwtSecretProblem =
  | 'missing'
  | 'too_short'
  | 'known_compromised'
  | 'placeholder'
  | 'low_variety';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Generic shared-secret strength check (also used for webhook
 * credentials, TASK-007). Returns the first violation, or null.
 */
export function checkSecretStrength(
  value: string | undefined,
  minLength: number,
  compromised: ReadonlySet<string> = KNOWN_COMPROMISED_JWT_SECRET_SHA256,
): JwtSecretProblem | null {
  if (value === undefined || value.trim() === '') return 'missing';
  if (value.length < minLength) return 'too_short';
  if (compromised.has(sha256Hex(value))) return 'known_compromised';
  if (PLACEHOLDER_PATTERN.test(value)) return 'placeholder';
  if (new Set(value).size < MIN_DISTINCT_CHARS) return 'low_variety';
  return null;
}

/** Returns the first policy violation for a JWT secret, or null when acceptable. */
export function checkJwtSecret(
  value: string | undefined,
  compromised: ReadonlySet<string> = KNOWN_COMPROMISED_JWT_SECRET_SHA256,
): JwtSecretProblem | null {
  return checkSecretStrength(value, MIN_JWT_SECRET_LENGTH, compromised);
}

const PROBLEM_MESSAGES: Record<JwtSecretProblem, string> = {
  missing: 'is required and has no default — set it explicitly',
  too_short: `must be at least ${MIN_JWT_SECRET_LENGTH} characters`,
  known_compromised: 'is a publicly known value from this repository — generate a new one',
  placeholder: 'looks like a placeholder — generate a random value',
  low_variety: 'has too little character variety to be a random secret',
};

// ───────────────────────────────────────────────────────────────────
// Token lifetimes
// ───────────────────────────────────────────────────────────────────

const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 } as const;

/** Bounds (seconds) for configured lifetimes. Defaults are 15m / 7d. */
export const ACCESS_TTL_BOUNDS = { min: 60, max: 60 * 60 } as const;
export const REFRESH_TTL_BOUNDS = { min: 60 * 60, max: 30 * 86400 } as const;

/**
 * Parse `<integer><s|m|h|d>` into seconds. Anything else — including a
 * bare number, which jsonwebtoken would read as milliseconds — is null.
 */
export function parseTtlSeconds(raw: string | undefined): number | null {
  const match = /^(\d{1,7})([smhd])$/.exec((raw ?? '').trim());
  if (!match) return null;
  return Number(match[1]) * UNIT_SECONDS[match[2] as keyof typeof UNIT_SECONDS];
}

// ───────────────────────────────────────────────────────────────────
// Whole-config check used by env.ts at startup
// ───────────────────────────────────────────────────────────────────

export interface JwtConfigInput {
  JWT_ACCESS_SECRET?: string;
  JWT_REFRESH_SECRET?: string;
  JWT_ACCESS_EXPIRY?: string;
  JWT_REFRESH_EXPIRY?: string;
}

export interface JwtConfigIssue {
  variable: keyof JwtConfigInput;
  message: string;
}

export function jwtConfigIssues(cfg: JwtConfigInput): JwtConfigIssue[] {
  const issues: JwtConfigIssue[] = [];

  for (const variable of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const problem = checkJwtSecret(cfg[variable]);
    if (problem) issues.push({ variable, message: PROBLEM_MESSAGES[problem] });
  }

  if (
    cfg.JWT_ACCESS_SECRET &&
    cfg.JWT_REFRESH_SECRET &&
    cfg.JWT_ACCESS_SECRET === cfg.JWT_REFRESH_SECRET
  ) {
    issues.push({
      variable: 'JWT_REFRESH_SECRET',
      message: 'must differ from JWT_ACCESS_SECRET',
    });
  }

  const ttls = [
    ['JWT_ACCESS_EXPIRY', ACCESS_TTL_BOUNDS],
    ['JWT_REFRESH_EXPIRY', REFRESH_TTL_BOUNDS],
  ] as const;
  for (const [variable, bounds] of ttls) {
    const seconds = parseTtlSeconds(cfg[variable]);
    if (seconds === null) {
      issues.push({ variable, message: 'must look like 15m, 1h or 7d' });
    } else if (seconds < bounds.min || seconds > bounds.max) {
      issues.push({
        variable,
        message: `must be between ${bounds.min}s and ${bounds.max}s`,
      });
    }
  }

  return issues;
}
