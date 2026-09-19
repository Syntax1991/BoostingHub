#!/usr/bin/env bash
# Update production from origin/main: backup → pull → migrate → build → restart.
# Does NOT delete database volumes or run migrate reset.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/boostinghub}"
BRANCH="${1:-main}"
BACKUP_SCRIPT="${APP_DIR}/deploy/production/backup-db.sh"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi

echo "==> Pre-deploy status"
BEFORE_SHA="$(sudo -u boostinghub git -C "${APP_DIR}" rev-parse HEAD)"
echo "before_sha=${BEFORE_SHA}"
systemctl is-active boostinghub-web || true
systemctl is-active boostinghub-discord-bot || true

echo "==> Database backup"
if [[ -x "${BACKUP_SCRIPT}" ]]; then
  bash "${BACKUP_SCRIPT}"
else
  echo "backup script missing at ${BACKUP_SCRIPT}" >&2
  exit 1
fi

echo "==> Fetch / checkout ${BRANCH}"
sudo -u boostinghub git -C "${APP_DIR}" fetch --all --prune
sudo -u boostinghub git -C "${APP_DIR}" checkout "${BRANCH}"
sudo -u boostinghub git -C "${APP_DIR}" pull --ff-only "origin" "${BRANCH}"
AFTER_SHA="$(sudo -u boostinghub git -C "${APP_DIR}" rev-parse HEAD)"
echo "after_sha=${AFTER_SHA}"

echo "==> npm install"
cd "${APP_DIR}"
sudo -u boostinghub npm install --legacy-peer-deps

echo "==> Prisma emit + migrate"
sudo -u boostinghub npm run db:emit
sudo -u boostinghub npm run db:migrate

echo "==> Build"
sudo -u boostinghub npm run build

echo "==> Install/refresh systemd units from repo (if present)"
UNIT_DIR="${APP_DIR}/deploy/production/systemd"
if [[ -d "${UNIT_DIR}" ]]; then
  cp "${UNIT_DIR}/boostinghub-web.service" /etc/systemd/system/boostinghub-web.service
  cp "${UNIT_DIR}/boostinghub-discord-bot.service" /etc/systemd/system/boostinghub-discord-bot.service
  cp "${UNIT_DIR}/boostinghub-character-sync.service" /etc/systemd/system/boostinghub-character-sync.service
  cp "${UNIT_DIR}/boostinghub-character-sync.timer" /etc/systemd/system/boostinghub-character-sync.timer
  cp "${UNIT_DIR}/boostinghub-backup.service" /etc/systemd/system/boostinghub-backup.service
  cp "${UNIT_DIR}/boostinghub-backup.timer" /etc/systemd/system/boostinghub-backup.timer
  systemctl daemon-reload
fi

echo "==> Restart web + bot"
systemctl enable boostinghub-web boostinghub-discord-bot
systemctl restart boostinghub-web
systemctl restart boostinghub-discord-bot

echo "==> Enable timers"
systemctl enable --now boostinghub-character-sync.timer
systemctl enable --now boostinghub-backup.timer

sleep 2
echo "==> Post-deploy smoke"
systemctl is-active boostinghub-web
systemctl is-active boostinghub-discord-bot || true
curl -sS -o /dev/null -w "local=%{http_code}\n" http://127.0.0.1:3000/ || true
curl -sS -o /dev/null -w "https=%{http_code}\n" https://phoenix-star.de/ || true
echo "DEPLOY_OK before=${BEFORE_SHA} after=${AFTER_SHA}"
