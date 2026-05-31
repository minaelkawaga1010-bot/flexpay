-- ====================================================================
-- Free Bills (Utility Payments) — bill_payments table
--
-- Records every wage-receipt-vehicle-funded bill payment as an
-- append-only row. The lifecycle is:
--
--   PENDING    wallet debited, biller dispatch in-flight
--   COMPLETED  biller acknowledged success (webhook)
--   FAILED     biller rejected or rail error → wallet refunded via an
--              append-only EmployeeTransaction REFUND row
--   REVERSED   post-completion reversal (rare, biller-initiated)
--
-- Idempotency:
--   • idempotency_key is UNIQUE — a replay of the same client request
--     resolves to the same row (no double debit).
--   • The linked EmployeeTransaction carries idempotency key
--     `bill:<key>`, so the wallet-statement layer enforces the same
--     guarantee at the SQL-unique level.
--
-- Indexes:
--   • (employee_id, created_at)  user statement view
--   • (status, created_at)       ops queue (PENDING > N minutes, etc.)
--   • (external_ref)             webhook lookup
-- ====================================================================

-- Enums --------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillerType') THEN
    CREATE TYPE "BillerType" AS ENUM (
      'DEWA', 'SEWA', 'ADDC', 'FEWA', 'ETISALAT', 'DU', 'SALIK', 'RTA', 'OTHER'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillPaymentStatus') THEN
    CREATE TYPE "BillPaymentStatus" AS ENUM (
      'PENDING', 'COMPLETED', 'FAILED', 'REVERSED'
    );
  END IF;
END
$$;

-- TransactionType.BILL_PAYMENT — additive enum value. ALTER TYPE ADD
-- VALUE cannot run inside a transaction block; the migration runner
-- handles that. IF NOT EXISTS makes the migration safe to re-run.
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'BILL_PAYMENT';

-- Table --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "bill_payments" (
  "id"                    TEXT                 NOT NULL,
  "employeeId"            TEXT                 NOT NULL,
  "billerType"            "BillerType"         NOT NULL,
  "billerAccountRef"      TEXT                 NOT NULL,
  "amount"                DOUBLE PRECISION     NOT NULL,
  "fee"                   DOUBLE PRECISION     NOT NULL DEFAULT 0,
  "totalAmount"           DOUBLE PRECISION     NOT NULL,
  "currency"              TEXT                 NOT NULL DEFAULT 'AED',
  "status"                "BillPaymentStatus"  NOT NULL DEFAULT 'PENDING',
  "failureReason"         TEXT,
  "externalRef"           TEXT,
  "idempotencyKey"        TEXT                 NOT NULL,
  "walletTransactionId"   TEXT,
  "refundTransactionId"   TEXT,
  "metadata"              JSONB,
  "createdAt"             TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt"           TIMESTAMP(3),

  CONSTRAINT "bill_payments_pkey" PRIMARY KEY ("id")
);

-- Uniqueness + foreign key + indexes ---------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS "bill_payments_idempotencyKey_key"
  ON "bill_payments" ("idempotencyKey");

CREATE INDEX IF NOT EXISTS "bill_payments_employeeId_createdAt_idx"
  ON "bill_payments" ("employeeId", "createdAt");

CREATE INDEX IF NOT EXISTS "bill_payments_status_createdAt_idx"
  ON "bill_payments" ("status", "createdAt");

CREATE INDEX IF NOT EXISTS "bill_payments_externalRef_idx"
  ON "bill_payments" ("externalRef");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bill_payments_employeeId_fkey'
  ) THEN
    ALTER TABLE "bill_payments"
      ADD CONSTRAINT "bill_payments_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "employees"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
