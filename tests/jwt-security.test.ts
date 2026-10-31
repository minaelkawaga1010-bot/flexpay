/**
 * TASK-006 — adversarial JWT tests.
 *
 * Proves that forged tokens, wrong signatures, wrong algorithms, missing
 * or weak secrets, expired tokens and unauthorised admin claims cannot
 * get past authentication, and that no publicly known secret literal is
 * left in the repository. Secrets here are generated per run; no known
 * value is reproduced.
 */
jest.mock('@config/prisma', () => ({
  prisma: {
    employee: { findFirst: jest.fn(), findUnique: jest.fn() },
    company: { findFirst: jest.fn(), findUnique: jest.fn() },
  },
}));
jest.mock('@config/redis', () => ({ __esModule: true, default: {} }));

import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { createHash, createHmac, randomBytes } from 'crypto';
import { prisma } from '@config/prisma';
import { env } from '@config/env';
import {
  checkJwtSecret,
  jwtConfigIssues,
  parseTtlSeconds,
  KNOWN_COMPROMISED_JWT_SECRET_SHA256,
} from '@config/jwt-secret-policy';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '@shared/utils/jwt';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { authService } from '@modules/auth/auth.service';

const mockedPrisma = prisma as unknown as {
  employee: { findFirst: jest.Mock; findUnique: jest.Mock };
  company: { findFirst: jest.Mock; findUnique: jest.Mock };
};

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

const randomSecret = () => randomBytes(48).toString('hex');
const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const nowSec = () => Math.floor(Date.now() / 1000);
const b64url = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');

const claims = (overrides: Record<string, unknown> = {}) => ({
  userId: 'emp-1',
  role: 'employee',
  tokenUse: 'access',
  iss: 'flexpay',
  aud: 'flexpay-users',
  iat: nowSec(),
  exp: nowSec() + 600,
  ...overrides,
});

/** Hand-rolled token so headers and signatures can be anything an attacker sends. */
function craft(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  sign: (input: string) => string,
): string {
  const head = b64url(header);
  const body = b64url(payload);
  return `${head}.${body}.${sign(`${head}.${body}`)}`;
}
const hmac = (algo: 'sha256' | 'sha384' | 'sha512', secret: string) => (input: string) =>
  createHmac(algo, secret).update(input).digest('base64url');

const withAccessSecret = hmac('sha256', env.JWT_ACCESS_SECRET);

