-- ====================================================================
-- CBUAE Universal Account / SVF framework compliance
--
-- Adds a structural classification of the worker's wage-receipt
-- vehicle. Under the new CBUAE rules, wages may NOT be paid into a
-- prepaid card; the only allowed payees are a Universal Account, a
-- bank account, or an SVF wallet (held by a licensed SVF holder or
-- bank). The NymCard-issued card remains a downstream spend instrument
-- linked to the wallet — never the wage payee itself.
--
-- Nullable on existing rows; the WPS-compliance guard rejects any
-- attempt to register a worker as a WPS payee while this field is null
-- (no silent default that could classify a legacy prepaid card as a
-- valid vehicle).
-- ====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WageReceiptVehicle') THEN
    CREATE TYPE "WageReceiptVehicle" AS ENUM ('UNIVERSAL_ACCOUNT', 'BANK_ACCOUNT', 'SVF_WALLET');
  END IF;
END
$$;

ALTER TABLE "employees"
  ADD COLUMN IF NOT EXISTS "wageReceiptVehicle" "WageReceiptVehicle";

ALTER TABLE "employees"
  ADD COLUMN IF NOT EXISTS "wpsLicensedEntity" TEXT;
