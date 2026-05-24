-- ====================================================================
-- A.7 PII Encryption at rest (FlexPay CTO Bible §5.2)
--
-- 1. Enable pgcrypto for any DB-level crypto needs + gen_random_uuid.
-- 2. Add AES-256-GCM envelope columns for worker name + salary
--    (application-layer encryption; columns hold the versioned
--    `v1:iv:tag:ct` envelope string).
-- 3. Add a SHA-256 equality-hash column for the Emirates ID and a
--    phone hash, plus supporting indexes.
--
-- The plaintext `full_name` / `salary` columns are retained during the
-- dual-write backfill window. A follow-up migration drops them once
-- every row has a populated encrypted counterpart (verified by a
-- reconciliation query: COUNT(*) WHERE full_name IS NOT NULL AND
-- full_name_encrypted IS NULL = 0).
-- ====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Employee PII envelopes + phone hash ---------------------------------
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "phoneHash" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "fullNameEncrypted" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "salaryEncrypted" TEXT;

CREATE INDEX IF NOT EXISTS "employees_phoneHash_idx" ON "employees" ("phoneHash");

-- KycDocument Emirates-ID hash ----------------------------------------
ALTER TABLE "kyc_documents" ADD COLUMN IF NOT EXISTS "emiratesIdHash" TEXT;

CREATE INDEX IF NOT EXISTS "kyc_documents_emiratesIdHash_idx"
  ON "kyc_documents" ("emiratesIdHash");

-- ====================================================================
-- Append-only ledger hardening (Bible §1.3 — Review A.3)
-- REVOKE UPDATE/DELETE on the financial ledger from the application
-- role. The role name is environment-specific; `flexpay_app` is the
-- convention. Wrapped in a DO block so the migration is idempotent and
-- does not fail when the role is absent (e.g. local dev as superuser).
-- ====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flexpay_app') THEN
    REVOKE UPDATE, DELETE ON "ledger_entries" FROM "flexpay_app";
    REVOKE UPDATE, DELETE ON "employee_transactions" FROM "flexpay_app";
  END IF;
END
$$;
