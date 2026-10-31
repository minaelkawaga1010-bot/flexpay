-- ====================================================================
-- TASK-018.1 — Additive PII envelope / blind-index columns for phone + email
--
-- Prepares the schema for a LATER, separately-approved PII encryption
-- phase. This migration is PURELY ADDITIVE and idempotent:
--   • adds three NULLABLE TEXT columns on "employees";
--   • adds NO constraints, NO defaults, NO uniqueness, NO indexes;
--   • changes NO existing column, NO financial/amount/ledger structure,
--     and NO existing row.
--
-- The new columns are NOT written by any application code in this phase.
-- Dual-write, backfill, blind-index computation and key management are
-- future, separately-approved tasks (TASK-018.2+). The plaintext
-- "phone" / "email" columns are retained and keep their current
-- behaviour (uniqueness, lookups) until a later approved cutover.
-- ====================================================================

ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "phoneEncrypted" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "emailEncrypted" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "emailHash" TEXT;
