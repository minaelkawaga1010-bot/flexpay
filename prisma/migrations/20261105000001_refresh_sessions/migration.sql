-- TASK-AUTH-R2: stateful refresh-session store (additive only; no change to any
-- existing table). Backs single-use rotation, replay/reuse detection, and
-- server-side session revocation. Stores only a SHA-256 hash of the refresh
-- JWT jti, never a raw token.

-- CreateEnum
CREATE TYPE "RefreshSubjectType" AS ENUM ('EMPLOYEE', 'COMPANY');

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "jtiHash" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectType" "RefreshSubjectType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "familyExpiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "replacedByJtiHash" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_jtiHash_key" ON "refresh_sessions"("jtiHash");

-- CreateIndex
CREATE INDEX "refresh_sessions_familyId_idx" ON "refresh_sessions"("familyId");

-- CreateIndex
CREATE INDEX "refresh_sessions_subjectType_subjectId_idx" ON "refresh_sessions"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "refresh_sessions_expiresAt_idx" ON "refresh_sessions"("expiresAt");
