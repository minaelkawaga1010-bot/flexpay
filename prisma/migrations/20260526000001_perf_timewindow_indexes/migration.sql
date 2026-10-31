-- ====================================================================
-- Performance: composite indexes for time-window analytics scans
--
-- The metrics canary (rolling-30d per-cohort default ratio), the
-- liquidity forecaster (outstanding-float aggregate), and the
-- inbound-funding bucketing all filter on (status + requestedAt) on
-- advances and (status + periodEnd) on payroll_cycles. Without these
-- the rolling-window scans degrade to sequential scans on growing
-- tables.
--
-- TASK-018.4B: CONCURRENTLY was removed from these two statements so the
-- migration history replays inside Prisma's per-migration transaction.
-- A multi-statement migration file is executed by Prisma as a single
-- multi-statement simple-query, which PostgreSQL runs in an implicit
-- transaction block where CREATE INDEX CONCURRENTLY is rejected with
-- SQLSTATE 25001 — that blocked `prisma migrate dev` / shadow-database
-- replay. The index names, target tables, columns, column ordering and
-- IF NOT EXISTS are UNCHANGED. On a fresh/empty database (the baseline
-- bootstrap path) these build instantly; where they already exist,
-- IF NOT EXISTS makes them a no-op. A plain CREATE INDEX takes a lock
-- that blocks writes while building, so this file must NOT be executed
-- against a large, already-populated table that still lacks the index —
-- see the migration runbook (docs/MIGRATION_BASELINE_RUNBOOK.md).
-- ====================================================================

CREATE INDEX IF NOT EXISTS "advances_status_requestedAt_idx"
  ON "advances" ("status", "requestedAt");

CREATE INDEX IF NOT EXISTS "payroll_cycles_status_periodEnd_idx"
  ON "payroll_cycles" ("status", "periodEnd");
