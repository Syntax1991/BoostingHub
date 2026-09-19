#!/usr/bin/env bash
# Pull latest main on the production host, migrate, rebuild web, restart web + bot.
set -euo pipefail

APP_DIR=/var/www/boostinghub
BRANCH="${1:-main}"

cd "${APP_DIR}"
echo "==> Before"
sudo -u boostinghub git -C "${APP_DIR}" rev-parse --short HEAD
sudo -u boostinghub git -C "${APP_DIR}" branch --show-current

echo "==> Fetch / pull ${BRANCH}"
sudo -u boostinghub git -C "${APP_DIR}" fetch --all --prune
sudo -u boostinghub git -C "${APP_DIR}" checkout "${BRANCH}"
sudo -u boostinghub git -C "${APP_DIR}" reset --hard "origin/${BRANCH}"

echo "==> npm install"
sudo -u boostinghub npm install --legacy-peer-deps

echo "==> Prisma emit + migrate"
sudo -u boostinghub npm run db:emit
sudo -u boostinghub npm run db:migrate

echo "==> Build"
sudo -u boostinghub npm run build

echo "==> Restart web + Discord bot"
systemctl restart boostinghub-web
systemctl enable boostinghub-discord-bot 2>/dev/null || true
systemctl restart boostinghub-discord-bot

sleep 3
echo "==> After"
sudo -u boostinghub git -C "${APP_DIR}" rev-parse --short HEAD
sudo -u boostinghub git -C "${APP_DIR}" log -1 --oneline
systemctl is-active boostinghub-web
systemctl is-active boostinghub-discord-bot
curl -sS -o /dev/null -w "https=%{http_code}\n" https://phoenix-star.de/
echo DEPLOY_OK
