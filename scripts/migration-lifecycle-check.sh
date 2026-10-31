#!/usr/bin/env bash
# ============================================================================
# Prisma migration lifecycle verification against REAL PostgreSQL (TASK-018.4B).
#
# Proves the committed migration history (baseline + 7 historical, with the
# corrected M4) supports the full Prisma lifecycle — NOT just `migrate deploy`:
#   fresh deploy · schema-diff parity · migrate dev + shadow replay · a future
#   migration · repeat deploy (no pending) · expected object inventory.
#
# Disposable synthetic databases only. Creates and drops its own test DBs; runs
# `migrate dev` against a TEMP copy of prisma/ so it can never write into the
# repo. Exits non-zero (fails CI) if any lifecycle invariant is violated.
#
# Config via env (defaults suit the GitHub postgres service / local throwaway):
#   PGHOST(127.0.0.1) PGPORT(5432) PGUSER(postgres) PGPASSWORD PGADMINDB(postgres)
# ============================================================================
set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"; PGADMINDB="${PGADMINDB:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRISMA="$ROOT/node_modules/.bin/prisma"
PFX="mig_lc_$$"
PSQL() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGADMINDB" -tAq "$@"; }
url() { echo "postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/$1?schema=public"; }
dbq() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$1" -tAq -c "$2"; }
fail() { echo "❌ LIFECYCLE FAIL: $1"; exit 1; }
DBS=()
newdb() { PSQL -c "DROP DATABASE IF EXISTS $1;" >/dev/null; PSQL -c "CREATE DATABASE $1;" >/dev/null; DBS+=("$1"); }
cleanup() { for d in "${DBS[@]:-}"; do PSQL -c "DROP DATABASE IF EXISTS $d;" >/dev/null 2>&1 || true; done
  PSQL -c "SELECT datname FROM pg_database WHERE datname LIKE 'prisma_migrate_shadow%';" 2>/dev/null | while read -r s; do [ -n "$s" ] && PSQL -c "DROP DATABASE IF EXISTS \"$s\";" >/dev/null 2>&1 || true; done
  rm -rf "$TMP" 2>/dev/null || true; }
trap cleanup EXIT

TMP="$(mktemp -d)"; cp -r "$ROOT/prisma" "$TMP/prisma"
SCHEMA="$TMP/prisma/schema.prisma"
echo "▶ migrations in history: $(ls -1 "$TMP/prisma/migrations" | grep -v migration_lock | tr '\n' ' ')"

# 1) Fresh deploy of the WHOLE history from empty (exercises corrected M4).
newdb "${PFX}_fresh"
DATABASE_URL="$(url ${PFX}_fresh)" "$PRISMA" migrate deploy --schema "$SCHEMA" >/dev/null \
  || fail "fresh migrate deploy failed (M4 25001 / P3006?)"
echo "✅ fresh migrate deploy"

# 2) Structural parity: DB must equal schema.prisma (no drift). --exit-code: 0=equal.
if ! DATABASE_URL="$(url ${PFX}_fresh)" "$PRISMA" migrate diff \
      --from-url "$(url ${PFX}_fresh)" --to-schema-datamodel "$SCHEMA" --exit-code >/dev/null 2>&1; then
  fail "schema drift: deployed DB != schema.prisma"
fi
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

# 4) migrate dev + shadow replay: must be "in sync" and create NO new migration.
newdb "${PFX}_dev"
DATABASE_URL="$(url ${PFX}_dev)" "$PRISMA" migrate deploy --schema "$SCHEMA" >/dev/null
BEFORE=$(ls -1 "$TMP/prisma/migrations" | grep -cv migration_lock)
OUT=$(DATABASE_URL="$(url ${PFX}_dev)" "$PRISMA" migrate dev --name _ci_sync --skip-generate --schema "$SCHEMA" 2>&1) \
  || { echo "$OUT" | grep -qiE '25001|P3006' && fail "migrate dev shadow replay hit CONCURRENTLY/25001"; fail "migrate dev failed: $(echo "$OUT" | tail -1)"; }
echo "$OUT" | grep -qi "Already in sync" || fail "migrate dev did not report in-sync (drift?)"
AFTER=$(ls -1 "$TMP/prisma/migrations" | grep -cv migration_lock)
[ "$BEFORE" = "$AFTER" ] || fail "migrate dev created an unexpected migration (drift)"
echo "✅ migrate dev + shadow replay (in sync, no drift, no 25001)"

# 5) Future migration: a harmless additive model must create + deploy cleanly.
cat >> "$SCHEMA" <<'EOF'

model CiLifecycleProbe {
  id        String   @id @default(uuid())
  createdAt DateTime @default(now())
  @@map("ci_lifecycle_probe")
}
EOF
DATABASE_URL="$(url ${PFX}_dev)" "$PRISMA" migrate dev --name ci_future_probe --skip-generate --schema "$SCHEMA" >/dev/null \
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

echo "🎉 MIGRATION LIFECYCLE: ALL INVARIANTS PASSED"
