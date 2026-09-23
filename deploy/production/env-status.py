#!/usr/bin/env python3
"""Report production .env configuration WITHOUT printing secret values.

Read-only. For every key the application or Discord bot reads, prints one of
MISSING / EMPTY / SET. Only genuinely non-secret values (public URLs, numeric
Discord snowflake ids, flags, intervals) are shown; secrets show their length
only; database URLs show scheme/user/host/port/database only, with the
password and every query parameter value hidden.

    sudo python3 /var/www/boostinghub/deploy/production/env-status.py
    ENV_FILE=/path/to/.env python3 env-status.py

Exit status is 1 when a required key is missing/empty or a development-only
switch is enabled, so it can gate operator checklists.
"""
import os
import stat
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

ENV_FILE = Path(os.environ.get("ENV_FILE", "/var/www/boostinghub/.env"))

# (key, kind) — kind decides how a SET value may be shown:
#   secret: length only · public: value · db: URL without password or query values
GROUPS = {
    "web (required)": [
        ("DATABASE_URL", "db"),
        ("BETTER_AUTH_SECRET", "secret"),
        ("BETTER_AUTH_URL", "public"),
        ("DISCORD_CLIENT_ID", "public"),
        ("DISCORD_CLIENT_SECRET", "secret"),
        ("BOOSTINGHUB_BOT_API_TOKEN", "secret"),
    ],
    "discord bot (required)": [
        ("DISCORD_BOT_TOKEN", "secret"),
        ("DISCORD_APPLICATION_ID", "public"),
        ("DISCORD_GUILD_ID", "public"),
        ("BOOSTINGHUB_API_BASE_URL", "public"),
    ],
    "discord run channels (optional)": [
        ("DISCORD_RUN_CATEGORY_ID", "public"),
        ("DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID", "public"),
        ("DISCORD_RUN_NEXT_MARKER_CHANNEL_ID", "public"),
        ("DISCORD_RUN_ARCHIVE_CATEGORY_ID", "public"),
        ("DISCORD_RUN_ARCHIVE_LOG_CHANNEL_ID", "public"),
        ("DISCORD_PING_ROLE_TANK_ID", "public"),
        ("DISCORD_PING_ROLE_HEALER_ID", "public"),
        ("DISCORD_PING_ROLE_DPS_ID", "public"),
        ("DISCORD_SIGNUP_CHANNEL_ID", "public"),
        ("DISCORD_ROSTER_CHANNEL_ID", "public"),
        ("DISCORD_SYNC_INTERVAL_MS", "public"),
        ("DISCORD_BOOSTER_TICKET_URL", "public"),
    ],
    "integrations (optional)": [
        ("BLIZZARD_CLIENT_ID", "secret"),
        ("BLIZZARD_CLIENT_SECRET", "secret"),
        ("BLIZZARD_REDIRECT_URI", "public"),
        ("BLIZZARD_SYNC_STALE_MINUTES", "public"),
        ("WARCRAFT_LOGS_CLIENT_ID", "secret"),
        ("WARCRAFT_LOGS_CLIENT_SECRET", "secret"),
        ("RAIDER_IO_ACCESS_KEY", "secret"),
    ],
    "development only (must be off/unset in production)": [
        ("DEV_AUTH_ENABLED", "public"),
        ("DEV_ACCOUNT_BOOTSTRAP_ENABLED", "public"),
        ("DEV_AUTH_PASSWORD", "secret"),
        ("DEV_ADMIN_DISCORD_USER_ID", "public"),
    ],
    "tests only (unused by the production runtime)": [
        ("TEST_DATABASE_URL", "db"),
    ],
}
REQUIRED_GROUPS = {"web (required)", "discord bot (required)"}
DEV_FLAGS = {"DEV_AUTH_ENABLED", "DEV_ACCOUNT_BOOTSTRAP_ENABLED"}


def unquote_outer(value: str) -> str:
    """Trim whitespace and remove ONE matching outer pair of "..." or '...'; other quotes are kept."""
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def parse(raw: bytes):
    """Deliberately small .env format: KEY=value lines, optional leading "export ",
    blank lines and full-line # comments ignored, CRLF tolerated, one matching outer
    quote pair removed. Not a shell parser: no inline comments, no escapes."""
    text = raw.decode("utf-8")
    values, duplicates = {}, set()
    for line in text.replace("\r\n", "\n").split("\n"):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export "):].strip()
        if key in values:
            duplicates.add(key)
        values[key] = unquote_outer(value)
    return values, duplicates, "\r" in text


def redact_db(value: str) -> str:
    """Show scheme, user, host, port and database only. The userinfo password
    (split at the LAST '@') and every query parameter VALUE are hidden; query
    parameter names are listed, since options like sslpassword can be secret."""
    try:
        parts = urlsplit(value)
        port = parts.port
        host = parts.hostname
    except ValueError:
        return "<unparseable, hidden>"
    userinfo, at, _ = parts.netloc.rpartition("@")
    user, has_password = userinfo.partition(":")[0], ":" in userinfo
    location = host or ""
    if host and ":" in host:
        location = f"[{host}]"
    if port is not None:
        location += f":{port}"
    auth = (f"{user}:<hidden>@" if has_password else f"{user}@") if at else ""
    shown = f"{parts.scheme}://{auth}{location}{parts.path}"
    names = [key for key, _ in parse_qsl(parts.query, keep_blank_values=True)]
    if names:
        shown += "?" + "&".join(f"{name}=<hidden>" for name in names)
    return shown


def show(value: str, kind: str) -> str:
    if kind == "public":
        return f"SET ({value})"
    if kind == "db":
        return f"SET ({redact_db(value)})"
    return f"SET (len={len(value)})"


def main() -> int:
    if not ENV_FILE.is_file():
        print(f"env file not found: {ENV_FILE}")
        return 1

    info = ENV_FILE.stat()
    mode = stat.S_IMODE(info.st_mode)
    print(f"file: {ENV_FILE} mode={mode:o}" + ("" if mode & 0o077 == 0 else "  WARNING: readable by group/other (expected 600)"))

    values, duplicates, has_cr = parse(ENV_FILE.read_bytes())
    if has_cr:
        print("WARNING: file contains CR characters (CRLF); systemd EnvironmentFile may keep them in values")
    problems = 0
    for key in sorted(duplicates):
        if key == "DATABASE_URL":
            # backup-db.sh refuses to guess and fails, so this blocks backups and deploys.
            problems += 1
            print(f"PROBLEM: {key} is defined more than once (backups refuse to run)")
        else:
            print(f"WARNING: {key} is defined more than once (last one wins)")
    for group, keys in GROUPS.items():
        print(f"\n[{group}]")
        for key, kind in keys:
            value = values.get(key)
            if value is None:
                status = "MISSING"
            elif value == "":
                status = "EMPTY"
            else:
                status = show(value, kind)
            if group in REQUIRED_GROUPS and value in (None, ""):
                problems += 1
                status += "  <-- required"
            if key in DEV_FLAGS and value not in (None, "", "false", "0"):
                problems += 1
                status += "  <-- must be false in production"
            print(f"  {key}: {status}")

    known = {key for keys in GROUPS.values() for key, _ in keys}
    unknown = sorted(set(values) - known)
    if unknown:
        # Names only — values of unrecognised keys are never printed.
        print(f"\n[other keys present, values hidden]\n  " + ", ".join(unknown))

    print(f"\n{'OK' if problems == 0 else f'{problems} problem(s)'}")
    return 0 if problems == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
