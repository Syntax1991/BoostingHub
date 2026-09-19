#!/usr/bin/env python3
"""Report production env key presence without printing secret values."""
from pathlib import Path
import re

text = Path("/var/www/boostinghub/.env").read_text()
vals = {}
for line in text.splitlines():
    if not line or line.lstrip().startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    vals[k] = v.strip().strip('"').strip("'")

need = [
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_BOT_TOKEN",
    "DISCORD_APPLICATION_ID",
    "DISCORD_GUILD_ID",
    "BOOSTINGHUB_BOT_API_TOKEN",
    "BOOSTINGHUB_API_BASE_URL",
    "BLIZZARD_CLIENT_ID",
    "BLIZZARD_CLIENT_SECRET",
    "BLIZZARD_REDIRECT_URI",
    "BLIZZARD_SYNC_STALE_MINUTES",
    "WARCRAFT_LOGS_CLIENT_ID",
    "WARCRAFT_LOGS_CLIENT_SECRET",
    "DEV_AUTH_ENABLED",
    "DEV_ACCOUNT_BOOTSTRAP_ENABLED",
]

safe_show = {
    "BETTER_AUTH_URL",
    "BLIZZARD_REDIRECT_URI",
    "BOOSTINGHUB_API_BASE_URL",
    "BLIZZARD_SYNC_STALE_MINUTES",
    "DEV_AUTH_ENABLED",
    "DEV_ACCOUNT_BOOTSTRAP_ENABLED",
}

for k in need:
    v = vals.get(k)
    if v is None:
        print(f"{k}: MISSING")
    elif v == "":
        print(f"{k}: EMPTY")
    elif k in safe_show:
        print(f"{k}: SET ({v})")
    elif k.startswith("DATABASE") or k.startswith("TEST_"):
        red = re.sub(r":([^:@/]+)@", ":***@", v)
        print(f"{k}: SET ({red})")
    else:
        print(f"{k}: SET (len={len(v)})")
