#!/usr/bin/env bash
#
# E2E disposable-target isolation gate (TASK-018.4B-I9D).
#
# Structurally validates EACH database/cache connection target INDEPENDENTLY
# against the exact, hardcoded disposable GitHub Actions service-container
# targets, then fails closed on any mismatch. This replaces an earlier guard
# that matched a single `flexpay_e2e` marker against the TWO Postgres URLs
# CONCATENATED ("$DATABASE_URL $BACKFILL_DATABASE_URL") — where a correct value
# in one variable could MASK an unsafe value in the other.
#
# Properties:
#   * Pure validation: performs NO database or network operation whatsoever, so
#     it always runs (and fails) BEFORE any database is created or modified.
#   * Expected targets are HARDCODED here and never read from the environment,
#     so a hostile environment cannot relax them.
#   * Never echoes credentials or full URLs (only variable names + the parsed
#     host/port/db), so it cannot leak secrets into CI logs.
#
# This guards CI E2E test setup only; it does not affect application DB
# connection behavior outside CI.
#
set -euo pipefail

# ---- Exact expected disposable targets (HARDCODED; never taken from env) ----
readonly EXPECTED_PG_HOST='127.0.0.1'
readonly EXPECTED_PG_PORT='5432'
readonly EXPECTED_REDIS_HOST='127.0.0.1'
readonly EXPECTED_REDIS_PORT='6379'
readonly EXPECTED_DB_PRIMARY='flexpay_e2e'
readonly EXPECTED_DB_BACKFILL='flexpay_e2e_bf'

fail() { echo "refusing (E2E isolation gate): $*" >&2; exit 1; }

# (1) Explicit disposability assertion — necessary, but NOT sufficient on its
#     own (localhost + a test-looking name are never accepted as proof alone).
[ "${E2E_TEST_DISPOSABLE:-0}" = '1' ] \
  || fail 'E2E_TEST_DISPOSABLE != 1 (no explicit disposability assertion)'

# Reject shared/prod/staging markers anywhere in a target. Defense-in-depth with
# a clear message; the exact host/port/db checks below are the real gate. Prints
# only the variable NAME, never the target's contents.
reject_markers() {
  case "$1" in
    *prod*|*production*|*staging*|*preprod*)
      fail "$2 carries a forbidden environment marker (prod/staging)" ;;
  esac
}

# Structurally parse a postgres URL into "host|port|db". Returns non-zero for
# anything that is not exactly scheme://[creds@]host:port/db[?query]. An explicit
# host AND port AND database are all REQUIRED (no implicit defaults).
parse_pg_url() {
  local url="$1" rest authority path host port db
  case "$url" in
    postgresql://*) rest=${url#postgresql://} ;;
    postgres://*)   rest=${url#postgres://} ;;
    *) return 1 ;;
  esac
  rest=${rest%%#*}                                 # strip fragment
  case "$rest" in */*) : ;; *) return 1 ;; esac    # a /database is required
  authority=${rest%%/*}
  path=${rest#*/}
  db=${path%%\?*}                                  # database = path before query
  case "$authority" in *@*) authority=${authority##*@} ;; esac  # drop credentials
  case "$authority" in *:*) : ;; *) return 1 ;; esac            # explicit port required
  host=${authority%:*}
  port=${authority##*:}
  [ -n "$host" ] && [ -n "$port" ] && [ -n "$db" ] || return 1
  case "$port" in *[!0-9]*) return 1 ;; esac
  case "$host" in *[!a-zA-Z0-9._-]*) return 1 ;; esac
  case "$db"   in *[!a-zA-Z0-9_]*)   return 1 ;; esac
  printf '%s|%s|%s' "$host" "$port" "$db"
}

# Structurally parse a redis URL into "host|port".
parse_redis_url() {
  local url="$1" rest authority host port
  case "$url" in redis://*) rest=${url#redis://} ;; *) return 1 ;; esac
  rest=${rest%%#*}
  authority=${rest%%/*}                            # strip optional /db and query
  case "$authority" in *@*) authority=${authority##*@} ;; esac
  case "$authority" in *:*) : ;; *) return 1 ;; esac
  host=${authority%:*}
  port=${authority##*:}
  [ -n "$host" ] && [ -n "$port" ] || return 1
  case "$port" in *[!0-9]*) return 1 ;; esac
  case "$host" in *[!a-zA-Z0-9._-]*) return 1 ;; esac
  printf '%s|%s' "$host" "$port"
}

validate_pg() {
  local var="$1" url="${2:-}" want_db="$3" parsed host port db
  [ -n "$url" ] || fail "$var is empty or missing"
  reject_markers "$url" "$var"
  parsed=$(parse_pg_url "$url") \
    || fail "$var is not a well-formed postgres URL with explicit host:port/database"
  IFS='|' read -r host port db <<<"$parsed"
  [ "$host" = "$EXPECTED_PG_HOST" ] \
    || fail "$var host '$host' is not the disposable service host $EXPECTED_PG_HOST"
  [ "$port" = "$EXPECTED_PG_PORT" ] \
    || fail "$var port '$port' is not the disposable service port $EXPECTED_PG_PORT"
  [ "$db" = "$want_db" ] \
    || fail "$var database '$db' is not the required disposable database '$want_db'"
}

validate_redis() {
  local var="$1" url="${2:-}" parsed host port
  [ -n "$url" ] || fail "$var is empty or missing"
  reject_markers "$url" "$var"
  parsed=$(parse_redis_url "$url") \
    || fail "$var is not a well-formed redis URL with explicit host:port"
  IFS='|' read -r host port <<<"$parsed"
  [ "$host" = "$EXPECTED_REDIS_HOST" ] \
    || fail "$var host '$host' is not the disposable service host $EXPECTED_REDIS_HOST"
  [ "$port" = "$EXPECTED_REDIS_PORT" ] \
    || fail "$var port '$port' is not the disposable service port $EXPECTED_REDIS_PORT"
}

# (2) Validate EACH target INDEPENDENTLY — no concatenation. A valid value in one
#     variable can never satisfy the requirement for another.
validate_pg    'DATABASE_URL'          "${DATABASE_URL:-}"          "$EXPECTED_DB_PRIMARY"
validate_pg    'BACKFILL_DATABASE_URL' "${BACKFILL_DATABASE_URL:-}" "$EXPECTED_DB_BACKFILL"
validate_redis 'REDIS_URL'             "${REDIS_URL:-}"

# (3) Primary and backfill must be two DISTINCT disposable databases.
[ "${DATABASE_URL:-}" != "${BACKFILL_DATABASE_URL:-}" ] \
  || fail 'DATABASE_URL and BACKFILL_DATABASE_URL must be distinct disposable databases'

echo "E2E isolation gate PASSED (each target validated independently):"
echo "  DATABASE_URL          -> ${EXPECTED_PG_HOST}:${EXPECTED_PG_PORT}/${EXPECTED_DB_PRIMARY}"
echo "  BACKFILL_DATABASE_URL -> ${EXPECTED_PG_HOST}:${EXPECTED_PG_PORT}/${EXPECTED_DB_BACKFILL}"
echo "  REDIS_URL             -> ${EXPECTED_REDIS_HOST}:${EXPECTED_REDIS_PORT}"
echo "  E2E_TEST_DISPOSABLE=1; prod/staging/external/ambiguous targets rejected."
