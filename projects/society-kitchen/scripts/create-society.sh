#!/usr/bin/env bash
# Adds your society and prints its invite link.
#   DATABASE_URL=... scripts/create-society.sh "Harmony Residency" HARMONY-123 https://your-app.onrender.com
# The invite code is the key to your society: anyone with it can join. To change it later:
#   psql "$DATABASE_URL" -c "update societies set invite_code = 'NEW-CODE' where invite_code = 'OLD-CODE'"
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
NAME=${1:?Usage: create-society.sh "Society name" INVITE-CODE [app url]}
CODE=${2:?Usage: create-society.sh "Society name" INVITE-CODE [app url]}
URL=${3:-https://YOUR-APP-URL}
if [ "${#CODE}" -lt 8 ]; then echo "Use an invite code of at least 8 characters (e.g. HARMONY-7QX4K): it is the only thing keeping outsiders out." >&2; exit 1; fi
# (psql only substitutes :'name' variables when the SQL comes from stdin, which also keeps quotes in names safe)
echo "insert into societies (name, invite_code) values (:'name', :'code')" \
  | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -v name="$NAME" -v code="$CODE"
echo "Created \"$NAME\". Invite link to share in your group:"
echo "$URL/?join=$CODE"
