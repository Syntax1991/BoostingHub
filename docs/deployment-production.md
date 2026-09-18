# Production deployment (Linux VPS)

This runbook documents the **established** BoostingHub production topology on a
Debian + Plesk host. It deliberately does **not** introduce Docker or a second
reverse proxy when Plesk/Apache and host PostgreSQL already own the stack.

Windows Task Scheduler tooling under `scripts/windows/` is for local Windows
development only. Production Character sync uses **systemd timers**.

## Architecture

```text
Internet
  → :443 Apache/Plesk (TLS)
  → 127.0.0.1:3000 Next.js (boostinghub-web.service)

Discord bot process (boostinghub-discord-bot.service)
  → BOOSTINGHUB_API_BASE_URL=http://127.0.0.1:3000

PostgreSQL (host)
  → 127.0.0.1:5432 only (not public)

Character sync (oneshot)
  → boostinghub-character-sync.timer (~15 minutes)
  → npm run sync:characters

Database backup
  → boostinghub-backup.timer (daily)
  → /var/backups/boostinghub/*.dump
```

App directory: `/var/www/boostinghub`  
Service user: `boostinghub`  
Env file: `/var/www/boostinghub/.env` (`chmod 600`)

## Prerequisites

- Debian (or compatible) with systemd
- Node.js matching project (currently Node 24.x)
- PostgreSQL 15+ on localhost
- Git access to `Syntax1991/BoostingHub`
- Domain with DNS A record → VPS public IP
- Apache/Plesk (or another existing reverse proxy) terminating TLS
- Discord application (OAuth + bot)
- Battle.net API client credentials
- Optional: Warcraft Logs API client

## Environment variable names

Never commit real values. See `.env.example` for comments.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Production DB only |
| `TEST_DATABASE_URL` | yes for tests | Must **not** equal `DATABASE_URL`; unused by production runtime |
| `BETTER_AUTH_SECRET` | yes | Strong random; never reuse example |
| `BETTER_AUTH_URL` | yes | Canonical HTTPS origin, e.g. `https://example.com` |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | yes for login | OAuth |
| `DISCORD_BOT_TOKEN` / `DISCORD_APPLICATION_ID` | yes for bot | Bot process |
| `DISCORD_GUILD_ID` | recommended | Guild-scoped command registration |
| Discord channel/category IDs | as needed | See `.env.example` |
| `BOOSTINGHUB_BOT_API_TOKEN` | yes | Shared secret web↔bot |
| `BOOSTINGHUB_API_BASE_URL` | yes | Usually `http://127.0.0.1:3000` |
| `BLIZZARD_CLIENT_ID` / `BLIZZARD_CLIENT_SECRET` | yes for Blizzard features | App client credentials |
| `BLIZZARD_REDIRECT_URI` | yes if Battle.net connect used | Must match developer portal |
| `BLIZZARD_SYNC_STALE_MINUTES` | recommended | Production default **120** |
| `WARCRAFT_LOGS_CLIENT_ID` / `SECRET` | optional | Discovery only |
| `DEV_AUTH_ENABLED` | production: `false` | Hard ignore patterns also exist |
| `DEV_ACCOUNT_BOOTSTRAP_ENABLED` | production: `false` | Hard-disabled in production |

## OAuth callback URLs

Configure these in provider portals (manual):

- Discord OAuth redirect: `https://<HOST>/api/auth/callback/discord`
- Battle.net redirect: `https://<HOST>/api/integrations/battlenet/callback`

Keep localhost redirects during transition if the provider allows multiple URLs.

## Initial deploy (high level)

