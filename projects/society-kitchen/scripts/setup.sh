#!/usr/bin/env bash
# Creates a fresh development database with the schema and demo data.
#   ADMIN_URL=postgres://user@host:port/postgres DB=society_kitchen scripts/setup.sh
# Needs `psql` and a Postgres superuser. WARNING: drops and recreates $DB.
set -euo pipefail
cd "$(dirname "$0")/.."
ADMIN_URL=${ADMIN_URL:-postgres://pgtest@127.0.0.1:54329/postgres}
DB=${DB:-society_kitchen}
DB_URL="${ADMIN_URL%/*}/$DB"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "drop database if exists \"$DB\" with (force)" -c "create database \"$DB\""
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/dev_roles.sql
for f in supabase/migrations/*.sql; do psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"; done
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql >/dev/null
echo "Database ready: $DB_URL"
