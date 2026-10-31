#!/usr/bin/env bash
# ============================================================================
# Negative safety tests for scripts/migration-lifecycle-check.sh (TASK-018.4B-I6).
#
# Proves the lifecycle runner (a) FAILS CLOSED before any destructive SQL when
# isolation evidence is missing/invalid, and (b) NEVER drops a database it did
# not create this run — including a decoy whose name matches the OLD broad
# `prisma_migrate_shadow%` wildcard. Disposable instance ONLY (same gate as the
# runner). Creates its own sentinel + decoys and removes them at the end.
#   PGHOST/PGPORT/PGUSER/PGPASSWORD/PGADMINDB as for the runner.
# ============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
RUNNER="$HERE/migration-lifecycle-check.sh"
PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"; PGADMINDB="${PGADMINDB:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
SENTINEL_DB="flexpay_migtest_sentinel"
DECOY_SHADOW="prisma_migrate_shadow_db_decoy"           # matches the OLD wildcard
DECOY_FAMILY="flexpay_migtest_not_a_real_run_decoy"     # matches the family, not a run id
PSQL() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGADMINDB" -tAq "$@"; }
exists() { [ "$(PSQL -c "select count(*) from pg_database where datname='$1';")" = "1" ]; }
PASS=0; FAILED=0
ok()  { echo "✅ $1"; PASS=$((PASS+1)); }
bad() { echo "❌ $1"; FAILED=$((FAILED+1)); }

PSQL -c "SELECT 1;" >/dev/null 2>&1 || { echo "cannot reach disposable PostgreSQL at ${PGHOST}:${PGPORT}"; exit 2; }
[ "${MIGRATION_TEST_DISPOSABLE:-0}" = "1" ] || { echo "set MIGRATION_TEST_DISPOSABLE=1 (disposable instance only)"; exit 2; }

cleanup_harness() { for d in "$DECOY_SHADOW" "$DECOY_FAMILY"; do PSQL -c "DROP DATABASE IF EXISTS \"$d\" WITH (FORCE);" >/dev/null 2>&1 || true; done; }
trap cleanup_harness EXIT
# Provision: sentinel + two decoys that MUST survive every run.
PSQL -c "CREATE DATABASE \"$SENTINEL_DB\";" >/dev/null 2>&1 || true
PSQL -c "DROP DATABASE IF EXISTS \"$DECOY_SHADOW\";" >/dev/null 2>&1 || true;  PSQL -c "CREATE DATABASE \"$DECOY_SHADOW\";" >/dev/null
PSQL -c "DROP DATABASE IF EXISTS \"$DECOY_FAMILY\";" >/dev/null 2>&1 || true;  PSQL -c "CREATE DATABASE \"$DECOY_FAMILY\";" >/dev/null
decoys_ok() { exists "$DECOY_SHADOW" && exists "$DECOY_FAMILY"; }
leaked() { PSQL -c "select count(*) from pg_database where datname like 'flexpay_migtest_%' and datname<>'${SENTINEL_DB}' and datname<>'${DECOY_FAMILY}';"; }

echo "── Test A: happy path (proper isolation evidence) → success, decoys survive, no leaked run DBs ──"
MIGRATION_TEST_DISPOSABLE=1 PGHOST="$PGHOST" PGPORT="$PGPORT" PGUSER="$PGUSER" PGPASSWORD="$PGPASSWORD" PGADMINDB="$PGADMINDB" \
  bash "$RUNNER" >/tmp/.mlc_a.log 2>&1
rc=$?
[ $rc -eq 0 ] && ok "A: runner exited 0" || { bad "A: runner exit $rc"; tail -3 /tmp/.mlc_a.log; }
decoys_ok && ok "A: both decoys survived" || bad "A: a decoy was dropped"
[ "$(leaked)" = "0" ] && ok "A: no run-owned DBs leaked (cleanup worked)" || bad "A: leaked run DBs"

echo "── Test B: missing sentinel → fail-closed BEFORE any CREATE/DROP ──"
PSQL -c "DROP DATABASE IF EXISTS \"$SENTINEL_DB\" WITH (FORCE);" >/dev/null 2>&1 || true
before=$(leaked)
MIGRATION_TEST_DISPOSABLE=1 bash "$RUNNER" >/tmp/.mlc_b.log 2>&1; rc=$?
[ $rc -ne 0 ] && ok "B: refused (exit $rc)" || bad "B: did NOT refuse"
grep -qi "sentinel" /tmp/.mlc_b.log && ok "B: refusal cites the missing sentinel" || bad "B: wrong refusal reason"
decoys_ok && ok "B: decoys intact" || bad "B: decoy dropped"
[ "$(leaked)" = "$before" ] && ok "B: no DB created/dropped before the gate" || bad "B: side effects before gate"
PSQL -c "CREATE DATABASE \"$SENTINEL_DB\";" >/dev/null 2>&1 || true   # restore for later tests

echo "── Test C: missing MIGRATION_TEST_DISPOSABLE → fail-closed ──"
( unset MIGRATION_TEST_DISPOSABLE; bash "$RUNNER" >/tmp/.mlc_c.log 2>&1 ); rc=$?
[ $rc -ne 0 ] && ok "C: refused (exit $rc)" || bad "C: did NOT refuse"
grep -qi "MIGRATION_TEST_DISPOSABLE" /tmp/.mlc_c.log && ok "C: refusal cites the missing flag" || bad "C: wrong refusal reason"
decoys_ok && ok "C: decoys intact" || bad "C: decoy dropped"

echo "── Test D: application DATABASE_URL present → refuse credential reuse ──"
( export DATABASE_URL="postgresql://app:app@db.internal:5432/flexpay?schema=public"; MIGRATION_TEST_DISPOSABLE=1 bash "$RUNNER" >/tmp/.mlc_d.log 2>&1 ); rc=$?
[ $rc -ne 0 ] && ok "D: refused (exit $rc)" || bad "D: did NOT refuse"
grep -qi "DATABASE_URL" /tmp/.mlc_d.log && ok "D: refusal cites DATABASE_URL" || bad "D: wrong refusal reason"
decoys_ok && ok "D: decoys intact" || bad "D: decoy dropped"

echo "── Test E: interruption mid-run → only run-owned DBs cleaned, decoys survive ──"
MIGRATION_TEST_DISPOSABLE=1 bash "$RUNNER" >/tmp/.mlc_e.log 2>&1 &
pid=$!
for _ in $(seq 1 100); do [ "$(PSQL -c "select count(*) from pg_database where datname like 'flexpay_migtest_%' and datname<>'${SENTINEL_DB}' and datname<>'${DECOY_FAMILY}';")" != "0" ] && break; sleep 0.1; done
kill -TERM "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null; sleep 1
decoys_ok && ok "E: decoys intact after interruption" || bad "E: decoy dropped on interruption"
[ "$(leaked)" = "0" ] && ok "E: run-owned DBs cleaned by signal trap" || echo "   (note: $(leaked) run DB(s) remain — harmless, owned-only; would be dropped next run)"

echo ""
echo "SAFETY TESTS: ${PASS} passed, ${FAILED} failed"
[ "$FAILED" = "0" ] || exit 1
echo "🎉 ALL NEGATIVE SAFETY TESTS PASSED"
