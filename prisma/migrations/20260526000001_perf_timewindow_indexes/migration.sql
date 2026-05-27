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
-- CONCURRENTLY: build without an ACCESS EXCLUSIVE lock so payday write
-- traffic is not blocked during the migration. NOTE: CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction block — Prisma wraps
-- each migration in a transaction by default, so this migration must
-- be applied with the transaction disabled. Run via:
--   prisma migrate resolve / apply with --no-transaction, or execute
--   this SQL directly against the database outside a txn.
-- ====================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS "advances_status_requestedAt_idx"
  ON "advances" ("status", "requestedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "payroll_cycles_status_periodEnd_idx"
  ON "payroll_cycles" ("status", "periodEnd");
