#!/usr/bin/env bash
# Local runner for the native PostgreSQL auto-link concurrency suite.
# Requires a reachable PostgreSQL server (CI uses a disposable postgres:18 service).
#
#   TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/autolink_ci bash scripts/native-pg-test.sh
set -euo pipefail
if [ -z "${TEST_DATABASE_URL:-}" ]; then
  echo "TEST_DATABASE_URL is not set — the native suite would skip." >&2
  exit 1
fi
trap 'psql "$TEST_DATABASE_URL" -q -c "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA public;" >/dev/null 2>&1 || true' EXIT
bunx vitest run src/test/nativePgAutoLinkConcurrency.test.ts --reporter=verbose
