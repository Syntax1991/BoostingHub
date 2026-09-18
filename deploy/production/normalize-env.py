#!/usr/bin/env python3
"""Normalize /var/www/boostinghub/.env to Unix LF with proper KEY="value" quoting."""
from pathlib import Path

p = Path("/var/www/boostinghub/.env")
text = p.read_bytes().decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")
out = []
for line in text.splitlines():
    if not line.strip() or line.lstrip().startswith("#"):
        out.append(line.rstrip())
        continue
    if "=" not in line:
        out.append(line.rstrip())
        continue
    key, _, raw = line.partition("=")
    key = key.strip()
    raw = raw.strip()
    # Strip wrapping quotes if present (possibly unbalanced).
    if raw.startswith('"'):
        raw = raw[1:]
        if raw.endswith('"'):
            raw = raw[:-1]
    elif raw.startswith("'"):
        raw = raw[1:]
        if raw.endswith("'"):
            raw = raw[:-1]
    raw = raw.strip().replace("\n", "").replace("\r", "")
    # Escape any embedded quotes for shell/systemd.
    raw = raw.replace("\\", "\\\\").replace('"', '\\"')
    out.append(f'{key}="{raw}"')

p.write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")

# Verify critical keys
vals = {}
for line in p.read_text(encoding="utf-8").splitlines():
    if not line or line.lstrip().startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    if len(v) >= 2 and v[0] == v[-1] == '"':
        v = v[1:-1]
    vals[k] = v

for k in ("DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "BETTER_AUTH_URL"):
    v = vals.get(k, "")
    print(f"{k}: len={len(v)} ends_ok={not v.endswith(chr(10))} value_safe={k!r}")
print("client_id_digits", vals.get("DISCORD_CLIENT_ID", "").isdigit())
print("better_auth_url", vals.get("BETTER_AUTH_URL"))
print("file_ok")
