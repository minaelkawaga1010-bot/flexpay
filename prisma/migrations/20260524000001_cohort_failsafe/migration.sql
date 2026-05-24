-- ====================================================================
-- Cohort canary failsafe circuit breaker (STRATEGY §C.3)
--
-- Per-employer EWA failsafe flag. When the cohort's rolling-30d
-- uncollectible advance rate breaches 1.5%, the canary worker sets
-- ewaFailsafeActive=true; reserveAdvance then caps per-worker EWA at
-- 20% of accrued wages until a two-person clear re-promotes the
-- cohort. Per-cohort so one tripped employer never degrades global
-- uptime.
-- ====================================================================

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "ewaFailsafeActive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "ewaFailsafeTrippedAt" TIMESTAMP(3);
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "ewaFailsafeReason" TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "ewaFailsafeDefaultRatio" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "companies_ewaFailsafeActive_idx"
  ON "companies" ("ewaFailsafeActive");