1. Create system user + `/var/www/boostinghub`
2. Clone `main`, install dependencies
3. Create PostgreSQL role/DB (`boostinghub`), write `.env` (`chmod 600`)
4. `npm run db:emit && npm run db:migrate` (**never** `migrate reset`)
5. `npm run build`
6. Install systemd units from `deploy/production/systemd/`
7. Enable web + bot + character-sync timer + backup timer
8. Point reverse proxy at `http://127.0.0.1:3000`
9. Issue TLS certificate
10. Set `BETTER_AUTH_URL=https://<HOST>`
11. Configure Discord / Battle.net portal callbacks
12. Smoke-test login, characters, bot, sync, backup

Helper scripts (run as root on the VPS):

```bash
bash /var/www/boostinghub/deploy/production/backup-db.sh
bash /var/www/boostinghub/deploy/production/deploy.sh main
```

## Update deploy

```bash
bash /var/www/boostinghub/deploy/production/deploy.sh main
```

Sequence: backup → git ff-only to `main` → npm install → Prisma migrate → build → restart web/bot → ensure timers.

## Migrations

- Command: `npm run db:migrate` (Prisma 8 `prisma db migrate --yes`)
- Always backup first on an existing production DB
- Never `prisma migrate reset` in production
- Never run Vitest / `test:db:reset` against production

## Character sync policy

| Concern | Value |
| --- | --- |
| External tick | ~15 minutes (`boostinghub-character-sync.timer`) |
| Stale threshold | 120 minutes (`BLIZZARD_SYNC_STALE_MINUTES`) |
| Manual Refresh cooldown | ~60 seconds (unchanged) |
| App-owned timer | none |
| Overlap | PostgreSQL advisory lock |

Manual one-shot:

```bash
systemctl start boostinghub-character-sync.service
journalctl -u boostinghub-character-sync -n 50 --no-pager
```

## Backups

- Script: `deploy/production/backup-db.sh`
- Location: `/var/backups/boostinghub/`
- Format: `pg_dump --format=custom`
- Retention: 14 days (configurable via `RETENTION_DAYS`)
- Validate: non-zero size + `pg_restore --list`

Restore (operator decision only — never automatic):

```bash
# Example only — choose a dump deliberately
pg_restore --clean --if-exists --dbname="$DATABASE_URL" /var/backups/boostinghub/boostinghub-YYYYMMDD.dump
```

## Rollback

1. Note current SHA and latest backup path
2. `git checkout <previous-sha>` under `/var/www/boostinghub`
3. `npm install && npm run build && systemctl restart boostinghub-web boostinghub-discord-bot`
4. Do **not** auto-reverse migrations; restore a DB dump only with explicit operator approval

## Operations cheatsheet

```bash
systemctl status boostinghub-web boostinghub-discord-bot
systemctl list-timers 'boostinghub-*'
journalctl -u boostinghub-web -f
journalctl -u boostinghub-discord-bot -f
journalctl -u boostinghub-character-sync -n 100 --no-pager
ls -lh /var/backups/boostinghub
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
curl -sS -o /dev/null -w '%{http_code}\n' https://<HOST>/
```

## Security checklist

- PostgreSQL listens on `127.0.0.1` only
- Next.js binds `127.0.0.1:3000` (not public)
- Public inbound: 22 / 80 / 443
- `.env` mode `600`, owned by `boostinghub`
- No secrets in Git, systemd unit bodies, or docs
- Discord/Battle.net secrets never printed in logs/reports

## Production smoke checklist

- [ ] `https://<HOST>/` loads
- [ ] Discord sign-in works (no redirect loop)
- [ ] Returning login maps to same User
- [ ] `/profile` Active Sessions renders (no raw tokens)
- [ ] `/characters` loads (Availability, lockouts, WCL, Battle.net UI)
- [ ] `/runs`, `/my-runs`, `/manage/runs` load for authorized roles
- [ ] Discord bot online
- [ ] `systemctl start boostinghub-character-sync.service` exits successfully (0 candidates OK)
- [ ] Backup file exists, non-zero, `pg_restore --list` OK

## Out of scope

- Docker Compose replacement of this host stack
- Copying local/dev databases into production
- Kubernetes
- Full observability platforms
