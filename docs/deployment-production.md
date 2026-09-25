# Production operations (Linux VPS)

The runbook for the live BoostingHub production host at **https://phoenix-star.de**.
It documents the stack as it actually runs. It deliberately introduces **no**
Docker stack and **no** second reverse proxy: Plesk/Apache and host
PostgreSQL own those concerns.

Windows Task Scheduler tooling under `scripts/windows/` is for local development
only. Production scheduling is systemd timers.

## Architecture

```text
Internet
  → :80 / :443  Apache (managed by Plesk, TLS)
  → 127.0.0.1:3000  Next.js            boostinghub-web.service

Discord gateway
  ↔ Discord bot (one process)           boostinghub-discord-bot.service
      → BOOSTINGHUB_API_BASE_URL=http://127.0.0.1:3000

PostgreSQL 17 (host package)           postgresql.service
  → 127.0.0.1:5432 / [::1]:5432 only — never public

Character sync (oneshot, every 15 min) boostinghub-character-sync.timer → .service
  → npm run sync:characters (overlap guarded by a PostgreSQL advisory lock)

Database backup (oneshot, daily 03:15)  boostinghub-backup.timer → .service
  → /usr/local/libexec/boostinghub/backup-db.sh → /var/backups/boostinghub/*.dump
```

| Item | Value |
| --- | --- |
| Host OS | Debian 13 with systemd |
| Runtime | Node.js 24.x / npm 11, Python 3 (ops scripts), PostgreSQL 17 client tools |
| App checkout | `/var/www/boostinghub` (Git clone of `Syntax1991/BoostingHub`, branch `main`) |
| Service user | `boostinghub` (owns the checkout, runs web, bot, character sync) |
| Env file | `/var/www/boostinghub/.env`, owner `boostinghub`, mode `600` |
| Backups | `/var/backups/boostinghub/`, owner `root`, mode `700` |
| Root-owned ops executables | `/usr/local/libexec/boostinghub/` |

## Tracked operations files

| Path | Purpose |
| --- | --- |
| `deploy/update-server.sh` | **The** release helper for normal updates (see below) |
| `deploy/production/systemd/*.service`, `*.timer` | Reference copies of the six live units |
| `deploy/production/backup-db.sh` | Backup script; production runs a root-owned installed copy |
| `deploy/production/env-status.py` | Read-only `.env` check that never prints secret values. Database URLs show only scheme/user/host/port/database; the password and every query-parameter value are hidden. |
| `deploy/production/*.test.sh` | Offline tests for the two scripts above (no DB, no credentials) |