interface MockRes {
  statusCode: number;
  body: unknown;
  status(code: number): MockRes;
  json(body: unknown): MockRes;
}
function mockRes(): MockRes {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

type Middleware = (req: AuthRequest, res: never, next: () => void) => Promise<void>;
async function runAuth(mw: Middleware, bearer?: string) {
  const req = {
    headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
    path: '/protected',
  } as unknown as AuthRequest;
  const res = mockRes();
  let nextCalled = false;
  await mw(req, res as never, () => {
    nextCalled = true;
  });
  return { req, res, nextCalled };
}

/**
 * Load a fresh env.ts with overrides (undefined = variable absent);
 * restores process.env afterwards.
 */
function loadEnvWith(overrides: Record<string, string | undefined>) {
  const original: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    original[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    let mod: typeof import('@config/env') | undefined;
    jest.isolateModules(() => {
      // Hermetic: a developer's local .env must not refill a removed variable.
      jest.doMock('dotenv/config', () => ({}));
      mod = require('@config/env');
    });
    return mod!;
  } finally {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ───────────────────────────────────────────────────────────────────
// 1. Secret policy
// ───────────────────────────────────────────────────────────────────

describe('JWT secret policy', () => {
  it('rejects missing, empty and whitespace-only secrets', () => {
    expect(checkJwtSecret(undefined)).toBe('missing');
    expect(checkJwtSecret('')).toBe('missing');
    expect(checkJwtSecret('   ')).toBe('missing');
  });

  it('rejects secrets shorter than 32 characters', () => {
    expect(checkJwtSecret(randomSecret().slice(0, 31))).toBe('too_short');
  });

  it('rejects placeholder-looking secrets', () => {
    expect(checkJwtSecret(`change-me-${randomSecret()}`)).toBe('placeholder');
    expect(checkJwtSecret(`your-jwt-key-${randomSecret()}`)).toBe('placeholder');
    expect(checkJwtSecret(`replace-with-real-${randomSecret()}`)).toBe('placeholder');
  });

  it('rejects low-variety secrets', () => {
    expect(checkJwtSecret('a'.repeat(64))).toBe('low_variety');
    expect(checkJwtSecret('0123'.repeat(16))).toBe('low_variety');
  });

  it('rejects any secret whose hash is on the compromised list', () => {
    const leaked = randomSecret();
    expect(checkJwtSecret(leaked, new Set([sha256(leaked)]))).toBe('known_compromised');
  });

  it('ships a well-formed compromised list covering every repository literal', () => {
    expect(KNOWN_COMPROMISED_JWT_SECRET_SHA256.size).toBe(15);
    for (const h of KNOWN_COMPROMISED_JWT_SECRET_SHA256) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts a freshly generated random secret', () => {
    expect(checkJwtSecret(randomSecret())).toBeNull();
    expect(checkJwtSecret(randomBytes(48).toString('base64'))).toBeNull();
  });

  it('requires access and refresh secrets to differ', () => {
    const shared = randomSecret();
    const issues = jwtConfigIssues({
      JWT_ACCESS_SECRET: shared,
      JWT_REFRESH_SECRET: shared,
      JWT_ACCESS_EXPIRY: '15m',
      JWT_REFRESH_EXPIRY: '7d',
    });
    expect(issues.map((i) => i.variable)).toContain('JWT_REFRESH_SECRET');
  });

  it('bounds token lifetimes and rejects ambiguous formats', () => {
    expect(parseTtlSeconds('15m')).toBe(900);
    expect(parseTtlSeconds('7d')).toBe(604800);
    expect(parseTtlSeconds('15')).toBeNull(); // jsonwebtoken would read this as 15 ms
    expect(parseTtlSeconds('1 day')).toBeNull();
    expect(parseTtlSeconds('-5m')).toBeNull();

    const base = { JWT_ACCESS_SECRET: randomSecret(), JWT_REFRESH_SECRET: randomSecret() };
    const vars = (access: string, refresh: string) =>
      jwtConfigIssues({ ...base, JWT_ACCESS_EXPIRY: access, JWT_REFRESH_EXPIRY: refresh }).map(
        (i) => i.variable,
      );
    expect(vars('15m', '7d')).toEqual([]);
    expect(vars('2h', '7d')).toEqual(['JWT_ACCESS_EXPIRY']);
    expect(vars('30s', '7d')).toEqual(['JWT_ACCESS_EXPIRY']);
    expect(vars('15m', '60d')).toEqual(['JWT_REFRESH_EXPIRY']);
  });
});

// ───────────────────────────────────────────────────────────────────
// 2. Startup fails closed (env.ts)
// ───────────────────────────────────────────────────────────────────

describe('startup refuses unsafe JWT configuration', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  const loggedText = () => JSON.stringify(errorSpy.mock.calls);

  it('fails when a secret is absent — there is no fallback', () => {
    expect(() => loadEnvWith({ JWT_ACCESS_SECRET: undefined })).toThrow('Environment validation failed');
    expect(() => loadEnvWith({ JWT_REFRESH_SECRET: undefined })).toThrow('Environment validation failed');
    expect(() =>
      loadEnvWith({ JWT_ACCESS_SECRET: undefined, JWT_REFRESH_SECRET: undefined }),
    ).toThrow('Environment validation failed');
  });

  it('fails when a secret is empty (e.g. the blank line copied from .env.example)', () => {
    expect(() => loadEnvWith({ JWT_ACCESS_SECRET: '' })).toThrow('Environment validation failed');
    expect(() => loadEnvWith({ JWT_REFRESH_SECRET: '' })).toThrow('Environment validation failed');
  });

  it('fails when access and refresh share a secret', () => {
    const shared = randomSecret();
    expect(() => loadEnvWith({ JWT_ACCESS_SECRET: shared, JWT_REFRESH_SECRET: shared })).toThrow(
      'Environment validation failed',
    );
    expect(loggedText()).not.toContain(shared);
  });

  it('fails on short or placeholder secrets without logging the value', () => {
    const shortSecret = randomSecret().slice(0, 20);
    expect(() => loadEnvWith({ JWT_REFRESH_SECRET: shortSecret })).toThrow();
    const placeholder = `change-me-${randomSecret()}`;
    expect(() => loadEnvWith({ JWT_ACCESS_SECRET: placeholder })).toThrow();
    expect(loggedText()).not.toContain(shortSecret);
    expect(loggedText()).not.toContain(placeholder);
    expect(loggedText()).toContain('JWT_ACCESS_SECRET');
  });

  it('fails on an out-of-bounds access lifetime', () => {
    expect(() => loadEnvWith({ JWT_ACCESS_EXPIRY: '30d' })).toThrow('Environment validation failed');
  });

  it('boots with strong distinct secrets and parses the admin allowlist', () => {
    const mod = loadEnvWith({
      JWT_ACCESS_SECRET: randomSecret(),
      JWT_REFRESH_SECRET: randomSecret(),
      ADMIN_SUBJECT_IDS: ' ops-1, ops-2 ,, ',
    });
    expect([...mod.adminSubjectIds]).toEqual(['ops-1', 'ops-2']);
    expect(mod.jwtTtlSeconds).toEqual({ access: 900, refresh: 604800 });
  });

  it('refuses admin to everyone when no allowlist is configured', () => {
    const mod = loadEnvWith({ ADMIN_SUBJECT_IDS: '' });
    expect(mod.adminSubjectIds.size).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────
// 3. Token verification
// ───────────────────────────────────────────────────────────────────

describe('access-token verification', () => {
  it('round-trips a genuine token with pinned algorithm and claims', () => {
    const token = generateAccessToken({ userId: 'emp-1', role: 'employee', companyId: 'co-1' });
    expect(verifyAccessToken(token)).toEqual({ userId: 'emp-1', role: 'employee', companyId: 'co-1' });

    const decoded = jwt.decode(token, { complete: true }) as jwt.Jwt & { payload: jwt.JwtPayload };
    expect(decoded.header.alg).toBe('HS256');
    expect(decoded.payload.tokenUse).toBe('access');
    expect(decoded.payload.iss).toBe('flexpay');
    expect(decoded.payload.aud).toBe('flexpay-users');
    expect(decoded.payload.exp! - decoded.payload.iat!).toBe(900);
  });

  it('never copies caller-supplied extra claims into the token', () => {
    const token = generateAccessToken({
      userId: 'emp-1',
      role: 'employee',
      isAdmin: true,
      exp: 1,
    } as never);
    const payload = jwt.decode(token) as jwt.JwtPayload;
    expect(payload.isAdmin).toBeUndefined();
    expect(payload.exp).toBeGreaterThan(nowSec());
    expect(verifyAccessToken(token).role).toBe('employee');
  });

  it('rejects a token signed with any other secret', () => {
    const forged = craft({ alg: 'HS256', typ: 'JWT' }, claims({ role: 'admin' }), hmac('sha256', randomSecret()));
    expect(() => verifyAccessToken(forged)).toThrow('INVALID_ACCESS_TOKEN');
  });

  it('rejects a genuine token whose payload was tampered with', () => {
    const [head, , sig] = generateAccessToken({ userId: 'emp-1', role: 'employee' }).split('.');
    const tampered = `${head}.${b64url(claims({ role: 'admin' }))}.${sig}`;
    expect(() => verifyAccessToken(tampered)).toThrow('INVALID_ACCESS_TOKEN');
  });

  it('rejects alg=none', () => {
    const none = craft({ alg: 'none', typ: 'JWT' }, claims({ role: 'admin' }), () => '');
    expect(() => verifyAccessToken(none)).toThrow('INVALID_ACCESS_TOKEN');
  });

  it('rejects HS384 / HS512 even when signed with the real access secret', () => {
    const hs384 = craft({ alg: 'HS384', typ: 'JWT' }, claims(), hmac('sha384', env.JWT_ACCESS_SECRET));
    const hs512 = craft({ alg: 'HS512', typ: 'JWT' }, claims(), hmac('sha512', env.JWT_ACCESS_SECRET));
    expect(() => verifyAccessToken(hs384)).toThrow('INVALID_ACCESS_TOKEN');
    expect(() => verifyAccessToken(hs512)).toThrow('INVALID_ACCESS_TOKEN');
  });

  it('rejects RS256/HS256 key-confusion tokens', () => {
    const confused = craft({ alg: 'RS256', typ: 'JWT' }, claims({ role: 'admin' }), withAccessSecret);
    expect(() => verifyAccessToken(confused)).toThrow('INVALID_ACCESS_TOKEN');
  });

  it('reports expiry only for genuinely signed tokens', () => {
    const expired = craft({ alg: 'HS256', typ: 'JWT' }, claims({ iat: nowSec() - 1200, exp: nowSec() - 600 }), withAccessSecret);
    expect(() => verifyAccessToken(expired)).toThrow('ACCESS_TOKEN_EXPIRED');

    const expiredForged = craft(
      { alg: 'HS256', typ: 'JWT' },
      claims({ iat: nowSec() - 1200, exp: nowSec() - 600 }),
      hmac('sha256', randomSecret()),
    );
    expect(() => verifyAccessToken(expiredForged)).toThrow('INVALID_ACCESS_TOKEN');
  });

  it('rejects a correctly signed token that carries no exp', () => {
    const { exp: _exp, ...noExp } = claims();
    const token = craft({ alg: 'HS256', typ: 'JWT' }, noExp, withAccessSecret);
    expect(() => verifyAccessToken(token)).toThrow('INVALID_ACCESS_TOKEN');
  });

  it('rejects the wrong issuer or audience', () => {
    const badIss = craft({ alg: 'HS256', typ: 'JWT' }, claims({ iss: 'attacker' }), withAccessSecret);
    const badAud = craft({ alg: 'HS256', typ: 'JWT' }, claims({ aud: 'other-service' }), withAccessSecret);
    expect(() => verifyAccessToken(badIss)).toThrow('INVALID_ACCESS_TOKEN');
    expect(() => verifyAccessToken(badAud)).toThrow('INVALID_ACCESS_TOKEN');
  });

  it('rejects legacy tokens without tokenUse, unknown roles and missing subjects', () => {
    const { tokenUse: _t, ...legacy } = claims();
    for (const payload of [legacy, claims({ role: 'superadmin' }), claims({ userId: '' }), claims({ userId: undefined })]) {
      const token = craft({ alg: 'HS256', typ: 'JWT' }, payload, withAccessSecret);
      expect(() => verifyAccessToken(token)).toThrow('INVALID_ACCESS_TOKEN');
    }
  });

  it('keeps access and refresh tokens non-interchangeable', () => {
    const access = generateAccessToken({ userId: 'emp-1', role: 'employee' });
    const refresh = generateRefreshToken({ userId: 'emp-1', role: 'employee' });
    expect(() => verifyAccessToken(refresh)).toThrow('INVALID_ACCESS_TOKEN');
    expect(() => verifyRefreshToken(access)).toThrow('INVALID_REFRESH_TOKEN');

    // Signed with the access secret but claiming refresh use: rejected by both.
    const crossUse = craft({ alg: 'HS256', typ: 'JWT' }, claims({ tokenUse: 'refresh' }), withAccessSecret);
    expect(() => verifyAccessToken(crossUse)).toThrow('INVALID_ACCESS_TOKEN');
    expect(() => verifyRefreshToken(crossUse)).toThrow('INVALID_REFRESH_TOKEN');
  });

  it('rejects malformed strings', () => {
    for (const junk of ['', 'abc', 'a.b', 'a.b.c', '...']) {
      expect(() => verifyAccessToken(junk)).toThrow('INVALID_ACCESS_TOKEN');
    }
  });
});

// ───────────────────────────────────────────────────────────────────
// 4. Middleware authorisation boundaries
// ───────────────────────────────────────────────────────────────────

describe('authenticate() — admin claims cannot bypass authentication', () => {
  const adminOnly = authenticate('admin') as unknown as Middleware;
  const employeeOnly = authenticate('employee') as unknown as Middleware;

  it('rejects a request with no bearer token', async () => {
    const { res, nextCalled } = await runAuth(adminOnly);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'MISSING_AUTH_HEADER' });
    expect(nextCalled).toBe(false);
  });

  it.each([
    ['forged with another secret', () => craft({ alg: 'HS256', typ: 'JWT' }, claims({ role: 'admin' }), hmac('sha256', randomSecret()))],
    ['alg=none', () => craft({ alg: 'none', typ: 'JWT' }, claims({ role: 'admin' }), () => '')],
    ['HS512 with the real secret', () => craft({ alg: 'HS512', typ: 'JWT' }, claims({ role: 'admin' }), hmac('sha512', env.JWT_ACCESS_SECRET))],
    ['employee token edited to admin', () => {
      const [head, , sig] = generateAccessToken({ userId: 'emp-1', role: 'employee' }).split('.');
      return `${head}.${b64url(claims({ role: 'admin' }))}.${sig}`;
    }],
    ['admin refresh token used as bearer', () => generateRefreshToken({ userId: 'ops-1', role: 'admin' })],
  ])('rejects an admin claim %s with 401', async (_label, makeToken) => {
    const { res, nextCalled } = await runAuth(adminOnly, makeToken());
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'INVALID_TOKEN' });
    expect(nextCalled).toBe(false);
  });

  it('rejects an expired admin token with 401', async () => {
    const expired = craft(
      { alg: 'HS256', typ: 'JWT' },
      claims({ role: 'admin', iat: nowSec() - 1200, exp: nowSec() - 600 }),
      withAccessSecret,
    );
    const { res, nextCalled } = await runAuth(adminOnly, expired);
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ error: 'ACCESS_TOKEN_EXPIRED' });
    expect(nextCalled).toBe(false);
  });

  it('rejects a genuine employee token on an admin route with 403', async () => {
    const token = generateAccessToken({ userId: 'emp-1', role: 'employee' });
    const { res, nextCalled } = await runAuth(adminOnly, token);
    expect(res.statusCode).toBe(403);
    expect(nextCalled).toBe(false);
  });

  it('refuses a validly signed admin token when the subject is not allowlisted', async () => {
    const token = generateAccessToken({ userId: 'ops-1', role: 'admin' });
    const { res, nextCalled } = await runAuth(adminOnly, token);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'INSUFFICIENT_PERMISSIONS' });
    expect(nextCalled).toBe(false);
  });

  it('honours an admin token only for an explicitly allowlisted subject', async () => {
    process.env.ADMIN_SUBJECT_IDS = 'ops-allowed';
    try {
      let isolatedAuth: typeof import('@shared/middleware/auth') | undefined;
      let isolatedJwt: typeof import('@shared/utils/jwt') | undefined;
      jest.isolateModules(() => {
        isolatedAuth = require('@shared/middleware/auth');
        isolatedJwt = require('@shared/utils/jwt');
      });
      const mw = isolatedAuth!.authenticate('admin') as unknown as Middleware;

      const allowed = await runAuth(mw, isolatedJwt!.generateAccessToken({ userId: 'ops-allowed', role: 'admin' }));
      expect(allowed.nextCalled).toBe(true);
      expect(allowed.req.user).toMatchObject({ id: 'ops-allowed', role: 'admin' });

      const other = await runAuth(mw, isolatedJwt!.generateAccessToken({ userId: 'ops-other', role: 'admin' }));
      expect(other.res.statusCode).toBe(403);
      expect(other.nextCalled).toBe(false);
    } finally {
      delete process.env.ADMIN_SUBJECT_IDS;
    }
  });

  it('does not let an admin-role token through an employee route', async () => {
    const token = generateAccessToken({ userId: 'ops-1', role: 'admin' });
    const { res, nextCalled } = await runAuth(employeeOnly, token);
    expect(res.statusCode).toBe(403);
    expect(nextCalled).toBe(false);
  });

  it('still requires an ACTIVE account for genuine employee tokens', async () => {
    const token = generateAccessToken({ userId: 'emp-1', role: 'employee' });

    mockedPrisma.employee.findFirst.mockResolvedValueOnce(null);
    const blocked = await runAuth(employeeOnly, token);
    expect(blocked.res.statusCode).toBe(401);
    expect(blocked.nextCalled).toBe(false);

    mockedPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp-1', status: 'ACTIVE' });
    const active = await runAuth(employeeOnly, token);
    expect(active.nextCalled).toBe(true);
    expect(mockedPrisma.employee.findFirst).toHaveBeenLastCalledWith({
      where: { id: 'emp-1', status: 'ACTIVE' },
    });
  });
});

