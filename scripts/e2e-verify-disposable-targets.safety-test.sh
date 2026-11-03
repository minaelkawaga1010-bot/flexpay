#!/usr/bin/env bash
#
# Adversarial negative tests for the E2E disposable-target isolation gate
# (TASK-018.4B-I9D). Proves the structural, per-URL guard fails closed on every
# unsafe target and — crucially — that a valid value in one DB variable can
# never MASK an unsafe value in the other (the weakness in the old
# concatenated-string guard).
#
# The guard performs NO database operation, so every rejection here happens
# BEFORE any database could be created or modified; this harness needs no
# database, cache, or service of any kind.
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$HERE/e2e-verify-disposable-targets.sh"

# Canonical legitimate disposable configuration (mirrors the e2e CI job).
OK_DB='postgresql://postgres:postgres@127.0.0.1:5432/flexpay_e2e?schema=public'
OK_BF='postgresql://postgres:postgres@127.0.0.1:5432/flexpay_e2e_bf?schema=public'
OK_REDIS='redis://127.0.0.1:6379'
SECRET_CANARY='P4SSWORD_LEAK_CANARY'

PASS=0
FAIL=0
LAST_OUT=''

# Run the guard with a CLEAN slate for the four governed variables, plus only
# the assignments passed as arguments. Captures combined output + exit code.
run_guard() {
  LAST_OUT="$(env -u DATABASE_URL -u BACKFILL_DATABASE_URL -u REDIS_URL -u E2E_TEST_DISPOSABLE \
    "$@" bash "$GUARD" 2>&1)"
  return $?
}

expect() {
  local want="$1" desc="$2"
  shift 2
  run_guard "$@"
  local got=$?
  if [ "$got" -eq "$want" ]; then
    echo "✅ $desc (exit $got)"
    PASS=$((PASS + 1))
  else
    echo "❌ $desc (want exit $want, got $got)"
    echo "   output: $LAST_OUT"
    FAIL=$((FAIL + 1))
  fi
}

echo "── Legitimate disposable configuration must PASS ──"
expect 0 'canonical disposable config accepted' \
  "E2E_TEST_DISPOSABLE=1" "DATABASE_URL=$OK_DB" "BACKFILL_DATABASE_URL=$OK_BF" "REDIS_URL=$OK_REDIS"

echo "── Disposability assertion ──"
expect 1 'missing E2E_TEST_DISPOSABLE refused' \
  "DATABASE_URL=$OK_DB" "BACKFILL_DATABASE_URL=$OK_BF" "REDIS_URL=$OK_REDIS"
expect 1 'E2E_TEST_DISPOSABLE=0 refused' \
  "E2E_TEST_DISPOSABLE=0" "DATABASE_URL=$OK_DB" "BACKFILL_DATABASE_URL=$OK_BF" "REDIS_URL=$OK_REDIS"

echo "── Missing targets ──"
expect 1 'missing DATABASE_URL refused' \
  "E2E_TEST_DISPOSABLE=1" "BACKFILL_DATABASE_URL=$OK_BF" "REDIS_URL=$OK_REDIS"
expect 1 'missing BACKFILL_DATABASE_URL refused' \
  "E2E_TEST_DISPOSABLE=1" "DATABASE_URL=$OK_DB" "REDIS_URL=$OK_REDIS"
expect 1 'missing REDIS_URL refused' \
  "E2E_TEST_DISPOSABLE=1" "DATABASE_URL=$OK_DB" "BACKFILL_DATABASE_URL=$OK_BF"

echo "── Malformed / wrong structure ──"
expect 1 'malformed DATABASE_URL (not a url) refused' \
  "E2E_TEST_DISPOSABLE=1" "DATABASE_URL=not-a-url" "BACKFILL_DATABASE_URL=$OK_BF" "REDIS_URL=$OK_REDIS"
expect 1 'DATABASE_URL without explicit host:port refused' \
  "E2E_TEST_DISPOSABLE=1" "DATABASE_URL=postgresql:///flexpay_e2e" "BACKFILL_DATABASE_URL=$OK_BF" "REDIS_URL=$OK_REDIS"

echo "── Wrong database name ──"
expect 1 'wrong primary db name refused' \
  "E2E_TEST_DISPOSABLE=1" "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/flexpay_e2e_wrong" "BACKFILL_DATABASE_URL=$OK_BF" "REDIS_URL=$OK_REDIS"
expect 1 'wrong backfill db name refused' \
  "E2E_TEST_DISPOSABLE=1" "DATABASE_URL=$OK_DB" "BACKFILL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/flexpay_e2e" "REDIS_URL=$OK_REDIS"

echo "── Production / staging / external host ──"
expect 1 'production host refused' \
  "E2E_TEST_DISPOSABLE=1" "DATABASE_URL=postgresql://u:p@db.prod.flexpay.internal:5432/flexpay_e2e" "BACKFILL_DATABASE_URL=$OK_BF" "REDIS_URL=$OK_REDIS"
