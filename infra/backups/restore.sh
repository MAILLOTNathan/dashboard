#!/bin/sh
# Restore a backup produced by backup.sh into a target database.
#
# Usage (from the repository root):
#   ./infra/backups/restore.sh <dump-file> <target-database>
#
# Restoring into an existing database overwrites its content: the target is
# dropped and recreated first. Never point this at production by accident.

set -eu

DUMP_FILE="${1:?usage: restore.sh <dump-file> <target-database>}"
TARGET_DB="${2:?usage: restore.sh <dump-file> <target-database>}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${POSTGRES_USER:-dashboard}"

if [ ! -f "${DUMP_FILE}" ]; then
  echo "Dump file not found: ${DUMP_FILE}" >&2
  exit 1
fi

echo "Recreating database '${TARGET_DB}'"
docker compose exec -T "${DB_SERVICE}" \
  psql --username="${DB_USER}" --dbname=postgres \
  -c "DROP DATABASE IF EXISTS \"${TARGET_DB}\";" \
  -c "CREATE DATABASE \"${TARGET_DB}\";"

echo "Restoring ${DUMP_FILE} into ${TARGET_DB}"
docker compose exec -T "${DB_SERVICE}" \
  pg_restore --username="${DB_USER}" --dbname="${TARGET_DB}" --no-owner --clean --if-exists \
  < "${DUMP_FILE}"

echo "Restore finished. A restore test must be run before going to production."
