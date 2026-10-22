import jwt, { SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { env, jwtTtlSeconds } from '@config/env';
import { UserRole } from '@shared/types';

export interface JWTPayload {
  userId: string;
  role: UserRole;
  companyId?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const issuer = 'flexpay';
const audience = 'flexpay-users';

/**
 * The only accepted signing algorithm. Pinned on sign AND verify so a
 * token is never accepted under `none`, another HMAC size, or an
 * asymmetric algorithm (key confusion).
 */
export const JWT_ALGORITHM = 'HS256' as const;

type TokenUse = 'access' | 'refresh';

/**
 * Claims a verified token must carry. Access and refresh tokens use
 * different secrets AND carry `tokenUse`, so one can never stand in for
 * the other. Tokens without `exp` are rejected.
 */
const verifiedClaimsSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['employee', 'company', 'admin']),
  companyId: z.string().min(1).optional(),
  tokenUse: z.enum(['access', 'refresh']),
  iat: z.number(),
  exp: z.number(),
});

/**
 * Build claims explicitly: extra properties on the caller's object (a
 * stale `exp`, a stray role flag) never reach the signed token.
 */
function claimsFor(payload: JWTPayload, tokenUse: TokenUse) {
  return {
    userId: payload.userId,
    role: payload.role,
    ...(payload.companyId ? { companyId: payload.companyId } : {}),
    tokenUse,
  };
}

export function generateAccessToken(payload: JWTPayload): string {
  const options: SignOptions = {
    algorithm: JWT_ALGORITHM,
    expiresIn: jwtTtlSeconds.access,
    issuer,
    audience,
  };
  return jwt.sign(claimsFor(payload, 'access'), env.JWT_ACCESS_SECRET, options);
}

export function generateRefreshToken(payload: JWTPayload): string {
  const options: SignOptions = {
    algorithm: JWT_ALGORITHM,
    expiresIn: jwtTtlSeconds.refresh,
    issuer,
    audience,
    jwtid: randomUUID(),
  };
  return jwt.sign(claimsFor(payload, 'refresh'), env.JWT_REFRESH_SECRET, options);
}

function verifyWith(token: string, secret: string, expectedUse: TokenUse): JWTPayload {
  const decoded = jwt.verify(token, secret, {
    algorithms: [JWT_ALGORITHM],
    issuer,
    audience,
  });
  const claims = verifiedClaimsSchema.safeParse(decoded);
  if (!claims.success || claims.data.tokenUse !== expectedUse) {
    throw new Error('JWT_CLAIMS_REJECTED');
  }
  const { userId, role, companyId } = claims.data;
  return companyId ? { userId, role, companyId } : { userId, role };
}

export function verifyAccessToken(token: string): JWTPayload {
  try {
    return verifyWith(token, env.JWT_ACCESS_SECRET, 'access');
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) throw new Error('ACCESS_TOKEN_EXPIRED');
    throw new Error('INVALID_ACCESS_TOKEN');
  }
}

export function verifyRefreshToken(token: string): JWTPayload {
  try {
    return verifyWith(token, env.JWT_REFRESH_SECRET, 'refresh');
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) throw new Error('REFRESH_TOKEN_EXPIRED');
    throw new Error('INVALID_REFRESH_TOKEN');
  }
}

export function generateTokens(payload: JWTPayload): TokenPair {
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
  };
}
