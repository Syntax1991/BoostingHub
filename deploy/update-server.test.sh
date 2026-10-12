#!/usr/bin/env bash
# Offline tests for deploy/update-server.sh — no server, systemd, git remote or
# npm: every external command is a stub on PATH inside a temp directory, and
# the stubs record their calls in order so the test can assert the sequence.
#
#   bash deploy/update-server.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/update-server.sh"
FAILURES=0
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILURES=$((FAILURES + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

BIN="${TMP}/bin"
mkdir -p "${BIN}"

# systemctl: unit state lives in $STATE/<unit>.active (timers / web / bot) and
# $STATE/<unit>.activestate (job services); every call is appended to $LOG/calls.
cat > "${BIN}/systemctl" <<'STUB'
#!/usr/bin/env bash
echo "systemctl $*" >> "${LOG}/calls"
cmd="$1"; shift
case "${cmd}" in
  cat) [[ -f "${STATE}/$1.exists" ]] ;;
  is-active) [[ "$1" == --quiet ]] && shift; [[ -f "${STATE}/$1.active" ]] ;;
  stop) rm -f "${STATE}/$1.active" ;;
  start)
    if [[ "$1" == boostinghub-backup.service ]]; then [[ "${STUB_BACKUP:-ok}" == ok ]]; exit; fi
    touch "${STATE}/$1.active" ;;
  restart) touch "${STATE}/$1.active" ;;
  show)
    prop="$2"; unit="$4"
    case "${prop}" in
      Type) echo oneshot ;;
      RemainAfterExit) echo no ;;
      Result) echo success ;;
      ActiveState) cat "${STATE}/${unit}.activestate" 2>/dev/null || echo inactive ;;
    esac ;;
  enable|disable) echo "UNEXPECTED $cmd" >> "${LOG}/calls"; exit 1 ;;
esac
STUB

cat > "${BIN}/sudo" <<'STUB'
#!/usr/bin/env bash
[[ "$1" == -u ]] && shift 2
exec "$@"
STUB

cat > "${BIN}/git" <<'STUB'
#!/usr/bin/env bash
[[ "$1" == -C ]] && shift 2
echo "git $*" >> "${LOG}/calls"
case "$1" in
  status) : ;;
  rev-parse) cat "${STATE}/head" ;;
  branch) echo main ;;
  fetch|checkout) : ;;
  pull) echo after-sha > "${STATE}/head" ;;
esac
STUB

# npm: STUB_FAIL_STEP=<ci|db:emit|typecheck|build|db:migrate>; STUB_CI_BREAKS_TSX=1
# removes tsx (a partial install).
cat > "${BIN}/npm" <<'STUB'
#!/usr/bin/env bash
step="$1"; [[ "$1" == run ]] && step="$2"
echo "npm ${step}" >> "${LOG}/calls"
if [[ "${step}" == ci && "${STUB_CI_BREAKS_TSX:-}" == 1 ]]; then rm -f "${APP}/node_modules/.bin/tsx"; fi
[[ "${STUB_FAIL_STEP:-}" != "${step}" ]]
STUB

cat > "${BIN}/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s' "${STUB_HTTP:-200}"
STUB
cat > "${BIN}/flock" <<'STUB'
#!/usr/bin/env bash
[[ "${STUB_LOCKED:-}" != 1 ]]
STUB
cat > "${BIN}/id" <<'STUB'
#!/usr/bin/env bash
echo 0
STUB
# sleep: instant; finishes a simulated running job after STUB_JOB_SLEEPS calls.
cat > "${BIN}/sleep" <<'STUB'
#!/usr/bin/env bash
echo "sleep $*" >> "${LOG}/calls"
if [[ -f "${STATE}/job_sleeps_left" ]]; then
  left=$(( $(cat "${STATE}/job_sleeps_left") - 1 ))
  echo "${left}" > "${STATE}/job_sleeps_left"
  (( left <= 0 )) && rm -f "${STATE}/boostinghub-character-sync.service.activestate" "${STATE}/job_sleeps_left"
