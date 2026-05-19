import jwt, { SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { env } from '@config/env';
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

export function generateAccessToken(payload: JWTPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_EXPIRY as SignOptions['expiresIn'],
    issuer,
    audience,
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

export function generateRefreshToken(payload: JWTPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_REFRESH_EXPIRY as SignOptions['expiresIn'],
    issuer,
    audience,
    jwtid: randomUUID(),
  };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, options);
}

export function verifyAccessToken(token: string): JWTPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer, audience }) as JWTPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) throw new Error('ACCESS_TOKEN_EXPIRED');
    throw new Error('INVALID_ACCESS_TOKEN');
  }
}

export function verifyRefreshToken(token: string): JWTPayload {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET, { issuer, audience }) as JWTPayload;
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