expect 1 'staging host refused' \
  "E2E_TEST_DISPOSABLE=1" "DATABASE_URL=postgresql://u:p@staging-db.flexpay.io:5432/flexpay_e2e" "BACKFILL_DATABASE_URL=$OK_BF" "REDIS_URL=$OK_REDIS"
expect 1 'external (RDS) host refused' \
  "E2E_TEST_DISPOSABLE=1" "DATABASE_URL=postgresql://u:p@db.abcdef.us-east-1.rds.amazonaws.com:5432/flexpay_e2e" "BACKFILL_DATABASE_URL=$OK_BF" "REDIS_URL=$OK_REDIS"

echo "── Wrong ports / redis target ──"
expect 1 'wrong postgres port refused' \
  "E2E_TEST_DISPOSABLE=1" "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/flexpay_e2e" "BACKFILL_DATABASE_URL=$OK_BF" "REDIS_URL=$OK_REDIS"
expect 1 'wrong redis host refused' \
  "E2E_TEST_DISPOSABLE=1" "DATABASE_URL=$OK_DB" "BACKFILL_DATABASE_URL=$OK_BF" "REDIS_URL=redis://10.0.0.5:6379"
expect 1 'wrong redis port refused' \
  "E2E_TEST_DISPOSABLE=1" "DATABASE_URL=$OK_DB" "BACKFILL_DATABASE_URL=$OK_BF" "REDIS_URL=redis://127.0.0.1:6380"

echo "── Masking: a valid value must not hide an unsafe one (the old weakness) ──"
expect 1 'valid primary + external backfill refused (no masking)' \
  "E2E_TEST_DISPOSABLE=1" "DATABASE_URL=$OK_DB" "BACKFILL_DATABASE_URL=postgresql://u:p@db.abcdef.us-east-1.rds.amazonaws.com:5432/flexpay_e2e_bf" "REDIS_URL=$OK_REDIS"
expect 1 'external primary + valid backfill refused (no masking)' \
  "E2E_TEST_DISPOSABLE=1" "DATABASE_URL=postgresql://u:p@db.abcdef.us-east-1.rds.amazonaws.com:5432/flexpay_e2e" "BACKFILL_DATABASE_URL=$OK_BF" "REDIS_URL=$OK_REDIS"
expect 1 'backfill identical to primary refused' \
  "E2E_TEST_DISPOSABLE=1" "DATABASE_URL=$OK_DB" "BACKFILL_DATABASE_URL=$OK_DB" "REDIS_URL=$OK_REDIS"

echo "── The guard must perform NO database operation (fails before any DB I/O) ──"
if grep -Eq '\b(psql|createdb|dropdb|pg_dump|prisma|db[[:space:]]+push|DROP[[:space:]]+DATABASE|CREATE[[:space:]]+DATABASE)\b' "$GUARD"; then
  echo "❌ guard contains a database operation"
  FAIL=$((FAIL + 1))
else
  echo "✅ guard contains no database operation (pure validation; cannot create/modify a DB)"
  PASS=$((PASS + 1))
fi

echo "── No credential/secret leakage in guard output ──"
run_guard "E2E_TEST_DISPOSABLE=1" \
  "DATABASE_URL=postgresql://postgres:${SECRET_CANARY}@db.abcdef.us-east-1.rds.amazonaws.com:5432/flexpay_e2e" \
  "BACKFILL_DATABASE_URL=$OK_BF" "REDIS_URL=$OK_REDIS" || true
if printf '%s' "$LAST_OUT" | grep -q "$SECRET_CANARY"; then
  echo "❌ guard leaked a credential into its output (rejection path)"
  FAIL=$((FAIL + 1))
else
  echo "✅ guard did not echo the embedded credential (rejection path)"
  PASS=$((PASS + 1))
fi
run_guard "E2E_TEST_DISPOSABLE=1" \
  "DATABASE_URL=postgresql://postgres:${SECRET_CANARY}@127.0.0.1:5432/flexpay_e2e" \
  "BACKFILL_DATABASE_URL=$OK_BF" "REDIS_URL=$OK_REDIS" || true
if printf '%s' "$LAST_OUT" | grep -q "$SECRET_CANARY"; then
  echo "❌ guard leaked a credential on the success path"
  FAIL=$((FAIL + 1))
else
  echo "✅ guard success output carries no credential (success path)"
  PASS=$((PASS + 1))
fi

echo ""
echo "E2E TARGET SAFETY TESTS: $PASS passed, $FAIL failed"
if [ "$FAIL" -ne 0 ]; then
  echo "❌ E2E ISOLATION GUARD SAFETY TESTS FAILED"
  exit 1
fi
echo "🎉 ALL E2E ISOLATION GUARD SAFETY TESTS PASSED"
