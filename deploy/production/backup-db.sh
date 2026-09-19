#!/usr/bin/env bash
# Backup production PostgreSQL database for BoostingHub.
# Reads DATABASE_URL from /var/www/boostinghub/.env without echoing secrets.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/boostinghub}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/boostinghub}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
ENV_FILE="${APP_DIR}/.env"

umask 077
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "missing env file: ${ENV_FILE}" >&2
  exit 1
fi

# Extract DATABASE_URL without printing it.
DATABASE_URL="$(python3 - <<PY
from pathlib import Path
for line in Path("${ENV_FILE}").read_text().splitlines():
    if line.startswith("DATABASE_URL="):
        v = line.split("=", 1)[1].strip().strip('"').strip("'")
        print(v)
        break
else:
    raise SystemExit("DATABASE_URL missing")
PY
)"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/boostinghub-${STAMP}.dump"

echo "Writing backup to ${OUT}"
# Custom format for pg_restore inspection without restoring over production.
# Auth comes only from the connection URI extracted above.
pg_dump --dbname="${DATABASE_URL}" --format=custom --file="${OUT}"
chmod 600 "${OUT}"

SIZE="$(stat -c '%s' "${OUT}")"
if [[ "${SIZE}" -le 0 ]]; then
  echo "backup file is empty" >&2
  exit 1
fi

# Lightweight validation: list TOC without restoring.
pg_restore --list "${OUT}" >/dev/null

echo "backup_ok bytes=${SIZE} file=${OUT}"

# Retention: delete dumps older than RETENTION_DAYS.
find "${BACKUP_DIR}" -type f -name 'boostinghub-*.dump' -mtime "+${RETENTION_DAYS}" -delete
echo "retention_ok keep_days=${RETENTION_DAYS}"
