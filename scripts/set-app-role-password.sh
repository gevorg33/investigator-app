#!/usr/bin/env bash
# Sets the runtime role's password from APP_DB_PASSWORD, connecting as the owner (T-073).
#
#   MIGRATION_DATABASE_URL=… APP_DB_PASSWORD=… ./scripts/set-app-role-password.sh
#
# Run after migrations wherever the database is not a throwaway local one: CI generates a
# random password every run and calls this; the production deploy (T-041) calls it with the
# secret. Local development keeps the default the migration sets, which never leaves a laptop.
#
# The password travels through the environment and psql's \getenv — never the command line,
# where `ps` would show it — and psql quotes it as a literal (:'pw'), so no character in it
# can end the statement.
set -euo pipefail

: "${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL (the owner) is required}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"

if [ "${#APP_DB_PASSWORD}" -lt 24 ]; then
  echo "APP_DB_PASSWORD must be at least 24 characters" >&2
  exit 1
fi

major="$(psql --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
if [ "$major" -lt 15 ]; then
  echo "psql 15 or newer is required (for \\getenv); found $(psql --version)" >&2
  exit 1
fi

psql "$MIGRATION_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
\getenv pw APP_DB_PASSWORD
ALTER ROLE investigator_app PASSWORD :'pw';
SQL
echo "investigator_app password set"
