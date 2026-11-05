import { randomUUID, createHash } from 'crypto';
import { Prisma, EmployeeStatus, CompanyStatus, RefreshSubjectType } from '@prisma/client';
import { prisma } from '@config/prisma';
import { jwtTtlSeconds } from '@config/env';
import {
  JWTPayload,
  TokenPair,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '@shared/utils/jwt';
import { Unauthorized, Forbidden } from '@shared/utils/errors';
import logger from '@shared/utils/logger';

/**
 * Stateful refresh-session store (TASK-AUTH-R2).
 *
 * PostgreSQL is the AUTHORITATIVE revocation store. Each refresh JWT is bound
 * to a persisted RefreshSession row keyed by the SHA-256 hash of its `jti`
 * (never the raw token). Rotation is atomic single-use; reuse of an already
 * consumed token revokes the entire token family; logout and block/suspend
 * revoke server-side. If the store is unavailable the DB call throws and the
 * refresh FAILS CLOSED — there is no process-local fallback for session state.
 */

/**
 * Absolute token-family lifetime cap. Rolling single-use rotation keeps a
 * session alive within this window; past it the family stops refreshing and
 * the user must re-authenticate. 30 days balances UX (infrequent re-login)
 * against bounding the lifetime of any single stolen lineage. The per-token
 * refresh exp (JWT_REFRESH_EXPIRY, 7d) is unchanged and is additionally capped
 * by this value on each rotation.
 */
export const FAMILY_ABSOLUTE_TTL_SECONDS = 30 * 24 * 60 * 60;

function hashJti(jti: string): string {
  return createHash('sha256').update(jti, 'utf8').digest('hex');
}

function subjectTypeFor(role: JWTPayload['role']): RefreshSubjectType {
  return role === 'company' ? RefreshSubjectType.COMPANY : RefreshSubjectType.EMPLOYEE;
}

type SessionRow = {
  id: string;
  familyId: string;
  jtiHash: string;
  subjectId: string;
  subjectType: RefreshSubjectType;
};

/** Sanitised security audit — ids and a hash PREFIX only, never a raw token/jti. */
async function auditSecurity(row: SessionRow, action: string): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorType: row.subjectType === RefreshSubjectType.COMPANY ? 'company' : 'employee',
      actorId: row.subjectId,
      action,
      resourceType: 'refresh_session',
      resourceId: row.familyId,
      metadata: { jtiHashPrefix: row.jtiHash.slice(0, 12) },
    },
  });
}

export class RefreshSessionService {
  /** Establish a brand-new token family at login / registration / OTP verify. */
  async issue(payload: JWTPayload): Promise<TokenPair> {
    if (payload.role === 'admin') throw Unauthorized('REFRESH_NOT_ALLOWED_FOR_ROLE');
    const jti = randomUUID();
    const nowMs = Date.now();
    await prisma.refreshSession.create({
      data: {
        familyId: randomUUID(),
        jtiHash: hashJti(jti),
        subjectId: payload.userId,
        subjectType: subjectTypeFor(payload.role),
        expiresAt: new Date(nowMs + jwtTtlSeconds.refresh * 1000),
        familyExpiresAt: new Date(nowMs + FAMILY_ABSOLUTE_TTL_SECONDS * 1000),
      },
    });
    return {
      accessToken: generateAccessToken(payload),
      refreshToken: generateRefreshToken(payload, jti),
    };
  }

