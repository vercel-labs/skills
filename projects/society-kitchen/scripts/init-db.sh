#!/usr/bin/env bash
# Sets up the schema on a hosted Postgres (Supabase, Neon, ...). Safe to re-run:
# it records which migration files were applied and skips them. It never drops anything
# and never loads demo data.
#   DATABASE_URL='postgres://user:pass@host:5432/dbname?sslmode=require' scripts/init-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?Set DATABASE_URL to your database connection string}"
psql_() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"; }

psql_ -c "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())"
# Supabase already has the anon/authenticated roles; on other hosts this creates them.
psql_ -f supabase/dev_roles.sql
# The role the server logs in as must be allowed to switch to `authenticated`.
psql_ -c "grant authenticated to current_user" 2>/dev/null || true

for f in supabase/migrations/*.sql; do
  name=$(basename "$f")
  if [ "$(psql_ -tA -c "select 1 from schema_migrations where name = '$name'")" = "1" ]; then
    echo "skip   $name"
  else
    psql_ --single-transaction -f "$f" -c "insert into schema_migrations (name) values ('$name')"
    echo "applied $name"
  fi
done
echo "Database ready."
