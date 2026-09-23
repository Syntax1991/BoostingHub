#!/usr/bin/env bash
# Conservative production release helper: backup, fast-forward main, validate,
# migrate, then restart web + bot. Any failed step aborts before later steps run.
set -euo pipefail

APP_DIR=/var/www/boostinghub
APP_USER=boostinghub
BRANCH="${1:-main}"
SITE_URL=https://phoenix-star.de/
WEB_UNIT=boostinghub-web.service
BOT_UNIT=boostinghub-discord-bot.service
BACKUP_UNIT=boostinghub-backup.service

as_app() { sudo -u "${APP_USER}" "$@"; }
app_git() { as_app git -C "${APP_DIR}" "$@"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

if [[ "$(id -u)" -ne 0 ]]; then
  fail "run as root (systemd services are restarted)"
fi

for unit in "${WEB_UNIT}" "${BOT_UNIT}" "${BACKUP_UNIT}"; do
  systemctl cat "${unit}" >/dev/null 2>&1 || fail "systemd unit ${unit} not found; server setup is incomplete"
done

# The backup step below relies on `systemctl start` blocking until the dump has
# finished and reporting its result. Only Type=oneshot with RemainAfterExit=no
# guarantees that (and re-runs on every start), so refuse anything else.
BACKUP_TYPE="$(systemctl show -p Type --value "${BACKUP_UNIT}")"
[[ "${BACKUP_TYPE}" == "oneshot" ]] \
  || fail "${BACKUP_UNIT} must be Type=oneshot (actual: ${BACKUP_TYPE:-unset}); nothing was changed"
BACKUP_REMAIN_AFTER_EXIT="$(systemctl show -p RemainAfterExit --value "${BACKUP_UNIT}")"
[[ "${BACKUP_REMAIN_AFTER_EXIT}" == "no" ]] \
  || fail "${BACKUP_UNIT} must use RemainAfterExit=no (actual: ${BACKUP_REMAIN_AFTER_EXIT:-unset}); nothing was changed"

cd "${APP_DIR}"

# Deployment must never destroy operator changes. Untracked operational files
# are ignored here and left in place.
TRACKED_CHANGES="$(app_git status --porcelain --untracked-files=no)"
if [[ -n "${TRACKED_CHANGES}" ]]; then
  echo "${TRACKED_CHANGES}" >&2
  fail "tracked modifications in ${APP_DIR}; resolve them manually before deploying"
fi

echo "==> Current release"
BEFORE_SHA="$(app_git rev-parse HEAD)"
echo "before_sha=${BEFORE_SHA}"
echo "branch=$(app_git branch --show-current)"

# The backup must complete before any code, dependency or schema change.
echo "==> Database backup (${BACKUP_UNIT})"
systemctl start "${BACKUP_UNIT}" || fail "backup failed; nothing was changed"
BACKUP_RESULT="$(systemctl show -p Result --value "${BACKUP_UNIT}")"
[[ "${BACKUP_RESULT}" == "success" ]] || fail "backup unit result=${BACKUP_RESULT}; nothing was changed"

# --ff-only refuses to silently rewrite or merge production history.
echo "==> Fetch / fast-forward ${BRANCH}"
app_git fetch origin --prune
app_git checkout "${BRANCH}" || fail "cannot switch to ${BRANCH}"
app_git pull --ff-only origin "${BRANCH}" || fail "${BRANCH} cannot be fast-forwarded; investigate manually"
AFTER_SHA="$(app_git rev-parse HEAD)"
echo "after_sha=${AFTER_SHA}"

echo "==> npm ci"
as_app npm ci --legacy-peer-deps

echo "==> Prisma emit"
as_app npm run db:emit

# Validate the new code before touching the live schema or running services.
echo "==> Typecheck"
as_app npm run typecheck
echo "==> Build"
as_app npm run build

echo "==> Migrate"
as_app npm run db:migrate || fail "migration failed; services were NOT restarted (before=${BEFORE_SHA} after=${AFTER_SHA})"

echo "==> Restart web + Discord bot"
systemctl restart "${WEB_UNIT}"
systemctl restart "${BOT_UNIT}"

sleep 5
echo "==> Verify services"
for unit in "${WEB_UNIT}" "${BOT_UNIT}"; do
  systemctl is-active --quiet "${unit}" || fail "${unit} is not active after restart"
  echo "${unit}: active"
done

# Next.js may need a few seconds after restart before the proxy gets a response.
echo "==> HTTP smoke ${SITE_URL}"
HTTP_CODE=000
for _ in $(seq 1 12); do
  HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "${SITE_URL}" || true)"
  [[ "${HTTP_CODE}" == "200" ]] && break
  sleep 5
done
[[ "${HTTP_CODE}" == "200" ]] || fail "${SITE_URL} returned HTTP ${HTTP_CODE}"
echo "https=${HTTP_CODE}"

echo "DEPLOY_OK before=${BEFORE_SHA} after=${AFTER_SHA}"
