#!/usr/bin/env bash
# Conservative production release helper: backup, fast-forward main, validate,
# migrate, then restart web + bot. Any failed step aborts before later steps run.
#
# Scheduled app jobs (systemd timers that run `npm run …` / tsx from this
# checkout) are paused for the whole release, so none of them can start while
# node_modules is being reinstalled or new code is checked out but not yet
# built / migrated. They are restarted only once the runtime is complete again.
#
# The whole body lives in main(), and the last line is `main "$@"; exit $?`:
# bash parses that function completely before running it, so the `git pull`
# below may rewrite this very file without corrupting the running deploy.
set -euo pipefail

# Paths / URL are overridable only for the offline tests (update-server.test.sh).
APP_DIR="${BOOSTINGHUB_APP_DIR:-/var/www/boostinghub}"
APP_USER=boostinghub
BRANCH="${1:-main}"
SITE_URL="${BOOSTINGHUB_SITE_URL:-https://manawyrm-boosting.com/}"
WEB_UNIT=boostinghub-web.service
BOT_UNIT=boostinghub-discord-bot.service
BACKUP_UNIT=boostinghub-backup.service
LOCK_FILE="${BOOSTINGHUB_DEPLOY_LOCK:-/run/lock/boostinghub-deploy.lock}"

# Timers whose service runs application code from APP_DIR (ExecStart =
# /usr/bin/npm run <script> as APP_USER). The backup timer is NOT listed: its
# service runs a root-owned installed copy and never touches the checkout.
APP_TIMERS=(boostinghub-character-sync.timer boostinghub-community-schedule.timer)
# npm scripts those services run — checked before the timers come back.
APP_TIMER_NPM_SCRIPTS=(sync:characters materialize:community-schedule)
# A job that is already running is waited for (never killed); bounded.
RUNNING_JOB_WAIT_SECONDS="${BOOSTINGHUB_RUNNING_JOB_WAIT_SECONDS:-900}"

# Deploy progress for the EXIT trap:
#   preflight → paused (timers stopped, runtime untouched)
#   → code_changed (checkout / node_modules may be new or partial)
#   → migrated (new code built and schema migrated)
STAGE=preflight
BEFORE_SHA=""
PAUSED_TIMERS=()

