#!/usr/bin/env bash
# Upsert selected env keys into /var/www/boostinghub/.env without printing values.
# Usage: KEY=value KEY2=value2 bash upsert-env.sh
set -euo pipefail

ENV_FILE="${ENV_FILE:-/var/www/boostinghub/.env}"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "missing ${ENV_FILE}" >&2
  exit 1
fi

python3 - <<'PY'
import os
from pathlib import Path

env_path = Path(os.environ.get("ENV_FILE", "/var/www/boostinghub/.env"))
# Only keys explicitly listed here may be updated by this helper.
allowed = {
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_BOT_TOKEN",
    "DISCORD_APPLICATION_ID",
    "BLIZZARD_SYNC_STALE_MINUTES",
    "BETTER_AUTH_URL",
    "BLIZZARD_REDIRECT_URI",
    "BOOSTINGHUB_API_BASE_URL",
    "DEV_AUTH_ENABLED",
    "DEV_ACCOUNT_BOOTSTRAP_ENABLED",
    "HOSTNAME",
}

updates = {k: v for k, v in os.environ.items() if k in allowed and v != ""}
if not updates:
    raise SystemExit("no allowed keys provided")

lines = env_path.read_text().splitlines()
seen = set()
out = []
for line in lines:
    if not line or line.lstrip().startswith("#") or "=" not in line:
        out.append(line)
        continue
    key, _, _ = line.partition("=")
    if key in updates:
        out.append(f'{key}="{updates[key]}"')
        seen.add(key)
    else:
        out.append(line)
for key, value in updates.items():
    if key not in seen:
        out.append(f'{key}="{value}"')
env_path.write_text("\n".join(out) + "\n")
print("updated_keys=" + ",".join(sorted(updates)))
PY

chown boostinghub:boostinghub "${ENV_FILE}"
chmod 600 "${ENV_FILE}"
