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
printf '%s\r\n' 'DATABASE_URL="postgresql://app:LEAK1@x:y@127.0.0.1:5432/db?sslmode=disable&password=LEAK_QUERY_PASSWORD&sslpassword=LEAK_SSL_PASSWORD&custom_secret=LEAK_CUSTOM_QUERY"' > "${TMP}/.env"
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
DISCORD_BOOSTER_TICKET_URL="https://discord.com/channels/1/2"
DISCORD_SYNC_INTERVAL_MS=5000"
BLIZZARD_REDIRECT_URI='https://phoenix-star.de/cb"
export DISCORD_RUN_CATEGORY_ID='444444444444444444'
DEV_AUTH_ENABLED=false
DEV_AUTH_ENABLED=false
ENV

OUT="$(ENV_FILE="${TMP}/.env" "${PYTHON}" "${SCRIPT}")"
RC=$?
check "no secret marker is printed" '! grep -q LEAK <<<"${OUT}"'
check "database URL shows user/host/port/db, hides password and every query value" \
  'grep -qF "DATABASE_URL: SET (postgresql://app:<hidden>@127.0.0.1:5432/db?sslmode=<hidden>&password=<hidden>&sslpassword=<hidden>&custom_secret=<hidden>)" <<<"${OUT}"'
check "raw-@ userinfo password is not printed" '! grep -qF LEAK1 <<<"${OUT}" && ! grep -qF "x:y@" <<<"${OUT}"'
check "password= query value is not printed" '! grep -qF LEAK_QUERY_PASSWORD <<<"${OUT}"'
check "sslpassword= query value is not printed" '! grep -qF LEAK_SSL_PASSWORD <<<"${OUT}"'
check "arbitrary query value is not printed" '! grep -qF LEAK_CUSTOM_QUERY <<<"${OUT}" && ! grep -qF "sslmode=disable" <<<"${OUT}"'
check "one matching outer quote pair is removed" 'grep -qF "DISCORD_BOOSTER_TICKET_URL: SET (https://discord.com/channels/1/2)" <<<"${OUT}"'
check "a lone trailing quote is kept" "grep -qF 'DISCORD_SYNC_INTERVAL_MS: SET (5000\")' <<<\"\${OUT}\""
check "mismatched outer quotes are kept" "grep -qF \"BLIZZARD_REDIRECT_URI: SET ('https://phoenix-star.de/cb\\\")\" <<<\"\${OUT}\""
check "export prefix is accepted" 'grep -qF "DISCORD_RUN_CATEGORY_ID: SET (444444444444444444)" <<<"${OUT}"'
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

printf '%s\n' 'DEV_AUTH_ENABLED=false' 'BETTER_AUTH_SECRET=LEAK3' 'DATABASE_URL=postgresql://other:LEAK_DUP@127.0.0.1/other' >> "${TMP}/.env"
OUT="$(ENV_FILE="${TMP}/.env" "${PYTHON}" "${SCRIPT}")"
RC=$?
check "duplicate DATABASE_URL is a problem (backups refuse it) and leaks nothing" \
  '[[ ${RC} -eq 1 ]] && grep -q "PROBLEM: DATABASE_URL is defined more than once" <<<"${OUT}" && ! grep -q LEAK <<<"${OUT}"'

if [[ ${FAILURES} -gt 0 ]]; then
  echo "${FAILURES} check(s) failed"
  exit 1
fi
echo "all checks passed"