as_app() { sudo -u "${APP_USER}" "$@"; }
app_git() { as_app git -C "${APP_DIR}" "$@"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

restore_timers() {
  local timer
  for timer in "${PAUSED_TIMERS[@]}"; do
    if systemctl start "${timer}"; then
      echo "timer restored: ${timer}"
    else
      echo "WARNING: could not start ${timer}; start it manually" >&2
    fi
  done
  PAUSED_TIMERS=()
}

# The runtime the timer services need: tsx from node_modules (what
# `npm run <script>` resolves) and every npm script they invoke.
runtime_ready() {
  as_app test -x "${APP_DIR}/node_modules/.bin/tsx" || return 1
  as_app "${APP_DIR}/node_modules/.bin/tsx" --version >/dev/null 2>&1 || return 1
  local script
  for script in "${APP_TIMER_NPM_SCRIPTS[@]}"; do
    as_app node -e "process.exit(require(process.argv[1]).scripts?.[process.argv[2]] ? 0 : 1)" \
      "${APP_DIR}/package.json" "${script}" || return 1
  done
}

on_exit() {
  local rc=$?
  trap - EXIT
  if (( ${#PAUSED_TIMERS[@]} > 0 )); then
    local restore=no
    case "${STAGE}" in
      preflight | paused)
        # Failed before any code / dependency change (incl. while pausing or
        # waiting for a running job): the old runtime is intact.
        restore=yes
        ;;
      code_changed)
        # Only safe when the checkout is back on the old commit and runs.
        if [[ -n "${BEFORE_SHA}" && "$(app_git rev-parse HEAD 2>/dev/null || true)" == "${BEFORE_SHA}" ]] &&
          runtime_ready; then
          restore=yes
        fi
        ;;
      migrated)
        runtime_ready && restore=yes
        ;;
    esac
    if [[ "${restore}" == yes ]]; then
      echo "==> Restoring paused timers (deploy exit ${rc}, stage ${STAGE})" >&2
      restore_timers
    else
      echo "ERROR: deploy stopped at stage ${STAGE} with a possibly incomplete runtime;" >&2
      echo "       timers left STOPPED: ${PAUSED_TIMERS[*]}" >&2
      echo "       after fixing the release run: systemctl start ${PAUSED_TIMERS[*]}" >&2
    fi
  fi
  exit "${rc}"
}

pause_app_timers() {
  local timer service state waited
  for timer in "${APP_TIMERS[@]}"; do
    systemctl cat "${timer}" >/dev/null 2>&1 || fail "systemd unit ${timer} not found; server setup is incomplete"
    # Only timers that are running now are paused and later restarted; stop /
    # start never changes whether a timer is enabled.
    if systemctl is-active --quiet "${timer}"; then
      systemctl stop "${timer}"
      PAUSED_TIMERS+=("${timer}")
      echo "timer paused: ${timer}"
    else
      echo "timer not active, left as is: ${timer}"
    fi
  done
  for timer in "${APP_TIMERS[@]}"; do
    service="${timer%.timer}.service"
    waited=0
    while :; do
      state="$(systemctl show -p ActiveState --value "${service}")"
      [[ "${state}" == activating || "${state}" == deactivating || "${state}" == reloading ]] || break
      (( waited >= RUNNING_JOB_WAIT_SECONDS )) &&
        fail "${service} still running after ${RUNNING_JOB_WAIT_SECONDS}s; nothing was changed"
      echo "waiting for running ${service} (${state}) to finish…"
      sleep 5
      waited=$((waited + 5))
    done
  done
}

main() {
  if [[ "$(id -u)" -ne 0 ]]; then
    fail "run as root (systemd services are restarted)"
  fi

  # One deploy at a time — two deploys would race on the paused timer state.
  exec 9>"${LOCK_FILE}"
  flock -n 9 || fail "another deploy holds ${LOCK_FILE}; nothing was changed"

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

  echo "==> Pause scheduled app jobs"
  trap on_exit EXIT
  pause_app_timers
  STAGE=paused
  # Offline / production failure-path check: fail right after pausing.
  [[ "${BOOSTINGHUB_DEPLOY_TEST_FAIL_AFTER_PAUSE:-}" == 1 ]] && fail "test hook: failing after timer pause"

  # The backup must complete before any code, dependency or schema change.
  echo "==> Database backup (${BACKUP_UNIT})"
  systemctl start "${BACKUP_UNIT}" || fail "backup failed; nothing was changed"
  BACKUP_RESULT="$(systemctl show -p Result --value "${BACKUP_UNIT}")"
  [[ "${BACKUP_RESULT}" == "success" ]] || fail "backup unit result=${BACKUP_RESULT}; nothing was changed"

  # --ff-only refuses to silently rewrite or merge production history.
  echo "==> Fetch / fast-forward ${BRANCH}"
  STAGE=code_changed
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
  STAGE=migrated

  echo "==> Restart web + Discord bot"
  systemctl restart "${WEB_UNIT}"
  systemctl restart "${BOT_UNIT}"

  sleep 5
  echo "==> Verify services"
  for unit in "${WEB_UNIT}" "${BOT_UNIT}"; do
    systemctl is-active --quiet "${unit}" || fail "${unit} is not active after restart"
    echo "${unit}: active"
  done

  # Restart the paused timers only against a complete runtime. A monotonic
  # timer whose interval elapsed during the deploy fires once on start — that
  # is the regular (catch-up) run; nothing is started manually.
  echo "==> Verify job runtime + restore scheduled app jobs"
  runtime_ready || fail "job runtime incomplete (node_modules/.bin/tsx or npm scripts missing)"
  restore_timers

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
}

main "$@"; exit $?