// ───────────────────────────────────────────────────────────────────
// 5. Refresh flow
// ───────────────────────────────────────────────────────────────────

describe('refreshTokens — refresh-token handling', () => {
  it('refuses an access token presented as a refresh token', async () => {
    const access = generateAccessToken({ userId: 'emp-1', role: 'employee' });
    await expect(authService.refreshTokens(access)).rejects.toMatchObject({
      status: 401,
      message: 'INVALID_REFRESH_TOKEN',
    });
  });

  it('refuses a refresh token forged with another secret', async () => {
    const forged = craft(
      { alg: 'HS256', typ: 'JWT' },
      claims({ tokenUse: 'refresh' }),
      hmac('sha256', randomSecret()),
    );
    await expect(authService.refreshTokens(forged)).rejects.toMatchObject({ status: 401 });
  });

  it('refuses to refresh any admin-role token', async () => {
    const adminRefresh = generateRefreshToken({ userId: 'ops-1', role: 'admin' });
    await expect(authService.refreshTokens(adminRefresh)).rejects.toMatchObject({
      status: 401,
      message: 'INVALID_REFRESH_TOKEN',
    });
    expect(mockedPrisma.company.findUnique).not.toHaveBeenCalled();
  });

  it('refuses blocked employees and suspended companies, like login does', async () => {
    mockedPrisma.employee.findUnique.mockResolvedValueOnce({ id: 'emp-1', status: 'BLOCKED' });
    await expect(
      authService.refreshTokens(generateRefreshToken({ userId: 'emp-1', role: 'employee' })),
    ).rejects.toMatchObject({ status: 403, message: 'ACCOUNT_BLOCKED' });

    mockedPrisma.company.findUnique.mockResolvedValueOnce({ id: 'co-1', status: 'SUSPENDED' });
    await expect(
      authService.refreshTokens(generateRefreshToken({ userId: 'co-1', role: 'company', companyId: 'co-1' })),
    ).rejects.toMatchObject({ status: 403, message: 'ACCOUNT_SUSPENDED' });

    mockedPrisma.employee.findUnique.mockResolvedValueOnce(null);
    await expect(
      authService.refreshTokens(generateRefreshToken({ userId: 'ghost', role: 'employee' })),
    ).rejects.toMatchObject({ status: 401, message: 'USER_NOT_FOUND' });
  });

  it('issues a fresh, verifiable pair for an active employee', async () => {
    mockedPrisma.employee.findUnique.mockResolvedValueOnce({ id: 'emp-1', status: 'ACTIVE' });
    const pair = await authService.refreshTokens(
      generateRefreshToken({ userId: 'emp-1', role: 'employee', companyId: 'co-1' }),
    );
    expect(verifyAccessToken(pair.accessToken)).toEqual({ userId: 'emp-1', role: 'employee', companyId: 'co-1' });
    expect(verifyRefreshToken(pair.refreshToken).userId).toBe('emp-1');
  });
});