  /** Single-use rotation with replay/reuse detection + subject-state recheck. */
  async rotate(presentedToken: string): Promise<TokenPair> {
    let claims: JWTPayload & { jti: string };
    try {
      claims = verifyRefreshToken(presentedToken);
    } catch {
      throw Unauthorized('INVALID_REFRESH_TOKEN');
    }
    // No admin login exists → no admin refresh token is legitimate.
    if (claims.role === 'admin') throw Unauthorized('INVALID_REFRESH_TOKEN');

    const presentedHash = hashJti(claims.jti);
    const row = await prisma.refreshSession.findUnique({ where: { jtiHash: presentedHash } });

    // Untracked (legacy / unknown) token: a valid signature but NO server-side
    // session. It must NOT be able to mint a new session via any fallback.
    if (!row) throw Unauthorized('REFRESH_SESSION_NOT_FOUND');
    if (row.revokedAt) throw Unauthorized('REFRESH_TOKEN_REVOKED');

    // Reuse of an ALREADY-CONSUMED token = refresh-token theft signal. Revoke
    // the whole family and audit — COMMITTED outside the rejecting path so the
    // revocation persists even though this request is refused.
    if (row.consumedAt) {
      await this.revokeFamily(row.familyId, 'reuse_detected');
      await auditSecurity(row, 'REFRESH_REUSE_DETECTED');
      throw Unauthorized('REFRESH_TOKEN_REUSE_DETECTED');
    }

    const now = new Date();
    if (row.expiresAt <= now || row.familyExpiresAt <= now) {
      throw Unauthorized('REFRESH_TOKEN_EXPIRED');
    }
    if (row.subjectId !== claims.userId || row.subjectType !== subjectTypeFor(claims.role)) {
      throw Unauthorized('REFRESH_SUBJECT_MISMATCH');
    }

    // Same gates as login: a blocked employee or a non-active company cannot
    // mint fresh tokens; additionally revoke their refresh capability.
    if (row.subjectType === RefreshSubjectType.EMPLOYEE) {
      const emp = await prisma.employee.findUnique({ where: { id: row.subjectId } });
      if (!emp) throw Unauthorized('USER_NOT_FOUND');
      if (emp.status === EmployeeStatus.BLOCKED) {
        await this.revokeAllForSubject(RefreshSubjectType.EMPLOYEE, row.subjectId, 'subject_blocked');
        throw Forbidden('ACCOUNT_BLOCKED');
      }
    } else {
      const co = await prisma.company.findUnique({ where: { id: row.subjectId } });
      if (!co) throw Unauthorized('USER_NOT_FOUND');
      if (co.status !== CompanyStatus.ACTIVE) {
        await this.revokeAllForSubject(RefreshSubjectType.COMPANY, row.subjectId, 'subject_suspended');
        throw Forbidden('ACCOUNT_SUSPENDED');
      }
    }

    const newJti = randomUUID();
    const newHash = hashJti(newJti);
    const newExpiry = new Date(
      Math.min(now.getTime() + jwtTtlSeconds.refresh * 1000, row.familyExpiresAt.getTime()),
    );

    // Atomic single-use consume + replacement, all-or-nothing. The guarded
    // updateMany lets EXACTLY ONE concurrent caller flip consumedAt from NULL;
    // a loser (count 0 though its own read saw NULL) is a benign concurrent
    // double-submit → rejected WITHOUT family revocation.
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const consumed = await tx.refreshSession.updateMany({
        where: { id: row.id, consumedAt: null, revokedAt: null },
        data: { consumedAt: now, replacedByJtiHash: newHash },
      });
      if (consumed.count !== 1) throw Unauthorized('REFRESH_TOKEN_ALREADY_USED');
      await tx.refreshSession.create({
        data: {
          familyId: row.familyId,
          jtiHash: newHash,
          subjectId: row.subjectId,
          subjectType: row.subjectType,
          expiresAt: newExpiry,
          familyExpiresAt: row.familyExpiresAt,
        },
      });
    });

    const rotated: JWTPayload =
      claims.role === 'company'
        ? { userId: claims.userId, role: 'company', companyId: claims.userId }
        : claims.companyId
          ? { userId: claims.userId, role: 'employee', companyId: claims.companyId }
          : { userId: claims.userId, role: 'employee' };

    return {
      accessToken: generateAccessToken(rotated),
      refreshToken: generateRefreshToken(rotated, newJti),
    };
  }

  /**
   * Server-side logout: revoke the family of the presented token (this
   * device's session chain). Idempotent — never errors on an absent/invalid
   * token so logout always succeeds for the client.
   */
  async revokeByToken(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) return;
    let claims: JWTPayload & { jti: string };
    try {
      claims = verifyRefreshToken(presentedToken);
    } catch {
      return;
    }
    const row = await prisma.refreshSession.findUnique({ where: { jtiHash: hashJti(claims.jti) } });
    if (!row || row.revokedAt) return;
    await this.revokeFamily(row.familyId, 'logout');
    await auditSecurity(row, 'REFRESH_LOGOUT_REVOKED');
  }

  /** Revoke EVERY active session for a subject (all devices) — block/suspend/forced. */
  async revokeAllForSubject(
    subjectType: RefreshSubjectType,
    subjectId: string,
    reason: string,
  ): Promise<number> {
    const res = await prisma.refreshSession.updateMany({
      where: { subjectType, subjectId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    if (res.count > 0) logger.warn('Refresh sessions revoked for subject', { subjectType, reason, count: res.count });
    return res.count;
  }

  private async revokeFamily(familyId: string, reason: string): Promise<void> {
    await prisma.refreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    logger.warn('Refresh session family revoked', { familyId, reason });
  }
}

export const refreshSessionService = new RefreshSessionService();
