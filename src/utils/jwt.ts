import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export type Role = 'employee' | 'company' | 'admin';

export interface JwtPayload {
  sub: string;
  role: Role;
  // Optional extras
  companyId?: string;
}

export function signAccessToken(payload: JwtPayload): string {
  const opts: SignOptions = { expiresIn: env.jwt.accessTtl as SignOptions['expiresIn'] };
  return jwt.sign(payload, env.jwt.secret, opts);
}

export function signRefreshToken(payload: JwtPayload): string {
  const opts: SignOptions = { expiresIn: env.jwt.refreshTtl as SignOptions['expiresIn'] };
  return jwt.sign({ ...payload, kind: 'refresh' }, env.jwt.secret, opts);
}

export function verifyToken(token: string): JwtPayload & { iat: number; exp: number } {
  return jwt.verify(token, env.jwt.secret) as JwtPayload & { iat: number; exp: number };
}
