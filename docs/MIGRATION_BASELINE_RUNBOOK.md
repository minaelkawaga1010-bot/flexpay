# Prisma Migration Baseline Runbook (TASK-018.4B / Approach A)

> **Status: feature-branch only. NOT approved for any real database.**
> Production, staging, shared and DR environments are **NOT VERIFIED**. No real
> migration may run until a separately-authorized operator completes the
> read-only preflight (`docs/migration-preflight.sql`) and the environment-class
> gates below are satisfied. This runbook is bookkeeping + DDL guidance only.

## 0. Background (what changed and why)

The migration history had two defects that broke the full Prisma lifecycle:

1. **No baseline.** The earliest migration (`20260523000001_pii_encryption_a7`)
   begins with `ALTER TABLE "employees" …`, assuming a base schema that was
   created by `prisma db push`, never by a migration. A from-empty
   `migrate deploy` therefore failed with `relation "employees" does not exist`.
2. **M4 was non-replayable.** `20260526000001_perf_timewindow_indexes` used two
   `CREATE INDEX CONCURRENTLY` statements in one file. Prisma sends a migration
   file as a single multi-statement simple-query, which PostgreSQL runs in an
   **implicit transaction block** where `CREATE INDEX CONCURRENTLY` is rejected
   (`SQLSTATE 25001`). This blocked `prisma migrate dev` / shadow-database replay
   (`P3006`). (This is NOT a Prisma explicit-transaction wrapper: a single-
   statement CONCURRENTLY migration deploys fine; the multi-statement batch is
   the cause.)

**Approach A (this change) — minimal, auditable:**

- `00000000000000_baseline/migration.sql` — a generated baseline representing the
  full current schema (21 tables, enums, indexes incl. `employees_phoneHash_idx`
  and both M4 performance indexes, all FKs, and the TASK-018.1 PII columns).
- `20260526000001_perf_timewindow_indexes/migration.sql` — **CONCURRENTLY removed**
  from the two statements (index names / tables / columns / ordering / `IF NOT
  EXISTS` unchanged). Checksum changed `31a7898e…` → `4167a4a0…` (documented).
- `prisma/schema.prisma` — declared the already-existing `@@index([phoneHash])`
  on `Employee` so schema ⇄ migrations ⇄ DB agree (no drift). Index name is the
  historical `employees_phoneHash_idx`. No PII value/semantic change.
- The other **six** historical migrations are byte-for-byte unchanged.

Validated on disposable PostgreSQL 16 (synthetic data only): fresh
`migrate deploy`, `migrate dev` + shadow replay (no 25001/P3006), schema parity
(diff = 0), future migration, repeat deploy. See
`scripts/migration-lifecycle-check.sh` (also run in CI).

## 1. Prerequisite for ANY real environment — the read-only preflight

Before touching a real database, an authorized operator runs:

```
psql "$TARGET_URL" -f docs/migration-preflight.sql
```

It is 100% read-only (no DDL/DML, no `resolve`, no customer/PII/financial rows).
Classify the target from its `m4_checksum_class` and `has_prisma_migrations`
output, then follow the matching class below.

| `m4_checksum_class`        | Class | Rollout |
|----------------------------|-------|---------|
| `NO_HISTORY`               | A or B | GO (supported) |
| `M4_NOT_RECORDED`          | B (partial) | GO with per-object verification |
| `CORRECTED_M4_RECORDED`    | already adopted | no-op |
| `ORIGINAL_M4_RECORDED`     | C | **BLOCKED** — separate approval |
| any `failed_or_partial`    | D | **BLOCKED** — manual recovery first |
| drift in object inventory  | E | **BLOCKED** — investigate first |

## 2. Bookkeeping vs DDL — read this first

- `migrate deploy` **executes SQL** (DDL) for every pending migration.
- `migrate resolve --applied <name>` is **bookkeeping only** — it records a
  migration as applied and runs **no SQL**. It is NOT a rollback and is **not
  evidence that the migration's SQL ever executed**. Only use it when the target
  objects already exist and have been structurally verified (preflight §6–§9).
- Always verify structure (preflight object inventory / `migrate diff`) **after**
  bootstrap. `migrate status` reporting "up to date" does **not** prove the
  schema is complete (a DB with all migrations marked applied but zero tables
  still reports "up to date").

## 3. Class A — fresh / empty database

Preconditions: `has_prisma_migrations=false`, 0 application tables.

