#!/bin/sh
# Logical backup of the dashboard database.
#
# Usage (from the repository root):
#   ./infra/backups/backup.sh [output-directory]
#
# The dump is written outside the database container, on the host, so that a
# container rebuild never destroys a backup. Backups are git-ignored: never
# commit a dump, it contains personal financial data.

set -eu

COMPOSE_PROJECT="${COMPOSE_PROJECT:-dashboard}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_NAME="${POSTGRES_DB:-dashboard}"
DB_USER="${POSTGRES_USER:-dashboard}"
OUTPUT_DIR="${1:-infra/backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_FILE="${OUTPUT_DIR}/dashboard-${TIMESTAMP}.dump"

mkdir -p "${OUTPUT_DIR}"

echo "Dumping '${DB_NAME}' from service '${DB_SERVICE}' to ${OUTPUT_FILE}"

docker compose exec -T "${DB_SERVICE}" \
  pg_dump --username="${DB_USER}" --dbname="${DB_NAME}" --format=custom --no-owner \
  > "${OUTPUT_FILE}"

echo "Backup written: ${OUTPUT_FILE}"
echo "Verify it with: ./infra/backups/restore.sh ${OUTPUT_FILE} <target-database>"
