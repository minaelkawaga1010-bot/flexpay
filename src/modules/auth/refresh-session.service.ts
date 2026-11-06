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
 * Stateful refresh-session store (TASK-AUTH-R2) with revocation/rotation race
 * serialization (TASK-AUTH-R5, fixes F-A).
 *
 * PostgreSQL is the AUTHORITATIVE revocation store. Each refresh JWT is bound to
 * a persisted RefreshSession row keyed by the SHA-256 hash of its `jti`. Rotation
 * is atomic single-use; reuse of a consumed token revokes the token family;
 * logout and block/suspend revoke server-side. Fail-closed: a DB error aborts the
 * refresh (no process-local fallback).
 *
 * TASK-AUTH-R5 — concurrency correctness. A family/subject revocation (a single
 * `UPDATE ... WHERE revokedAt IS NULL`) could previously MISS a descendant row
 * inserted by a concurrent rotation that committed after the revoke's scan began
 * (phantom insert under READ COMMITTED), leaving an active descendant after the
 * family should have died. We serialize with a per-SUBJECT advisory transaction
 * lock (`pg_advisory_xact_lock*(hashtext(subjectId))`):
 *   • rotate() holds it SHARED — concurrent rotations still proceed in parallel
 *     (the guarded single-use consume keeps exactly one winner), so benign
 *     concurrency is unchanged;
 *   • revokeFamily()/revokeAllForSubject() hold it EXCLUSIVE — a revoke waits for
 *     every in-flight rotation to COMMIT (so its descendant is visible and gets
 *     revoked), and any rotation that starts after a revoke sees the row revoked
 *     and its guarded `revokedAt IS NULL` consume fails (no new descendant).
 * One lock domain (subjectId) ⇒ consistent ordering, no deadlock. Reuse/blocked
 * revokes are committed in their own EXCLUSIVE-locked transaction BEFORE the
 * rejection is thrown, so a security revocation is never rolled back by the
 * auth error that accompanies it.
 */

export const FAMILY_ABSOLUTE_TTL_SECONDS = 30 * 24 * 60 * 60;

// Generous bounds so a brief lock wait under contention never trips the default
// interactive-transaction timeout (fail-closed, but should not be spurious).
const TX_OPTS = { timeout: 20_000, maxWait: 10_000 } as const;

function hashJti(jti: string): string {
  return createHash('sha256').update(jti, 'utf8').digest('hex');
}

function subjectTypeFor(role: JWTPayload['role']): RefreshSubjectType {
  return role === 'company' ? RefreshSubjectType.COMPANY : RefreshSubjectType.EMPLOYEE;
}

type Tx = Prisma.TransactionClient;

// Per-subject advisory transaction locks. Same key derivation for both modes so
// shared (rotation) and exclusive (revocation) contend on one domain.
// NOTE: pg_advisory_xact_lock* returns `void`, which $queryRaw cannot
// deserialize — use $executeRaw, which runs the statement without mapping a
// result column. The lock is held until the surrounding transaction commits.
async function lockSubjectShared(tx: Tx, subjectId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${subjectId})::int8)`;
}
async function lockSubjectExclusive(tx: Tx, subjectId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${subjectId})::int8)`;
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

