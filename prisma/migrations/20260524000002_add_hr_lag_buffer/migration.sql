-- ====================================================================
-- HR data-lag safety buffer
--
-- Structural haircut applied to all real-time wage computations for a
-- company cohort. Absorbs the latency window between a real-world HR
-- event (termination, attendance correction) and its webhook sync,
-- during which a worker could otherwise drain accrued EWA against
-- stale attendance. Default 10%.
-- ====================================================================

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "hrLagBufferPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.10;