```
# Backup is trivial (empty), but snapshot anyway if the instance is shared.
prisma migrate deploy        # applies baseline + 7 (corrected M4 runs cleanly)
# Verify:
psql "$DB" -f docs/migration-preflight.sql   # expect 21/21 tables, 3 indexes, PII cols
```

Rollback: drop the database (it was empty). GO.

## 4. Class B — existing `db-push` database, no migration history

Preconditions: `has_prisma_migrations=false`, schema already present (21/21),
object inventory matches (note: `employees_phoneHash_idx` may be **missing** on
db-push origin — see §8).

```
# 1. BACKUP (pg_dump) — mandatory; resolve is reversible, DDL fixes are not.
# 2. Adopt the history WITHOUT re-running its SQL (schema already exists):
prisma migrate resolve --applied 00000000000000_baseline
prisma migrate resolve --applied 20260523000001_pii_encryption_a7
#   … resolve each of the remaining historical migrations …
prisma migrate resolve --applied 20261024000001_pii_phone_email_encrypted_columns
# 3. Verify: migrate status = up to date AND migrate diff (DB vs schema) empty.
```

Rollback: delete the rows this adds to `_prisma_migrations` is **operator-only**
and requires separate approval; prefer restoring the pre-adoption backup. GO
once §8 (phoneHash index) is reconciled per the authorized decision.

## 5. Class C — database that recorded the ORIGINAL M4 checksum — **BLOCKED**

The corrected M4 file (`4167a4a0…`) differs from the recorded original
(`31a7898e…`). Verified consequences (disposable synthetic):

- `migrate deploy` and `migrate status` **tolerate** the mismatch (Prisma does
  not re-validate already-applied checksums). **This does NOT make the mismatch
  acceptable** — it is a silent divergence between recorded history and files.
- `migrate dev` flags the modified migration.
- `migrate resolve --applied` on it returns **P3008** and does **not** update the
  stored checksum. **No supported command repairs an applied checksum.**

→ **BLOCKED for automatic adoption.** Such environments require a separately
approved migration-history reconciliation (e.g., a controlled, backed-up,
operator-run re-baseline). **Do not** edit `_prisma_migrations` directly and
**do not** reset the database as the default remedy.

## 6. Class D — failed / partially-applied migration history — **BLOCKED**

Preflight shows a `failed_or_partial` migration. Recover manually first:

```
# Investigate the failed migration; confirm which objects exist.
prisma migrate resolve --rolled-back <failed_migration_name>
# Re-assess class (A–C) with the corrected history, then proceed. Manual, gated.
```

GO only after recovery + re-classification + separate approval.

## 7. Class E — unexpected schema drift — **BLOCKED**

`migrate diff` (DB vs `schema.prisma`) is non-empty for reasons other than the
known `employees_phoneHash_idx` case. STOP and investigate; do not adopt.

## 8. The `employees_phoneHash_idx` reconciliation

- Declared in `schema.prisma` and created by the baseline (name
  `employees_phoneHash_idx`, matching the A.7 migration).
- A `db-push`-origin DB will **lack** this index (db push never created it,
  because it was previously undeclared). Preflight `relevant_indexes.missing`
  reports it.
- **Do not auto-create or drop it.** Whether to build it on an existing
  populated DB is a separate, approved decision (building a plain index takes a
  write-blocking lock; use `CREATE INDEX CONCURRENTLY` out-of-band if needed —
  that manual operation is NOT this migration).

## 9. Locking / operational note on corrected M4

The corrected M4 uses plain `CREATE INDEX IF NOT EXISTS`. On fresh/empty tables
(bootstrap) this is instant; where the index already exists it is a no-op. A
plain `CREATE INDEX` takes a lock that **blocks writes** while building, so the
corrected M4 must **never** be executed against a large, already-populated table
that still lacks the index. In the supported bootstrap paths it never is.

## 10. Rollback & disaster recovery

- Bookkeeping (`resolve`) changes are logically reversible but should be undone
  by restoring a backup, not by hand-editing `_prisma_migrations`.
- Always `pg_dump` before any real adoption. The corrected M4 and baseline
  introduce no destructive DDL (all `IF NOT EXISTS` / additive).
- For DR rebuild of a fresh instance, use Class A.

## 11. Explicit remaining release blockers

1. Real production / staging / DR migration state is **NOT VERIFIED** — run the
   preflight (§1) under authorization first.
2. Any `ORIGINAL_M4_RECORDED` (Class C) environment needs a separately approved
   history reconciliation.
3. This change is **feature-branch only**: do not merge or deploy until 1–2 are
   resolved and sign-off is given. FlexPay is **NOT production-ready**.
