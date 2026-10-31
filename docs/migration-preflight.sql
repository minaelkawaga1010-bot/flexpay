-- ============================================================================
-- FlexPay — READ-ONLY Prisma migration preflight  (TASK-018.4B)
-- Run by a SEPARATELY AUTHORIZED database operator against a target database
-- BEFORE any migration-history adoption. 100% READ-ONLY: no INSERT/UPDATE/
-- DELETE/DDL, no `migrate resolve`, no customer/PII/financial row access.
-- Output is sanitized (migration names, SHA-256 checksums, object names,
-- booleans) — no connection strings, secrets, or customer data.
--   Usage:  psql "$TARGET_URL" -f docs/migration-preflight.sql
--
-- M4 (20260526000001_perf_timewindow_indexes) checksum reference:
--   ORIGINAL (pre-TASK-018.4B)   : 31a7898ed876de21feb6471a2e0b8b8b12c1f76342740be8015d0479a7fcfbd0
--   CORRECTED (committed, I4)    : 4167a4a099629d423064ccb0ae583138cc3f96fe7f48b5f947c78fd54c131a72
-- A database whose recorded M4 checksum is the ORIGINAL value is BLOCKED for
-- automatic adoption of the corrected history (see MIGRATION_BASELINE_RUNBOOK.md).
-- ============================================================================
\pset pager off
\set ON_ERROR_STOP off

SELECT 'pg_version' AS check, version() AS value;

SELECT CASE WHEN to_regclass('public._prisma_migrations') IS NOT NULL
            THEN 'true' ELSE 'false' END AS has_hist \gset
SELECT 'has_prisma_migrations' AS check, :'has_hist' AS value;

\if :has_hist
  SELECT migration_name,
         checksum,
         (finished_at IS NOT NULL)    AS applied,
         (rolled_back_at IS NOT NULL) AS rolled_back,
         (finished_at IS NULL AND rolled_back_at IS NULL) AS failed_or_partial
  FROM _prisma_migrations ORDER BY started_at;

  SELECT 'm4_checksum_class' AS check,
         CASE
           WHEN NOT EXISTS (SELECT 1 FROM _prisma_migrations
                            WHERE migration_name='20260526000001_perf_timewindow_indexes')
                THEN 'M4_NOT_RECORDED'
           WHEN EXISTS (SELECT 1 FROM _prisma_migrations
                        WHERE migration_name='20260526000001_perf_timewindow_indexes'
                          AND checksum='31a7898ed876de21feb6471a2e0b8b8b12c1f76342740be8015d0479a7fcfbd0')
                THEN 'ORIGINAL_M4_RECORDED'    -- BLOCKED: needs separately-approved history reconciliation
           WHEN EXISTS (SELECT 1 FROM _prisma_migrations
                        WHERE migration_name='20260526000001_perf_timewindow_indexes'
                          AND checksum='4167a4a099629d423064ccb0ae583138cc3f96fe7f48b5f947c78fd54c131a72')
                THEN 'CORRECTED_M4_RECORDED'   -- already on the corrected history
           ELSE 'OTHER_M4_CHECKSUM'
         END AS value;

  SELECT 'failed_or_partial' AS check, migration_name AS value
  FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;
\else
  SELECT 'migration_history' AS check,
         'NO_HISTORY — db-push origin or never migrated (no _prisma_migrations)' AS value;
  SELECT 'm4_checksum_class' AS check, 'NO_HISTORY' AS value;
\endif

SELECT 'core_tables_present' AS check,
       string_agg(t.name, ',' ORDER BY t.name) FILTER (
         WHERE to_regclass('public.'||quote_ident(t.name)) IS NOT NULL) AS present,
       string_agg(t.name, ',' ORDER BY t.name) FILTER (
         WHERE to_regclass('public.'||quote_ident(t.name)) IS NULL) AS missing
FROM (VALUES ('employees'),('companies'),('cards'),('employee_transactions'),
             ('ledger_entries'),('advances'),('payroll_cycles'),('kyc_documents'),
             ('bill_payments'),('sanctions_list_entries')) AS t(name);

SELECT 'relevant_indexes' AS check,
       string_agg(i.name, ',' ORDER BY i.name) FILTER (WHERE x.indexname IS NOT NULL) AS present,
       string_agg(i.name, ',' ORDER BY i.name) FILTER (WHERE x.indexname IS NULL)     AS missing
FROM (VALUES ('employees_phoneHash_idx'),
             ('advances_status_requestedAt_idx'),
             ('payroll_cycles_status_periodEnd_idx')) AS i(name)
LEFT JOIN pg_indexes x ON x.schemaname='public' AND x.indexname=i.name;

SELECT 'pii_columns_present' AS check,
       string_agg(column_name, ',' ORDER BY column_name) AS value
FROM information_schema.columns
WHERE table_schema='public' AND table_name='employees'
  AND column_name IN ('phoneEncrypted','emailEncrypted','emailHash','phoneHash');

SELECT 'expected_table_count' AS check,
       count(*)::text || ' / 21' AS value
FROM information_schema.tables
WHERE table_schema='public' AND table_name <> '_prisma_migrations';