fi
exit 0
STUB
chmod +x "${BIN}"/*

UNITS=(boostinghub-web.service boostinghub-discord-bot.service boostinghub-backup.service
  boostinghub-character-sync.timer boostinghub-community-schedule.timer)

# Runs update-server.sh in a fresh sandbox; sets RC, OUTPUT, CALLS, STATE.
run_deploy() {
  local case_dir="${TMP}/case-$1"; shift
  STATE="${case_dir}/state"; LOG="${case_dir}/log"; APP="${case_dir}/app"
  mkdir -p "${STATE}" "${LOG}" "${APP}/node_modules/.bin"
  : > "${LOG}/calls"
  printf '#!/usr/bin/env bash\necho tsx-stub\n' > "${APP}/node_modules/.bin/tsx"
  chmod +x "${APP}/node_modules/.bin/tsx"
  printf '{"scripts":{"sync:characters":"tsx a.ts","materialize:community-schedule":"tsx b.ts"}}\n' > "${APP}/package.json"
  echo before-sha > "${STATE}/head"
  local unit
  for unit in "${UNITS[@]}"; do touch "${STATE}/${unit}.exists"; done
  touch "${STATE}/boostinghub-character-sync.timer.active" "${STATE}/boostinghub-community-schedule.timer.active"
  touch "${STATE}/boostinghub-web.service.active" "${STATE}/boostinghub-discord-bot.service.active"
  # Per-case setup hook (env assignments are passed as arguments).
  [[ -n "${SETUP:-}" ]] && eval "${SETUP}"
  OUTPUT="$(env "$@" PATH="${BIN}:${PATH}" STATE="${STATE}" LOG="${LOG}" APP="${APP}" \
    BOOSTINGHUB_APP_DIR="${APP}" BOOSTINGHUB_SITE_URL=https://example.test/ \
    BOOSTINGHUB_DEPLOY_LOCK="${case_dir}/deploy.lock" BOOSTINGHUB_RUNNING_JOB_WAIT_SECONDS=20 \
    bash "${SCRIPT}" 2>&1)"
  RC=$?
  CALLS="$(cat "${LOG}/calls")"
  SETUP=""
}

# Line number of the first call matching a pattern (0 when absent).
at() { grep -n -m1 -- "$1" <<<"${CALLS}" | cut -d: -f1 || true; }
timer_active() { [[ -f "${STATE}/$1.active" ]]; }

# 1. Success: timers paused before any checkout / npm change, restored after
#    migrate + service restart + runtime check; enablement never touched.
run_deploy success
check "success exits 0" '[[ ${RC} -eq 0 ]]'
check "success prints DEPLOY_OK" 'grep -q "DEPLOY_OK before=before-sha after=after-sha" <<<"${OUTPUT}"'
check "character-sync timer stopped before git fetch" \
  '(( $(at "systemctl stop boostinghub-character-sync.timer") < $(at "git fetch") ))'
check "community-schedule timer stopped before git fetch" \
  '(( $(at "systemctl stop boostinghub-community-schedule.timer") < $(at "git fetch") ))'
check "timers stopped before npm ci" '(( $(at "systemctl stop boostinghub-character-sync.timer") < $(at "npm ci") ))'
check "timers restarted only after migrate and web/bot restart" \
  '(( $(at "systemctl start boostinghub-character-sync.timer") > $(at "npm db:migrate") &&
      $(at "systemctl start boostinghub-character-sync.timer") > $(at "systemctl restart boostinghub-discord-bot.service") ))'
check "both timers active again" 'timer_active boostinghub-character-sync.timer && timer_active boostinghub-community-schedule.timer'
check "no job service started manually" '! grep -q "systemctl start boostinghub-character-sync.service\|systemctl start boostinghub-community-schedule.service" <<<"${CALLS}"'
check "backup timer never paused" '! grep -q "boostinghub-backup.timer" <<<"${CALLS}"'
check "enable/disable never called" '! grep -q "UNEXPECTED" <<<"${CALLS}"'

# 2. A timer that was not active before stays inactive.
SETUP='rm -f "${STATE}/boostinghub-community-schedule.timer.active"'
run_deploy inactive-timer
check "inactive timer: deploy ok" '[[ ${RC} -eq 0 ]]'
check "inactive timer is not started" '! timer_active boostinghub-community-schedule.timer'
check "active timer restored" 'timer_active boostinghub-character-sync.timer'

# 3. Failure right after pausing (test hook): non-zero, timers restored, nothing changed.
run_deploy fail-after-pause BOOSTINGHUB_DEPLOY_TEST_FAIL_AFTER_PAUSE=1
check "fail-after-pause exits non-zero" '[[ ${RC} -ne 0 ]]'
check "fail-after-pause keeps the original error" 'grep -q "test hook: failing after timer pause" <<<"${OUTPUT}"'
check "fail-after-pause restores timers" 'timer_active boostinghub-character-sync.timer && timer_active boostinghub-community-schedule.timer'
check "fail-after-pause touched no code" '! grep -q "git fetch\|npm " <<<"${CALLS}"'

# 4. Backup failure (before any code change): timers restored.
run_deploy backup-fails STUB_BACKUP=fail
check "backup failure exits non-zero" '[[ ${RC} -ne 0 ]]'
check "backup failure restores timers" 'timer_active boostinghub-character-sync.timer && timer_active boostinghub-community-schedule.timer'

# 5. Build failure after new code is checked out: timers stay stopped with a recovery hint.
run_deploy build-fails STUB_FAIL_STEP=build
check "build failure exits non-zero" '[[ ${RC} -ne 0 ]]'
check "build failure leaves timers stopped" '! timer_active boostinghub-character-sync.timer && ! timer_active boostinghub-community-schedule.timer'
check "build failure prints recovery command" 'grep -q "after fixing the release run: systemctl start boostinghub-character-sync.timer boostinghub-community-schedule.timer" <<<"${OUTPUT}"'
check "build failure did not restart web/bot" '! grep -q "systemctl restart" <<<"${CALLS}"'

# 6. Migration failure: same — schema / code may not match, timers stay stopped.
run_deploy migrate-fails STUB_FAIL_STEP=db:migrate
check "migration failure exits non-zero" '[[ ${RC} -ne 0 ]]'
check "migration failure leaves timers stopped" '! timer_active boostinghub-character-sync.timer'

# 7. Partial install (tsx missing) after migrate: runtime check fails, timers stay stopped.
run_deploy runtime-incomplete STUB_CI_BREAKS_TSX=1
check "incomplete runtime exits non-zero" '[[ ${RC} -ne 0 ]]'
check "incomplete runtime is reported" 'grep -q "job runtime incomplete" <<<"${OUTPUT}"'
check "incomplete runtime leaves timers stopped" '! timer_active boostinghub-character-sync.timer && ! timer_active boostinghub-community-schedule.timer'

# 8. A sync already running is waited for (not killed) before any code change.
SETUP='echo activating > "${STATE}/boostinghub-character-sync.service.activestate"; echo 2 > "${STATE}/job_sleeps_left"'
run_deploy running-job
check "running job: deploy ok" '[[ ${RC} -eq 0 ]]'
check "running job waited for before git fetch" '(( $(at "sleep 5") < $(at "git fetch") ))'
check "running job was never stopped" '! grep -q "systemctl stop boostinghub-character-sync.service" <<<"${CALLS}"'

# 9. A job that keeps running past the bound: abort before any change, timers restored.
SETUP='echo activating > "${STATE}/boostinghub-character-sync.service.activestate"; echo 999 > "${STATE}/job_sleeps_left"'
run_deploy job-too-long
check "job too long exits non-zero" '[[ ${RC} -ne 0 ]]'
check "job too long touched no code" '! grep -q "git fetch\|npm " <<<"${CALLS}"'
check "job too long restores timers" 'timer_active boostinghub-character-sync.timer && timer_active boostinghub-community-schedule.timer'

# 10. Another deploy holds the lock: refuse without touching timers.
run_deploy locked STUB_LOCKED=1
check "locked exits non-zero" '[[ ${RC} -ne 0 ]]'
check "locked touched no timer" '! grep -q "systemctl stop" <<<"${CALLS}"'

# 11. The script survives rewriting itself mid-run (git pull of a new version).
SELF="${TMP}/self-rewrite.sh"
cp "${SCRIPT}" "${SELF}"
SCRIPT_ORIG="${SCRIPT}"
# A git stub whose pull appends garbage to the very file bash is executing.
cat > "${BIN}/git" <<STUB
#!/usr/bin/env bash
[[ "\$1" == -C ]] && shift 2
echo "git \$*" >> "\${LOG}/calls"
case "\$1" in
  status) : ;;
  rev-parse) cat "\${STATE}/head" ;;
  branch) echo main ;;
  fetch|checkout) : ;;
  pull) echo after-sha > "\${STATE}/head"; printf 'echo CORRUPTED_TAIL_EXECUTED\nexit 42\n' >> "${SELF}" ;;
esac
STUB
chmod +x "${BIN}/git"
SCRIPT="${SELF}"
run_deploy self-rewrite
SCRIPT="${SCRIPT_ORIG}"
check "self-rewrite: deploy still ok" '[[ ${RC} -eq 0 ]] && grep -q DEPLOY_OK <<<"${OUTPUT}"'
check "self-rewrite: appended tail never executed" '! grep -q CORRUPTED_TAIL_EXECUTED <<<"${OUTPUT}"'

echo
if (( FAILURES > 0 )); then
  echo "${FAILURES} check(s) failed"
  exit 1
fi
echo "all checks passed"