**Units and root-owned executables are never installed by a normal deploy.**
`update-server.sh` does not copy unit files, run `systemctl enable`, run
`daemon-reload`, or install anything under `/usr/local/libexec`. Changing any of
those is a deliberate operator step (see [Changing systemd units or the backup
script](#changing-systemd-units-or-the-backup-script)). The live host is
authoritative. Keep the tracked copies identical to what is installed.

The checkout may contain untracked one-off diagnostic scripts. The release
helper preserves them. They are not part of the supported tooling.

## Normal update deploy

```bash
sudo bash /var/www/boostinghub/deploy/update-server.sh
```

Optional first argument: branch (default `main`). Success ends with
`DEPLOY_OK before=<sha> after=<sha>`. Any failed step aborts, and every later
step is skipped.

Safety contract, in order:

1. Must run as root.
2. The web, bot and backup units must exist.
3. `boostinghub-backup.service` must be `Type=oneshot` with
   `RemainAfterExit=no`. Only then does `systemctl start` block until the dump
   finishes and report a real `Result`.
4. The tracked working tree must be clean. Tracked modifications abort; untracked
   operational files are preserved (no `reset --hard`, no `git clean`, no forced
   checkout).
5. Records the full pre-deploy SHA.
6. **Database backup first**: `systemctl start boostinghub-backup.service` and
   require `Result=success` before any Git, dependency or schema change.
7. `git fetch origin --prune`, `git checkout <branch>`, `git pull --ff-only`.
   Anything other than a fast-forward aborts.
8. `npm ci --legacy-peer-deps`
9. `npm run db:emit`
10. `npm run typecheck`, then `npm run build`. Both must pass **before** the live
    schema is touched.
11. `npm run db:migrate` (never `migrate reset`). A failure aborts before any restart.
12. Restart `boostinghub-web.service`, then `boostinghub-discord-bot.service`.
13. Both must be `active`.
14. `https://phoenix-star.de/` must answer HTTP 200 (with a short startup retry window).

Timers are not touched. Git operations and npm run as `boostinghub`.

After a deploy, run the [production smoke checklist](#production-smoke-checklist).

## Initial system setup

This is for a fresh host only. Every step is an explicit operator action, as root.
Commands never rely on the shell's current directory: application `npm`
commands always run after `cd /var/www/boostinghub`, and install commands use
absolute paths.

1. Create the service user and checkout:

   ```bash
   useradd --system --create-home --shell /usr/sbin/nologin boostinghub
   install -d -o boostinghub -g boostinghub -m 0770 /var/www/boostinghub
   sudo -u boostinghub git clone --branch main https://github.com/Syntax1991/BoostingHub.git /var/www/boostinghub
   ```

2. Create the PostgreSQL role and database (`boostinghub`), listening on localhost only.
3. Write `/var/www/boostinghub/.env` from `.env.example` (`chown boostinghub:boostinghub`,
   `chmod 600`), then check it without printing secrets:
   `python3 /var/www/boostinghub/deploy/production/env-status.py`
   Production must have `DEV_AUTH_ENABLED=false` and `DEV_ACCOUNT_BOOTSTRAP_ENABLED=false`.
4. Install, validate and build as `boostinghub`, from the app directory:

   ```bash
   cd /var/www/boostinghub
   sudo -u boostinghub npm ci --legacy-peer-deps
   sudo -u boostinghub npm run db:emit
   sudo -u boostinghub npm run typecheck
   sudo -u boostinghub npm run build
   sudo -u boostinghub npm run db:migrate
   ```

5. Install the root-owned backup executable. A root service must never execute a
   file the app user can write:

   ```bash
   install -d -o root -g root -m 0755 /usr/local/libexec/boostinghub
   install -o root -g root -m 0755 \
     /var/www/boostinghub/deploy/production/backup-db.sh \
     /usr/local/libexec/boostinghub/backup-db.sh
   install -d -o root -g root -m 0700 /var/backups/boostinghub
   ```

6. Install the units (root-owned, `0644`), reload, enable:

   ```bash
   U=/var/www/boostinghub/deploy/production/systemd
   install -o root -g root -m 0644 \
     "$U/boostinghub-web.service" "$U/boostinghub-discord-bot.service" \
     "$U/boostinghub-character-sync.service" "$U/boostinghub-character-sync.timer" \
     "$U/boostinghub-backup.service" "$U/boostinghub-backup.timer" \
     /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now boostinghub-web.service boostinghub-discord-bot.service
   systemctl enable --now boostinghub-character-sync.timer boostinghub-backup.timer
   ```

7. Take and validate the first backup: `systemctl start boostinghub-backup.service`,
   then check `systemctl show -p Result --value boostinghub-backup.service` is `success`.
8. In Plesk, point the domain's reverse proxy at `http://127.0.0.1:3000` and issue
   the TLS certificate there. Do not add a second proxy.
9. Set `BETTER_AUTH_URL=https://phoenix-star.de` and register the provider callbacks:
   - Discord OAuth: `https://phoenix-star.de/api/auth/callback/discord`
   - Battle.net: `https://phoenix-star.de/api/integrations/battlenet/callback`
10. Register slash commands (again whenever the command list changes):

    ```bash
    cd /var/www/boostinghub
    sudo -u boostinghub npm run bot:register-commands
    ```

11. Run the smoke checklist.

## Changing systemd units or the backup script

Edit the tracked file on a branch and merge it. Then, **as a separate step from
the application deploy**, install it on the host:

```bash
# after the change is on the server checkout (normal update deploy)
cd /var/www/boostinghub
install -o root -g root -m 0644 deploy/production/systemd/<unit> /etc/systemd/system/<unit>
systemctl daemon-reload
# backup script:
install -o root -g root -m 0755 deploy/production/backup-db.sh /usr/local/libexec/boostinghub/backup-db.sh
```

Then restart only the affected unit, or wait for its timer. Verify the installed
file matches the tracked one (`cmp` / `sha256sum`). After a backup unit change,
confirm `systemctl show -p Type -p RemainAfterExit boostinghub-backup.service`
still shows `oneshot` / `no`, or the next `update-server.sh` run refuses to deploy.

## Backups

| Concern | Value |
| --- | --- |
| Schedule | `boostinghub-backup.timer`: daily 03:15 + up to 10 min jitter, `Persistent=true` |
| Pre-release | `update-server.sh` takes one before every deploy |
| Executable | `/usr/local/libexec/boostinghub/backup-db.sh` (root-owned copy of `deploy/production/backup-db.sh`) |
| Location | `/var/backups/boostinghub/boostinghub-<UTC stamp>.dump` |
| Format | `pg_dump --format=custom` |
| Permissions | directory `700`, files `600` (root) |
| Validation | non-zero size and `pg_restore --list`. Empty, failed or invalid dumps are deleted and the run fails. |
| Retention | 14 days (`RETENTION_DAYS`). Only `boostinghub-*.dump` directly in the directory. |
| Credentials | `DATABASE_URL` read from `.env`; the password goes to `pg_dump` through a private temporary `PGPASSFILE`, never on the command line, never printed |
| `.env` format | `KEY=value` per line, optional `export `, `#` comment lines, one matching outer `"…"`/`'…'` pair removed (other quotes are kept). A **missing or duplicated `DATABASE_URL` fails the backup** before `pg_dump` runs. It never guesses which duplicate is meant. |

Manual backup and check:

```bash
systemctl start boostinghub-backup.service
systemctl show -p Result --value boostinghub-backup.service   # success
ls -lt /var/backups/boostinghub | head -3
pg_restore --list /var/backups/boostinghub/<file>.dump >/dev/null && echo valid
```

## Restore (operator decision only)

A restore is **never** automatic and never part of a deploy or rollback script.
It overwrites production data, so it requires an explicit operator decision.

1. Take a fresh backup of the current state first:
   `systemctl start boostinghub-backup.service`, and check its `Result` is `success`.
2. Stop **both timers**, so neither a character sync nor a scheduled `pg_dump` can
   start mid-restore, then stop the writers. Check that no run is still in progress:

   ```bash
   systemctl stop boostinghub-character-sync.timer boostinghub-backup.timer
   systemctl stop boostinghub-discord-bot.service boostinghub-web.service
   systemctl is-active boostinghub-character-sync.service boostinghub-backup.service   # both inactive
   ```

3. Make sure the application code on disk matches the schema in the dump (see Rollback).
4. Restore as the PostgreSQL superuser via local peer authentication, so no password
   appears on a command line:

   ```bash
   sudo -u postgres pg_restore --clean --if-exists --dbname=<database> \
     /var/backups/boostinghub/<chosen>.dump
   ```

5. Restore the normal state: start the services, then re-enable both timers.
   Verify all four are `active`, then run the smoke checklist.

   ```bash
   systemctl start boostinghub-web.service boostinghub-discord-bot.service
   systemctl start boostinghub-character-sync.timer boostinghub-backup.timer
   systemctl is-active boostinghub-web boostinghub-discord-bot \
     boostinghub-character-sync.timer boostinghub-backup.timer
   ```

Never run `prisma migrate reset`, drop the schema or recreate the database as a
"fix". Migrations are never auto-reversed.

## Rollback

**Application rollback does not roll back the schema.** Migrations applied by a
bad release stay applied. Older code is only known to work against a newer schema
if you have verified it. Check what changed first:

```bash
git -C /var/www/boostinghub diff --stat <good-sha> <bad-sha> -- migrations/
```

An empty diff means no schema difference. Additive migrations are often tolerated
by older code, but that is not guaranteed. A database restore is a separate,
explicitly approved step (see Restore).

### Preferred: revert on `main`, then deploy normally

Revert the bad change on GitHub (`git revert`, a PR, then merge), then run the
normal `update-server.sh`. You get a fresh backup, the fast-forward guard,
validation and verified restarts, and the checkout stays on `main`.

### Emergency: run a known-good commit directly

Use this only when waiting for a revert on `main` is not acceptable. Run as root:

```bash
cd /var/www/boostinghub
systemctl start boostinghub-backup.service                 # fresh backup first
systemctl show -p Result --value boostinghub-backup.service  # must be success
sudo -u boostinghub git status --porcelain --untracked-files=no   # must be empty
sudo -u boostinghub git rev-parse HEAD                       # record the bad SHA
sudo -u boostinghub git fetch origin --prune
sudo -u boostinghub git checkout --detach <good-sha>
sudo -u boostinghub npm ci --legacy-peer-deps
sudo -u boostinghub npm run db:emit
sudo -u boostinghub npm run typecheck
sudo -u boostinghub npm run build
systemctl restart boostinghub-web.service boostinghub-discord-bot.service
```

- Do **not** run `db:migrate` here. It only moves forward and never undoes newer
  migrations.
- Do not use `git reset --hard` or `git clean` for rollbacks.
- The checkout is now on a **detached HEAD** (`git branch --show-current` prints
  nothing). Local `main` still points at the bad commit.
- **Reconcile back to `main`**: once `main` on GitHub contains the fix or revert,
  run the normal `update-server.sh`. It checks out `main` and fast-forwards it.
  Running it **before** `main` is fixed redeploys the bad commit.

## Optional: temporary Run voice channels

When a Run starts, the bot can create a voice channel `Raid with <Raid Lead>`
and link it in Raid Invite DMs. It is kept while the Run is `IN_PROGRESS`, then
deleted once the Run is `COMPLETED` / `CANCELLED` / app-archived **and** nobody
is connected (see `docs/features/discord-bot.md` § Temporary Run voice channels).
It is off until configured:

1. In Discord, create a dedicated category for these channels (not the text Run
   category). Its permissions are inherited by every Run voice channel; give the
   bot **View Channel**, **Connect** and **Manage Channels** there.
2. Add `DISCORD_RUN_VOICE_CATEGORY_ID="<category id>"` to `/var/www/boostinghub/.env`
   and check it with `env-status.py`.
3. Restart the bot so it picks up the variable and the `GuildVoiceStates`
   gateway intent (non-privileged, no Developer Portal toggle):
   `systemctl restart boostinghub-discord-bot.service` (or the next normal deploy).

An id that does not resolve to a category is logged by the bot on every pass
and nothing is created.

## Optional: Discord Support tickets

The bot can host a Support panel with private ticket channels (see
`docs/features/discord-bot.md` § Support tickets). It is off while every
`DISCORD_TICKET_*` variable is unset. Configure it as one group — the bot
refuses to start with only some of them set:

1. In Discord, create (or pick): the panel channel, a dedicated ticket category
   (not a Run, voice or archive category), and a Staff-only archive log channel.
   Note the ids of the Admin, Moderator, Raid Staff and M+ Staff roles.
2. Give the bot, in the ticket category: **View Channel, Manage Channels, Send
   Messages, Embed Links, Attach Files, Read Message History**; in the archive
   log: **View Channel, Send Messages, Embed Links, Attach Files**; in the panel
   channel: **View Channel, Send Messages, Embed Links, Read Message History**.
   If the Staff roles are not mentionable, also allow **Mention @everyone, @here
   and All Roles** in the ticket category (the opening ping is still limited to
   the configured Staff roles). Do not grant Administrator, Manage Roles,
   Manage Server, Manage Webhooks, Move Members or Speak.
3. Add all seven `DISCORD_TICKET_*` ids to `/var/www/boostinghub/.env` and check
   them with `env-status.py` (it flags a partial group as a problem).
4. Deploy normally (the migration `20260925T0050_add_support_tickets` is
   applied by the deploy), then restart the bot. On ready it posts the panel
   once and logs `ticket panel: created`; later restarts log `unchanged` or
   `edited` and never post a duplicate.

Privacy notes: ticket channels deny `@everyone` explicitly; a reported
Booster with a known Discord id is explicitly denied, but Discord members with
the **Administrator** permission bypass channel overwrites. Attachments posted
in tickets are never downloaded to the VPS — transcripts keep only filenames
and Discord links. An `ORPHAN TICKET CHANNEL` log line names a channel that
must be deleted manually.

## Production smoke checklist

- [ ] `sudo -u boostinghub git -C /var/www/boostinghub rev-parse HEAD` is the expected SHA,
      and `git status --porcelain --untracked-files=no` is empty
- [ ] `https://phoenix-star.de/` returns 200 and shows Discord sign-in
- [ ] Signed out, `/dashboard`, `/settings`, `/notifications`, `/profile`,
      `/manage/runs` return 307 to `/?next=<same path>`
- [ ] Discord sign-in completes with no redirect loop; a returning login maps to the same user
- [ ] `/profile` renders, including Active Sessions (no raw tokens)
- [ ] `/characters` loads (availability, lockouts, WCL, Battle.net)
- [ ] `/runs`, `/my-runs` and `/manage/runs` (for authorized roles) load
- [ ] Discord bot shows online in the guild
- [ ] `systemctl is-active boostinghub-web boostinghub-discord-bot` shows both `active`
- [ ] Exactly one bot process tree:
      `systemd-cgls -u boostinghub-discord-bot.service --no-pager`
- [ ] `systemctl is-active boostinghub-character-sync.timer boostinghub-backup.timer`
      shows both `active`; `systemctl list-timers 'boostinghub-*'` shows the next runs
- [ ] Newest `/var/backups/boostinghub/*.dump` is non-empty and passes `pg_restore --list`
- [ ] Fresh logs are clean since the restart:
      `journalctl -u boostinghub-web --since "10 min ago"` and
      `journalctl -u boostinghub-discord-bot --since "10 min ago"` show no startup errors,
      schema errors, reconnect loops or repeating Unknown Channel lines

## Operations cheatsheet

```bash
systemctl status boostinghub-web boostinghub-discord-bot
systemctl list-timers 'boostinghub-*'
journalctl -u boostinghub-web -f
journalctl -u boostinghub-discord-bot -f
journalctl -u boostinghub-character-sync -n 100 --no-pager
systemctl start boostinghub-character-sync.service     # one-shot sync now
python3 /var/www/boostinghub/deploy/production/env-status.py
ls -lh /var/backups/boostinghub
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
curl -sS -o /dev/null -w '%{http_code}\n' https://phoenix-star.de/
```

## Security checklist

- PostgreSQL listens on `127.0.0.1` / `::1` only; Next.js binds `127.0.0.1:3000`.
- Public inbound: 22 / 80 / 443 only.
- `.env` is mode `600`, owned by `boostinghub`. No secrets in Git, unit files, docs or logs.
- Root services execute only root-owned files (`/usr/local/libexec/boostinghub/`),
  never files inside the app checkout.
- Ops scripts never print secret values. Use `env-status.py` rather than `cat .env`.
- Development switches (`DEV_AUTH_ENABLED`, `DEV_ACCOUNT_BOOTSTRAP_ENABLED`) stay `false`.

## Out of scope

- Docker/Compose replacement of this host stack, Kubernetes, a second reverse proxy
- Copying local or development databases into production
- Running Vitest or `test:db:reset` against production (tests use `TEST_DATABASE_URL` only)
