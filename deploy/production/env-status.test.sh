#!/usr/bin/env bash
# Offline test for deploy/production/env-status.py: it must never print secrets.
#
#   bash deploy/production/env-status.test.sh
#   PYTHON=python bash deploy/production/env-status.test.sh   # where python3 is unavailable
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env-status.py"
PYTHON="${PYTHON:-python3}"
FAILURES=0
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

check() { if eval "$2"; then echo "ok   - $1"; else echo "FAIL - $1"; FAILURES=$((FAILURES + 1)); fi; }

# Every secret below is a distinctive marker that must never reach stdout.
printf '%s\r\n' 'DATABASE_URL="postgresql://app:LEAK1@x:y@127.0.0.1:5432/db?sslmode=disable&password=LEAK2"' > "${TMP}/.env"
cat >> "${TMP}/.env" <<'ENV'
BETTER_AUTH_SECRET=LEAK3
BETTER_AUTH_URL=https://phoenix-star.de
DISCORD_CLIENT_ID=111111111111111111
DISCORD_CLIENT_SECRET=LEAK4
BOOSTINGHUB_BOT_API_TOKEN=LEAK5
DISCORD_BOT_TOKEN=LEAK6
DISCORD_APPLICATION_ID=222222222222222222
DISCORD_GUILD_ID=333333333333333333
BOOSTINGHUB_API_BASE_URL=http://127.0.0.1:3000
DEV_AUTH_PASSWORD=LEAK7
TEST_DATABASE_URL=postgresql://t:LEAK8@localhost/t
UNKNOWN_CUSTOM_KEY=LEAK9
DEV_AUTH_ENABLED=false
DEV_AUTH_ENABLED=false
ENV

OUT="$(ENV_FILE="${TMP}/.env" "${PYTHON}" "${SCRIPT}")"
RC=$?
check "no secret marker is printed" '! grep -q LEAK <<<"${OUT}"'
check "database URL keeps user/host/db but redacts password" 'grep -qF "DATABASE_URL: SET (postgresql://app:***@127.0.0.1:5432/db?sslmode=disable&password=***)" <<<"${OUT}"'
check "public values are shown" 'grep -qF "BETTER_AUTH_URL: SET (https://phoenix-star.de)" <<<"${OUT}" && grep -qF "DISCORD_GUILD_ID: SET (333333333333333333)" <<<"${OUT}"'
check "secrets show length only" 'grep -qF "DISCORD_BOT_TOKEN: SET (len=5)" <<<"${OUT}"'
check "missing optional key is MISSING" 'grep -qF "RAIDER_IO_ACCESS_KEY: MISSING" <<<"${OUT}"'
check "unknown keys are listed by name only" 'grep -qF "UNKNOWN_CUSTOM_KEY" <<<"${OUT}"'
check "CRLF and duplicate keys are warned about" 'grep -q "CR characters" <<<"${OUT}" && grep -q "DEV_AUTH_ENABLED is defined more than once" <<<"${OUT}"'
check "all required keys set and dev flags off -> exit 0" '[[ ${RC} -eq 0 ]]'

printf 'DEV_AUTH_ENABLED=true\nBETTER_AUTH_SECRET=\n' >> "${TMP}/.env"
OUT="$(ENV_FILE="${TMP}/.env" "${PYTHON}" "${SCRIPT}")"
RC=$?
check "enabled dev flag or empty required key -> exit 1" '[[ ${RC} -eq 1 ]] && grep -q "must be false in production" <<<"${OUT}" && grep -qF "BETTER_AUTH_SECRET: EMPTY  <-- required" <<<"${OUT}"'

if [[ ${FAILURES} -gt 0 ]]; then
  echo "${FAILURES} check(s) failed"
  exit 1
fi
echo "all checks passed"
