#!/usr/bin/env bash
# Offline tests for deploy/production/backup-db.sh. No database or credentials:
# pg_dump / pg_restore are replaced by stubs on PATH inside a temp directory.
#
#   bash deploy/production/backup-db.test.sh
#   PYTHON=python bash deploy/production/backup-db.test.sh   # where python3 is unavailable
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backup-db.sh"
PYTHON="${PYTHON:-python3}"
PASSWORD_RAW='p@ss:w/rd!\x'
PASSWORD_ENC='p%40ss%3Aw%2Frd%21%5Cx'
FAILURES=0
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILURES=$((FAILURES + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

mkdir -p "${TMP}/bin"
# pg_dump stub: records argv and the pgpass content it can see, then writes a dump
# according to STUB_DUMP (ok | empty | fail).
cat > "${TMP}/bin/pg_dump" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "${STUB_LOG}/pg_dump.argv"
if [[ -n "${PGPASSFILE:-}" && -f "${PGPASSFILE}" ]]; then
  cp "${PGPASSFILE}" "${STUB_LOG}/pgpass.seen"
  echo "${PGPASSFILE}" > "${STUB_LOG}/pgpass.path"
fi
out=""
for arg in "$@"; do [[ "${arg}" == --file=* ]] && out="${arg#--file=}"; done
case "${STUB_DUMP:-ok}" in
  ok) printf 'PGDMP-stub' > "${out}" ;;
  empty) : > "${out}" ;;
  fail) printf 'partial' > "${out}"; exit 1 ;;
esac
STUB
cat > "${TMP}/bin/pg_restore" <<'STUB'
#!/usr/bin/env bash
[[ "${STUB_RESTORE:-ok}" == ok ]]
STUB
chmod +x "${TMP}/bin/pg_dump" "${TMP}/bin/pg_restore"

# Runs backup-db.sh in a fresh sandbox; sets RC, OUTPUT, BACKUPS, LOG.
run_backup() {
  local case_dir="${TMP}/case-$1"; shift
  mkdir -p "${case_dir}/app" "${case_dir}/log" "${case_dir}/backups"
  BACKUPS="${case_dir}/backups"
  LOG="${case_dir}/log"
  printf '%s\n' "${ENV_CONTENT}" > "${case_dir}/app/.env"
  if [[ -n "${SEED:-}" ]]; then eval "${SEED}"; fi
  OUTPUT="$(env PATH="${TMP}/bin:${PATH}" STUB_LOG="${LOG}" PYTHON="${PYTHON}" \
    APP_DIR="${case_dir}/app" BACKUP_DIR="${BACKUPS}" "$@" bash "${SCRIPT}" 2>&1)"
  RC=$?
}

ENV_CONTENT="DATABASE_URL=\"postgresql://boostinghub:${PASSWORD_ENC}@127.0.0.1:5432/boostinghub?sslmode=disable&application_name=backup\""

echo "# successful dump"
SEED="" run_backup success
check "exits 0" '[[ ${RC} -eq 0 ]]'
dumps=("${BACKUPS}"/boostinghub-*.dump)
check "writes exactly one boostinghub-<UTC stamp>.dump" '[[ ${#dumps[@]} -eq 1 && "${dumps[0]}" =~ /boostinghub-[0-9]{8}T[0-9]{6}Z\.dump$ ]]'
check "reports backup_ok with the output path" 'grep -q "backup_ok bytes=10 file=${dumps[0]}" <<<"${OUTPUT}"'
check "password never appears in pg_dump argv" '! grep -qF "${PASSWORD_ENC}" "${LOG}/pg_dump.argv" && ! grep -qF "p@ss" "${LOG}/pg_dump.argv"'
check "pg_dump gets a password-free URI keeping user, host, port, db and query options" \
  'grep -qx -- "--dbname=postgresql://boostinghub@127.0.0.1:5432/boostinghub?sslmode=disable&application_name=backup" "${LOG}/pg_dump.argv"'