// ───────────────────────────────────────────────────────────────────
// 6. Repository tripwire — no usable JWT secret literal may come back
// ───────────────────────────────────────────────────────────────────

describe('repository contains no JWT secret literals', () => {
  const root = path.resolve(__dirname, '..');
  const SKIP = new Set(['node_modules', '.git', 'generated', 'dist', '.next']);

  function walk(dir: string, out: string[]) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // This file necessarily mentions the variable names in assertions.
      if (SKIP.has(entry.name) || entry.name === 'jwt-security.test.ts') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx|js|mjs|ya?ml|md)$|^\.env\.example$|^Dockerfile$/.test(entry.name)) out.push(full);
    }
  }

  const files: string[] = [];
  for (const top of ['src', 'tests', 'dashboard/src', '.github', 'docs']) {
    const dir = path.join(root, top);
    if (fs.existsSync(dir)) walk(dir, files);
  }
  for (const single of ['.env.example', 'dashboard/.env.example', 'docker-compose.yml', 'Dockerfile', 'README.md']) {
    const file = path.join(root, single);
    if (fs.existsSync(file)) files.push(file);
  }

  const secretLines = files.flatMap((file) =>
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => ({ where: `${path.relative(root, file)}:${i + 1}`, line }))
      .filter(({ line }) => /JWT/.test(line) && /SECRET/.test(line)),
  );

  it('scans the JWT configuration surface', () => {
    expect(secretLines.length).toBeGreaterThan(0);
  });

  it('has no fallback literal after a JWT secret lookup', () => {
    const fallbacks = secretLines.filter(({ line }) => /(\?\?|\|\|)\s*['"`]/.test(line));
    expect(fallbacks.map((f) => f.where)).toEqual([]);
  });

  it('has no assigned JWT secret value in code, env, yaml or sample files', () => {
    // A quoted, non-empty literal assigned to a JWT secret anywhere…
    const quotedLiteral = /JWT_[A-Z_]*SECRET\s*(?::|=(?!=))\s*(['"`])(?!\1)(?!<)/;
    // …or an env/yaml/sample line (KEY=value, KEY: value) carrying a value.
    const envOrYamlValue =
      /^\s*JWT_[A-Z_]*SECRET\s*(?:=|:)\s*(?!\s)(?!$)(?!['"]{2}\s*$)(?!<)(?!\$\{\{)(?!process\.env)(?!z\.)/;
    const assigned = secretLines.filter(
      ({ line }) => quotedLiteral.test(line) || envOrYamlValue.test(line),
    );
    expect(assigned.map((f) => f.where)).toEqual([]);
  });

  it('flags the shapes it is meant to catch', () => {
    const quotedLiteral = /JWT_[A-Z_]*SECRET\s*(?::|=(?!=))\s*(['"`])(?!\1)(?!<)/;
    const envOrYamlValue =
      /^\s*JWT_[A-Z_]*SECRET\s*(?:=|:)\s*(?!\s)(?!$)(?!['"]{2}\s*$)(?!<)(?!\$\{\{)(?!process\.env)(?!z\.)/;
    const value = randomSecret();
    expect(envOrYamlValue.test(`JWT_ACCESS_SECRET=${value}`)).toBe(true);
    expect(envOrYamlValue.test(`      JWT_REFRESH_SECRET: ${value}`)).toBe(true);
    expect(quotedLiteral.test(`process.env.JWT_ACCESS_SECRET = '${value}';`)).toBe(true);
    expect(quotedLiteral.test(`  JWT_ACCESS_SECRET: process.env.X ?? '${value}',`)).toBe(false);
    expect(/(\?\?|\|\|)\s*['"`]/.test(`  JWT_ACCESS_SECRET: process.env.X ?? '${value}',`)).toBe(true);
    expect(envOrYamlValue.test('JWT_ACCESS_SECRET=')).toBe(false);
    expect(envOrYamlValue.test('      JWT_ACCESS_SECRET: ${{ secrets.JWT_ACCESS_SECRET }}')).toBe(false);
  });

  it('contains none of the publicly known secret values anywhere scanned', () => {
    const hits = secretLines.filter(({ line }) =>
      [...line.matchAll(/(['"`])([^'"`]{8,})\1|=\s*([^\s'"`#]{8,})/g)].some((m) =>
        KNOWN_COMPROMISED_JWT_SECRET_SHA256.has(sha256(m[2] ?? m[3])),
      ),
    );
    expect(hits.map((h) => h.where)).toEqual([]);
  });
});
