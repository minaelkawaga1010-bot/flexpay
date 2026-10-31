#!/usr/bin/env bash
# ============================================================================
# Prisma migration lifecycle verification against REAL PostgreSQL (TASK-018.4B).
#
# Proves the committed migration history (baseline + 7 historical, corrected M4)
# supports the full Prisma lifecycle — fresh deploy · schema-diff parity ·
# migrate dev + shadow replay · a future migration · repeat deploy · object
# inventory. Fails CI (exit non-zero) if any invariant is violated.
#
# SAFETY (TASK-018.4B-I6): this runner can CREATE and DROP databases, so it
# refuses to run until it has POSITIVE proof the target PostgreSQL instance is
# a dedicated, disposable test instance, and it only ever drops databases it
# created THIS run (unique run-owned prefix). There is NO wildcard cleanup.
# Isolation gate (all required, fail-closed BEFORE any CREATE/DROP):
#   • MIGRATION_TEST_DISPOSABLE=1           (explicit operator/CI assertion)
#   • a provisioning sentinel database      (exists only on throwaway instances)
#   • the application DATABASE_URL must NOT be set (no app-credential reuse)
# Connection comes from dedicated PG* vars, never the app DATABASE_URL.
#   PGHOST(127.0.0.1) PGPORT(5432) PGUSER(postgres) PGPASSWORD PGADMINDB(postgres)
# ============================================================================
set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"; PGADMINDB="${PGADMINDB:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
SENTINEL_DB="${MIGRATION_TEST_SENTINEL_DB:-flexpay_migtest_sentinel}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRISMA="$ROOT/node_modules/.bin/prisma"

fail() { echo "❌ LIFECYCLE FAIL: $1" >&2; exit 1; }
PSQL() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGADMINDB" -tAq "$@"; }
dbq() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$1" -tAq -c "$2"; }
url() { echo "postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/$1?schema=public"; }

# ───────────────────────── ISOLATION GATE (fail-closed) ─────────────────────
# Reject application-credential reuse.
[ -z "${DATABASE_URL:-}" ] || fail "DATABASE_URL is set — this runner refuses application credentials. Use dedicated PGHOST/PGPORT/PGUSER/PGPASSWORD for a disposable instance and unset DATABASE_URL."
# Require an explicit disposability assertion.
[ "${MIGRATION_TEST_DISPOSABLE:-0}" = "1" ] || fail "refusing: set MIGRATION_TEST_DISPOSABLE=1 only on a dedicated disposable PostgreSQL instance."
# Must be able to reach the instance.
PSQL -c "SELECT 1;" >/dev/null 2>&1 || fail "cannot connect to the test PostgreSQL instance at ${PGHOST}:${PGPORT}."
# Positive provisioning proof: a sentinel DB created ONLY on throwaway instances.
[ "$(PSQL -c "SELECT 1 FROM pg_database WHERE datname='${SENTINEL_DB}';")" = "1" ] \
  || fail "provisioning sentinel database '${SENTINEL_DB}' not found — the target instance is not positively provisioned for disposable migration tests. Create it ONLY on a throwaway instance."
echo "✅ isolation gate passed (disposable instance, sentinel present, no DATABASE_URL)"

# ───────────────────────── run-owned identity + cleanup ─────────────────────
RUN_ID="$( (cat /proc/sys/kernel/random/uuid 2>/dev/null | tr -d '-' | cut -c1-16) || echo "$$${RANDOM}" )"
PFX="flexpay_migtest_${RUN_ID}"
DBS=()
TMP="$(mktemp -d)"
# Only ever touch databases whose name carries THIS run's exact unique prefix.
owned() { case "$1" in ${PFX}_*) return 0;; *) return 1;; esac; }
dropdb_owned() { owned "$1" || { echo "⚠ refusing to drop non-owned database '$1'" >&2; return 0; }; PSQL -c "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE);" >/dev/null 2>&1 || true; }
newdb() { owned "$1" || fail "internal: refusing to create non-owned name '$1'"; dropdb_owned "$1"; PSQL -c "CREATE DATABASE \"$1\";" >/dev/null; DBS+=("$1"); }
cleanup() { for d in "${DBS[@]:-}"; do dropdb_owned "$d"; done; rm -rf "$TMP" 2>/dev/null || true; }
# EXIT covers normal/error exit; INT/TERM ensure an interrupted run still drops
# ONLY its own run-owned databases (never anything else).
trap 'cleanup' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cp -r "$ROOT/prisma" "$TMP/prisma"
SCHEMA="$TMP/prisma/schema.prisma"
# Use an OWNED, explicitly-named shadow DB (no Prisma auto-created prisma_migrate_shadow_* → no wildcard cleanup).
sed -i '/url *= env("DATABASE_URL")/a\  shadowDatabaseUrl = env("SHADOW_DATABASE_URL")' "$SCHEMA"
echo "▶ run id ${RUN_ID}; migrations: $(ls -1 "$TMP/prisma/migrations" | grep -v migration_lock | tr '\n' ' ')"