/** Revoke a whole family INSIDE a caller-held transaction (no lock acquisition here). */
async function revokeFamilyTx(tx: Tx, familyId: string, reason: string): Promise<void> {
  await tx.refreshSession.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

type RotateOutcome =
  | { kind: 'rotated'; payload: JWTPayload; newJti: string }
  | { kind: 'reuse'; row: SessionRow }
  | { kind: 'blocked'; subjectId: string }
  | { kind: 'suspended'; subjectId: string }
  | { kind: 'revoked' }
  | { kind: 'expired' }
  | { kind: 'not_found' }
  | { kind: 'mismatch' }
  | { kind: 'already_used' };

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
    if (claims.role === 'admin') throw Unauthorized('INVALID_REFRESH_TOKEN');

    const presentedHash = hashJti(claims.jti);
    const now = new Date();
    const newJti = randomUUID();
    const newHash = hashJti(newJti);

    // All reads + the consume/create happen under a SHARED subject lock so that
    // an EXCLUSIVE revoke serializes against this rotation. We only RETURN a
    // decision here; committed revocations + throwing happen AFTER this tx so a
    // security revocation is never rolled back by the thrown auth error.
    const outcome: RotateOutcome = await prisma.$transaction(async (tx) => {
      await lockSubjectShared(tx, claims.userId);

      const row = await tx.refreshSession.findUnique({ where: { jtiHash: presentedHash } });
      if (!row) return { kind: 'not_found' };
      if (row.subjectId !== claims.userId || row.subjectType !== subjectTypeFor(claims.role)) {
        return { kind: 'mismatch' };
      }
      if (row.revokedAt) return { kind: 'revoked' };
      if (row.consumedAt) return { kind: 'reuse', row };
      if (row.expiresAt <= now || row.familyExpiresAt <= now) return { kind: 'expired' };

      // Subject must still be allowed to refresh (decided here, revoked after commit).
      if (row.subjectType === RefreshSubjectType.EMPLOYEE) {
        const emp = await tx.employee.findUnique({ where: { id: row.subjectId } });
        if (!emp) return { kind: 'not_found' };
        if (emp.status === EmployeeStatus.BLOCKED) return { kind: 'blocked', subjectId: row.subjectId };
      } else {
        const co = await tx.company.findUnique({ where: { id: row.subjectId } });
        if (!co) return { kind: 'not_found' };
        if (co.status !== CompanyStatus.ACTIVE) return { kind: 'suspended', subjectId: row.subjectId };
      }

      // Atomic single-use consume: guarded so EXACTLY ONE concurrent (shared)
      // rotation flips consumedAt, and so a prior EXCLUSIVE revoke (revokedAt
      // set) makes this fail — no descendant is created into a revoked family.
      const consumed = await tx.refreshSession.updateMany({
        where: { id: row.id, consumedAt: null, revokedAt: null },
        data: { consumedAt: now, replacedByJtiHash: newHash },
      });
      if (consumed.count !== 1) return { kind: 'already_used' };

      const newExpiry = new Date(
        Math.min(now.getTime() + jwtTtlSeconds.refresh * 1000, row.familyExpiresAt.getTime()),
      );
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

      const rotated: JWTPayload =
        claims.role === 'company'
          ? { userId: claims.userId, role: 'company', companyId: claims.userId }
          : claims.companyId
            ? { userId: claims.userId, role: 'employee', companyId: claims.companyId }
            : { userId: claims.userId, role: 'employee' };
      return { kind: 'rotated', payload: rotated, newJti };
    }, TX_OPTS);

    switch (outcome.kind) {
      case 'rotated':
        return {
          accessToken: generateAccessToken(outcome.payload),
          refreshToken: generateRefreshToken(outcome.payload, outcome.newJti),
        };
      case 'reuse':
        // Refresh-token theft signal → revoke the whole family (EXCLUSIVE, durably
        // committed) + audit, THEN reject. The exclusive lock guarantees any
        // concurrent rotation's descendant is caught or prevented.
        await this.revokeFamily(outcome.row.subjectId, outcome.row.familyId, 'reuse_detected');
        await auditSecurity(outcome.row, 'REFRESH_REUSE_DETECTED');
        throw Unauthorized('REFRESH_TOKEN_REUSE_DETECTED');
      case 'blocked':
        await this.revokeAllForSubject(RefreshSubjectType.EMPLOYEE, outcome.subjectId, 'subject_blocked');
        throw Forbidden('ACCOUNT_BLOCKED');
      case 'suspended':
        await this.revokeAllForSubject(RefreshSubjectType.COMPANY, outcome.subjectId, 'subject_suspended');
        throw Forbidden('ACCOUNT_SUSPENDED');
      case 'revoked':
        throw Unauthorized('REFRESH_TOKEN_REVOKED');
      case 'expired':
        throw Unauthorized('REFRESH_TOKEN_EXPIRED');
      case 'mismatch':
        throw Unauthorized('REFRESH_SUBJECT_MISMATCH');
      case 'already_used':
        throw Unauthorized('REFRESH_TOKEN_ALREADY_USED');
      case 'not_found':
      default:
        throw Unauthorized('REFRESH_SESSION_NOT_FOUND');
    }
  }

  /**
   * Server-side logout: revoke the family of the presented token (this device).
   * Idempotent — never errors on an absent/invalid token.
   */
  async revokeByToken(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) return;
    let claims: JWTPayload & { jti: string };
    try {
      claims = verifyRefreshToken(presentedToken);
    } catch {
      return;
    }
    const jtiHash = hashJti(claims.jti);
    const revoked: SessionRow | null = await prisma.$transaction(async (tx) => {
      await lockSubjectExclusive(tx, claims.userId);
      const row = await tx.refreshSession.findUnique({ where: { jtiHash } });
      if (!row || row.revokedAt) return null;
      await revokeFamilyTx(tx, row.familyId, 'logout');
      return row;
    }, TX_OPTS);
    if (revoked) {
      await auditSecurity(revoked, 'REFRESH_LOGOUT_REVOKED');
      logger.warn('Refresh session family revoked', { familyId: revoked.familyId, reason: 'logout' });
    }
  }

  /** Revoke EVERY active session for a subject (all devices) — block/suspend/forced. */
  async revokeAllForSubject(
    subjectType: RefreshSubjectType,
    subjectId: string,
    reason: string,
  ): Promise<number> {
    const count: number = await prisma.$transaction(async (tx) => {
      await lockSubjectExclusive(tx, subjectId);
      const res = await tx.refreshSession.updateMany({
        where: { subjectType, subjectId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      });
      return res.count;
    }, TX_OPTS);
    if (count > 0) logger.warn('Refresh sessions revoked for subject', { subjectType, reason, count });
    return count;
  }

  /** Revoke a whole family under an EXCLUSIVE subject lock (serialized vs rotation). */
  private async revokeFamily(subjectId: string, familyId: string, reason: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await lockSubjectExclusive(tx, subjectId);
      await revokeFamilyTx(tx, familyId, reason);
    }, TX_OPTS);
    logger.warn('Refresh session family revoked', { familyId, reason });
  }
}

export const refreshSessionService = new RefreshSessionService();
