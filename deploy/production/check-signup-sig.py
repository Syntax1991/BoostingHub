#!/usr/bin/env python3
from pathlib import Path
import os
import subprocess
import urllib.parse

url = None
for line in Path("/var/www/boostinghub/.env").read_text().splitlines():
    if line.startswith("DATABASE_URL="):
        url = line.split("=", 1)[1].strip().strip('"').strip("'")
        break
if not url:
    raise SystemExit("DATABASE_URL missing")

u = urllib.parse.urlparse(url)
env = {**os.environ, "PGPASSWORD": u.password or ""}


def q(sql: str) -> str:
    return subprocess.check_output(
        [
            "psql",
            "-h",
            u.hostname or "localhost",
            "-p",
            str(u.port or 5432),
            "-U",
            u.username,
            "-d",
            u.path.lstrip("/"),
            "-tAc",
            sql,
        ],
        env=env,
        text=True,
    ).strip()


print("discord_tables:")
print(q(
    "SELECT schemaname || '.' || tablename FROM pg_tables "
    "WHERE tablename ILIKE '%discord%' OR tablename ILIKE '%run%post%' "
    "ORDER BY 1;"
))

# Try common Prisma Next naming
candidates = [
    'public."RunDiscordPost"',
    'app."RunDiscordPost"',
    'public.run_discord_post',
    'app.run_discord_post',
]
for table in candidates:
    try:
        n = q(f"SELECT COUNT(*) FROM {table};")
        print(f"ok {table} count={n}")
        print(
            q(
                "SELECT "
                "COUNT(*) FILTER (WHERE \"lastSignupSignature\" LIKE '%mention-v4-content-summary%') AS v4, "
                "COUNT(*) FILTER (WHERE \"lastSignupSignature\" LIKE '%mention-v2-raidlead%') AS v2, "
                "COUNT(*) AS total "
                f"FROM {table} WHERE \"signupMessageId\" IS NOT NULL;"
            )
        )
        break
    except subprocess.CalledProcessError as e:
        print(f"fail {table}: {(e.stderr or b'').decode()[:120] if isinstance(e.stderr, bytes) else e}")