check "pg_dump uses custom format" 'grep -qx -- "--format=custom" "${LOG}/pg_dump.argv"'
check "password is supplied via PGPASSFILE (decoded, pgpass-escaped)" '[[ "$(cat "${LOG}/pgpass.seen")" == "*:*:*:*:p@ss\:w/rd!\\\\x" ]]'
check "temporary PGPASSFILE is removed afterwards" '[[ ! -e "$(cat "${LOG}/pgpass.path")" ]]'
check "script output never contains the password" '! grep -qF "p@ss" <<<"${OUTPUT}" && ! grep -qF "${PASSWORD_ENC}" <<<"${OUTPUT}"'
if [[ "$(uname -s)" == Linux ]]; then
  check "dump file mode is 600" '[[ "$(stat -c %a "${dumps[0]}")" == 600 ]]'
  check "backup dir mode is 700" '[[ "$(stat -c %a "${BACKUPS}")" == 700 ]]'
else
  echo "skip - file mode checks (not Linux: $(uname -s))"
fi

echo "# password given as a query parameter"
ENV_SAVED="${ENV_CONTENT}"
ENV_CONTENT='DATABASE_URL=postgres://app@db.internal/boostinghub?password=s3cret&sslmode=require'
SEED="" run_backup query-password
check "exits 0" '[[ ${RC} -eq 0 ]]'
check "password query parameter is stripped from argv" 'grep -qx -- "--dbname=postgres://app@db.internal/boostinghub?sslmode=require" "${LOG}/pg_dump.argv" && ! grep -q s3cret "${LOG}/pg_dump.argv"'
check "query password is supplied via PGPASSFILE" '[[ "$(cat "${LOG}/pgpass.seen")" == "*:*:*:*:s3cret" ]]'
ENV_CONTENT="${ENV_SAVED}"

echo "# empty dump"
SEED="" run_backup empty STUB_DUMP=empty
check "exits non-zero" '[[ ${RC} -ne 0 ]]'
check "reports empty backup" 'grep -q "backup file is empty" <<<"${OUTPUT}"'
check "removes the empty dump" '[[ -z "$(ls -A "${BACKUPS}")" ]]'

echo "# pg_dump failure"
SEED="" run_backup dump-fail STUB_DUMP=fail
check "exits non-zero" '[[ ${RC} -ne 0 ]]'
check "removes the partial dump" '[[ -z "$(ls -A "${BACKUPS}")" ]]'

echo "# pg_restore --list validation failure"
SEED="" run_backup restore-fail STUB_RESTORE=fail
check "exits non-zero" '[[ ${RC} -ne 0 ]]'
check "reports validation failure" 'grep -q "pg_restore --list validation" <<<"${OUTPUT}"'
check "removes the invalid dump" '[[ -z "$(ls -A "${BACKUPS}")" ]]'

echo "# missing DATABASE_URL"
ENV_CONTENT='OTHER=value'
SEED="" run_backup no-url
check "exits non-zero" '[[ ${RC} -ne 0 ]]'
check "does not call pg_dump" '[[ ! -e "${LOG}/pg_dump.argv" ]]'
ENV_CONTENT="${ENV_SAVED}"

echo "# retention"
SEED='
  old="$(date -d "30 days ago" +%Y%m%d%H%M)"
  touch -t "${old}" "${BACKUPS}/boostinghub-20200101T000000Z.dump" "${BACKUPS}/other-20200101.dump" "${BACKUPS}/boostinghub-notes.txt"
  mkdir -p "${BACKUPS}/nested" && touch -t "${old}" "${BACKUPS}/nested/boostinghub-20200101T000000Z.dump"
  touch "${BACKUPS}/boostinghub-recent.dump"
' run_backup retention
SEED=""
check "exits 0" '[[ ${RC} -eq 0 ]]'
check "deletes an expired boostinghub-*.dump" '[[ ! -e "${BACKUPS}/boostinghub-20200101T000000Z.dump" ]]'
check "keeps a recent boostinghub-*.dump" '[[ -e "${BACKUPS}/boostinghub-recent.dump" ]]'
check "keeps expired files that are not boostinghub-*.dump" '[[ -e "${BACKUPS}/other-20200101.dump" && -e "${BACKUPS}/boostinghub-notes.txt" ]]'
check "does not descend into subdirectories" '[[ -e "${BACKUPS}/nested/boostinghub-20200101T000000Z.dump" ]]'

echo "# invalid RETENTION_DAYS"
SEED="" run_backup bad-retention RETENTION_DAYS='1 -o -name *'
check "exits non-zero before dumping" '[[ ${RC} -ne 0 && ! -e "${LOG}/pg_dump.argv" ]]'

if [[ ${FAILURES} -gt 0 ]]; then
  echo "${FAILURES} check(s) failed"
  exit 1
fi
echo "all checks passed"