# 1) Fresh deploy of the WHOLE history from empty (exercises corrected M4).
newdb "${PFX}_fresh"
DATABASE_URL="$(url ${PFX}_fresh)" "$PRISMA" migrate deploy --schema "$SCHEMA" >/dev/null \
  || fail "fresh migrate deploy failed (M4 25001 / P3006?)"
echo "✅ fresh migrate deploy"

# 2) Structural parity: DB must equal schema.prisma (no drift).
#    `migrate diff --exit-code` exits 0 when there is NO difference, non-zero
#    (2 = diff, 1 = error) otherwise — so fail on any non-zero.
DATABASE_URL="$(url ${PFX}_fresh)" "$PRISMA" migrate diff \
  --from-url "$(url ${PFX}_fresh)" --to-schema-datamodel "$SCHEMA" --exit-code >/dev/null 2>&1 \
  || fail "schema drift: deployed DB != schema.prisma"
echo "✅ schema parity (no drift)"

# 3) Object inventory.
T=$(dbq "${PFX}_fresh" "select count(*) from information_schema.tables where table_schema='public' and table_name<>'_prisma_migrations';")
[ "$T" = "21" ] || fail "expected 21 tables, got $T"
for idx in employees_phoneHash_idx advances_status_requestedAt_idx payroll_cycles_status_periodEnd_idx; do
  [ "$(dbq "${PFX}_fresh" "select count(*) from pg_indexes where indexname='$idx';")" = "1" ] || fail "missing index $idx"
done
P=$(dbq "${PFX}_fresh" "select count(*) from information_schema.columns where table_name='employees' and column_name in ('phoneEncrypted','emailEncrypted','emailHash');")
[ "$P" = "3" ] || fail "expected 3 TASK-018.1 PII columns, got $P"
echo "✅ object inventory (21 tables, phoneHash+perf indexes, PII columns)"

# 4) migrate dev + shadow replay against an OWNED shadow DB.
newdb "${PFX}_dev"; newdb "${PFX}_shadow"
DATABASE_URL="$(url ${PFX}_dev)" "$PRISMA" migrate deploy --schema "$SCHEMA" >/dev/null
BEFORE=$(ls -1 "$TMP/prisma/migrations" | grep -cv migration_lock)
OUT=$(DATABASE_URL="$(url ${PFX}_dev)" SHADOW_DATABASE_URL="$(url ${PFX}_shadow)" \
      "$PRISMA" migrate dev --name _ci_sync --skip-generate --schema "$SCHEMA" 2>&1) \
  || { echo "$OUT" | grep -qiE '25001|P3006' && fail "migrate dev shadow replay hit CONCURRENTLY/25001"; fail "migrate dev failed: $(echo "$OUT" | tail -1)"; }
echo "$OUT" | grep -qi "Already in sync" || fail "migrate dev did not report in-sync (drift?)"
AFTER=$(ls -1 "$TMP/prisma/migrations" | grep -cv migration_lock)
[ "$BEFORE" = "$AFTER" ] || fail "migrate dev created an unexpected migration (drift)"
# Prisma must NOT have auto-created any prisma_migrate_shadow_* DB (we supplied one).
[ "$(PSQL -c "select count(*) from pg_database where datname like 'prisma_migrate_shadow%';")" = "0" ] \
  || echo "⚠ note: a prisma_migrate_shadow_* DB exists on the instance (not created/owned by this run; left untouched)"
echo "✅ migrate dev + shadow replay (owned shadow DB, in sync, no drift, no 25001)"

# 5) Future migration: a harmless additive model must create + deploy cleanly.
cat >> "$SCHEMA" <<'EOF'

model CiLifecycleProbe {
  id        String   @id @default(uuid())
  createdAt DateTime @default(now())
  @@map("ci_lifecycle_probe")
}
EOF
DATABASE_URL="$(url ${PFX}_dev)" SHADOW_DATABASE_URL="$(url ${PFX}_shadow)" \
  "$PRISMA" migrate dev --name ci_future_probe --skip-generate --schema "$SCHEMA" >/dev/null \
  || fail "future migrate dev failed"
ls -1 "$TMP/prisma/migrations" | grep -q ci_future_probe || fail "future migration not created"
newdb "${PFX}_fresh2"
DATABASE_URL="$(url ${PFX}_fresh2)" "$PRISMA" migrate deploy --schema "$SCHEMA" >/dev/null \
  || fail "deploy of full history + future migration failed"
[ "$(dbq "${PFX}_fresh2" "select count(*) from information_schema.tables where table_name='ci_lifecycle_probe';")" = "1" ] \
  || fail "future table not present after deploy"
echo "✅ future migration create + deploy"

# 6) Repeat deploy is a no-op.
DATABASE_URL="$(url ${PFX}_fresh2)" "$PRISMA" migrate deploy --schema "$SCHEMA" 2>&1 | grep -qi "No pending migrations" \
  || fail "repeat deploy was not a no-op"
echo "✅ repeat deploy (no pending)"

echo "🎉 MIGRATION LIFECYCLE: ALL INVARIANTS PASSED (run ${RUN_ID})"
