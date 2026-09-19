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

updates = {
    k: v.replace("\r", "").replace("\n", "").strip()
    for k, v in os.environ.items()
    if k in allowed and v.replace("\r", "").replace("\n", "").strip() != ""
}
if not updates:
    raise SystemExit("no allowed keys provided")

raw = env_path.read_bytes().decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")
lines = raw.splitlines()
seen = set()
out = []
for line in lines:
    if not line or line.lstrip().startswith("#") or "=" not in line:
        out.append(line)
        continue
    key, _, _ = line.partition("=")
    if key in updates:
        val = updates[key].replace("\\", "\\\\").replace('"', '\\"')
        out.append(f'{key}="{val}"')
        seen.add(key)
    else:
        out.append(line)
for key, value in updates.items():
    if key not in seen:
        val = value.replace("\\", "\\\\").replace('"', '\\"')
        out.append(f'{key}="{val}"')
env_path.write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")
print("updated_keys=" + ",".join(sorted(updates)))
PY

chown boostinghub:boostinghub "${ENV_FILE}"
chmod 600 "${ENV_FILE}"
