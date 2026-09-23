#!/usr/bin/env bash
# Backup the BoostingHub production PostgreSQL database (custom-format dump).
#
# Production runs this as root from a ROOT-OWNED installed copy
# (/usr/local/libexec/boostinghub/backup-db.sh, see
# docs/deployment-production.md), never from the application checkout: a root
# service must not execute a file the `boostinghub` app user can write.
#
# DATABASE_URL is read from the app .env and never printed. The password is
# handed to pg_dump via a private temporary PGPASSFILE, so it never appears in
# process argv / `ps` output; pg_dump receives a password-free URI that keeps
# user, host, port, database and query options (e.g. sslmode).
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/boostinghub}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/boostinghub}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PYTHON="${PYTHON:-python3}"

umask 077
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "missing env file: ${ENV_FILE}" >&2
  exit 1
fi
if ! [[ "${RETENTION_DAYS}" =~ ^[0-9]+$ ]]; then
  echo "RETENTION_DAYS must be a non-negative integer" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT
PASS_FILE="${WORK_DIR}/pgpass"

# Splits DATABASE_URL into a password-free URI (stdout) and a 0600 pgpass file.
# Exits non-zero without echoing the URL on any problem.
CONNECTION_URI="$(ENV_FILE="${ENV_FILE}" PASS_FILE="${PASS_FILE}" "${PYTHON}" - <<'PY'
import os, sys
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit

url = None
for line in Path(os.environ["ENV_FILE"]).read_text(encoding="utf-8").splitlines():
    if line.startswith("DATABASE_URL="):
        url = line.split("=", 1)[1].strip().strip('"').strip("'")
        break
if not url:
    sys.exit("DATABASE_URL missing")

parts = urlsplit(url)
if parts.scheme not in ("postgres", "postgresql"):
    sys.exit("DATABASE_URL is not a postgres:// or postgresql:// URL")

userinfo, at, hostport = parts.netloc.rpartition("@")
user_enc, _, password_enc = userinfo.partition(":")
password = unquote(password_enc) if password_enc else None

query = []
for key, value in parse_qsl(parts.query, keep_blank_values=True):
    if key == "password":
        password = value
    else:
        query.append((key, value))

netloc = f"{user_enc}@{hostport}" if at else hostport
print(urlunsplit((parts.scheme, netloc, parts.path, urlencode(query), parts.fragment)))

if password:
    escaped = password.replace("\\", "\\\\").replace(":", "\\:")
    # Only this one pg_dump reads this file, so wildcards cannot leak it elsewhere.
    fd = os.open(os.environ["PASS_FILE"], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(f"*:*:*:*:{escaped}\n")
PY
)"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/boostinghub-${STAMP}.dump"

echo "Writing backup to ${OUT}"
if [[ -f "${PASS_FILE}" ]]; then
  export PGPASSFILE="${PASS_FILE}"
fi
if ! pg_dump --dbname="${CONNECTION_URI}" --format=custom --file="${OUT}"; then
  rm -f "${OUT}"
  echo "pg_dump failed" >&2
  exit 1
fi
chmod 600 "${OUT}"

SIZE="$(stat -c '%s' "${OUT}")"
if [[ "${SIZE}" -le 0 ]]; then
  rm -f "${OUT}"
  echo "backup file is empty" >&2
  exit 1
fi

# Lightweight validation: list the TOC without restoring anything. An invalid
# dump is removed so it can never be mistaken for the newest good backup.
if ! pg_restore --list "${OUT}" >/dev/null; then
  rm -f "${OUT}"
  echo "backup failed pg_restore --list validation" >&2
  exit 1
fi

echo "backup_ok bytes=${SIZE} file=${OUT}"

# Retention: only this script's own dump files, only directly in BACKUP_DIR.
find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'boostinghub-*.dump' -mtime "+${RETENTION_DAYS}" -delete
echo "retention_ok keep_days=${RETENTION_DAYS}"
