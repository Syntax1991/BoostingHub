# BoostingHub operations guide

How the running system works: services, background jobs, configuration, monitoring, diagnosis, maintenance, backups and restores. Releases and rollback are in [DEPLOYMENT.md](DEPLOYMENT.md).

Values and the private server details (access, certificate, provider account) are never documented here. They are handed over privately.

## Contents

- [Contents](#contents)
- [Runtime overview](#runtime-overview)
- [Web and bot services](#web-and-bot-services)
- [Timers and background jobs](#timers-and-background-jobs)
  - [Running the character sync by hand](#running-the-character-sync-by-hand)
- [Configuration and environment variables](#configuration-and-environment-variables)
  - [Provider callbacks](#provider-callbacks)
  - [Discord bot permissions](#discord-bot-permissions)
- [Feature switch: boss-specific roster exceptions](#feature-switch-boss-specific-roster-exceptions)
- [Optional: fixed Run voice channels (Raid #1 / Raid #2)](#optional-fixed-run-voice-channels-raid-1--raid-2)
- [Optional: temporary Run voice channels](#optional-temporary-run-voice-channels)
- [Monitoring and logging](#monitoring-and-logging)
- [Diagnosis](#diagnosis)
  - [Operations cheatsheet](#operations-cheatsheet)
- [Discord Message Content access (transcripts and log-bot links)](#discord-message-content-access-transcripts-and-log-bot-links)
- [Warcraft Logs log bot (optional)](#warcraft-logs-log-bot-optional)
- [Regular maintenance](#regular-maintenance)
  - [Publishing the Discord guides](#publishing-the-discord-guides)
- [Backups](#backups)
- [Restore (operator decision only)](#restore-operator-decision-only)
- [Operational dependencies](#operational-dependencies)
- [Security checklist](#security-checklist)
- [Content Security Policy](#content-security-policy)
- [Operational non-goals](#operational-non-goals)

## Runtime overview

```text
Internet
  → :80 / :443  Apache reverse proxy (managed by a hosting panel, TLS)
  → 127.0.0.1:3000  Next.js            boostinghub-web.service

Discord gateway
  ↔ Discord bot (one process)           boostinghub-discord-bot.service
      → BOOSTINGHUB_API_BASE_URL=http://127.0.0.1:3000

PostgreSQL 17 (host package)           postgresql.service
  → 127.0.0.1:5432 / [::1]:5432 only — never public

Character sync (oneshot, every 15 min) boostinghub-character-sync.timer → .service
  → npm run sync:characters (overlap guarded by a PostgreSQL advisory lock)

Community schedule Draft release (oneshot, Mon 12:00 Europe/Berlin, Persistent) boostinghub-community-schedule.timer → .service
  → npm run materialize:community-schedule (overlap guarded by advisory lock 837462/4)
  → creates the Drafts of the raid ID starting the following Wednesday 06:00 (missed release: once on next start)

Battle.net link reconciliation (oneshot, 06:30 + 18:30 Europe/Berlin, Persistent) boostinghub-battlenet-links.timer → .service
  → npm run reconcile:battlenet-links (same exact-match backfill as Manage → Characters → "Link Battle.net matches")

Database backup (oneshot, daily 03:15)  boostinghub-backup.timer → .service
  → /usr/local/libexec/boostinghub/backup-db.sh → /var/backups/boostinghub/*.dump
```

| Item | Value |
| --- | --- |
| Host OS | Debian Linux with systemd |
| Runtime | Node.js 24.x / npm 11, Python 3 (ops scripts), PostgreSQL 17 client tools |
| App checkout | `/var/www/boostinghub` (Git clone of `Syntax1991/BoostingHub`, branch `main`) |
| Service user | `boostinghub` (owns the checkout, runs web, bot, character sync, community schedule materializer) |
| Env file | `/var/www/boostinghub/.env`, owner `boostinghub`, mode `600` |
| Backups | `/var/backups/boostinghub/`, owner `root`, mode `700` |
| Root-owned ops executables | `/usr/local/libexec/boostinghub/` |

## Web and bot services

| Unit | Type | Runs | Notes |
| --- | --- | --- | --- |
| `boostinghub-web.service` | long-running, `Restart=on-failure` | `npm run start -- -H 127.0.0.1 -p 3000` as `boostinghub` | Reverse proxy in front; never public directly |
| `boostinghub-discord-bot.service` | long-running, `Restart=on-failure` | `npm run bot:start` as `boostinghub` | **Exactly one instance.** Reaches the web app through `BOOSTINGHUB_API_BASE_URL` |

The web app keeps one in-memory voice-presence map, so one `next start` process is assumed. The bot polls `GET /api/bot/discord/sync` every `DISCORD_SYNC_INTERVAL_MS` (default 5 s) and ticks the Warcraft Logs audit about every 5 minutes and the player names every 10 minutes.

## Timers and background jobs

| Timer | Schedule | Job | Overlap guard |
| --- | --- | --- | --- |
| `boostinghub-character-sync.timer` | 2 min after boot, then every 15 min | `npm run sync:characters` | Advisory lock `(837462, 1)`, per-Character lock `(837463, …)` |
| `boostinghub-community-schedule.timer` | Mondays 12:00 Europe/Berlin, `Persistent=true` | `npm run materialize:community-schedule` | Advisory lock `837462/4` |
| `boostinghub-battlenet-links.timer` | 06:30 and 18:30 Europe/Berlin, `Persistent=true` | `npm run reconcile:battlenet-links` | Same result as Manage → Characters → "Link Battle.net matches" |
| `boostinghub-backup.timer` | Daily 03:15 plus jitter, `Persistent=true` | `/usr/local/libexec/boostinghub/backup-db.sh` as root | Not paused by a deploy; never runs code from the checkout |

The release helper pauses the first three during a deploy and restarts them only against a complete runtime.

### Running the character sync by hand

```bash
npm run sync:characters
npm run sync:characters -- --dry-run
```

`--dry-run` takes the same lock, counts eligible candidates and prints a summary without Blizzard calls or writes. Exit code `0` means completed, including "no candidates" and "another cycle already running". Non-zero means invalid configuration or an infrastructure error. Stale threshold and backoff rules: [Scheduled character sync](DEVELOPER.md#scheduled-character-sync).

## Configuration and environment variables

All configuration comes from `.env` (production: owner `boostinghub`, mode `600`). `.env.example` is the template. Check production with `python3 deploy/production/env-status.py`, which never prints secret values. **Never source the production `.env` in a shell and never `cat` it**, because that exposes the secrets in terminal output.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | all | PostgreSQL connection (secret) |
| `TEST_DATABASE_URL` | tests | Separate test database, never set on a production path |
| `BETTER_AUTH_SECRET` | web | Session signing, at least 32 characters (secret) |
| `BETTER_AUTH_URL` | web, bot links | Canonical app origin; required in production |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | web | Discord login (secret) |
| `DISCORD_BOOSTER_TICKET_URL` | web | Optional public "Apply via Discord" link |
| `DEV_AUTH_ENABLED`, `DEV_AUTH_PASSWORD` | web, seed | Development identities; ignored in production, keep `false` there |
| `DEV_ACCOUNT_BOOTSTRAP_ENABLED`, `DEV_ADMIN_DISCORD_USER_ID` | web | Local account restore; hard-disabled in production |
| `SKIP_DEV_DB_SCHEMA_CHECK` | dev | `1` skips the `predev` schema check |
| `SEED_CONFIRM_DATABASE` | dev, seed | Exact name of the local database that `npm run db:seed` may wipe. **Never set this in production.** |
| `BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET`, `BLIZZARD_REDIRECT_URI` | web, jobs | Blizzard API and Battle.net OAuth; required for Add Character (secret) |
| `BLIZZARD_SYNC_STALE_MINUTES` | jobs, web | Positive integer, default 120; anything else fails loudly |
| `WARCRAFT_LOGS_CLIENT_ID`, `WARCRAFT_LOGS_CLIENT_SECRET` | web | Warcraft Logs API (secret) |
| `RAIDER_IO_ACCESS_KEY` | web | Optional higher rate limits (secret) |
| `BOOSTINGHUB_BOT_API_TOKEN` | web, bot | Bot service credential (secret) |
| `BOOSTINGHUB_API_BASE_URL` | bot | Web app base URL reachable from the bot |
| `DISCORD_BOT_TOKEN` | bot, web | Bot credential (secret) |
| `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID` | bot, web | Application and server |
| `DISCORD_BOOSTER_ROLE_ID`, `DISCORD_LOOTBUDDY_ROLE_ID` | web | Login-time role sync; both are needed |
| `DISCORD_MANAGEMENT_SCHEDULE_ROLE_ID` | web | Optional role mention in Schedule share text (copy only) |
| `DISCORD_RUN_CATEGORY_ID` | bot | The one active Run category; preferred mode |
| `DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID`, `DISCORD_RUN_NEXT_MARKER_CHANNEL_ID` | bot | Section anchors and Schedule posts |
| `DISCORD_RUN_ARCHIVE_CATEGORY_ID` | bot | Holding category for PAST / FUTURE channels |
| `DISCORD_RUN_ARCHIVE_LOG_CHANNEL_ID` | bot | Transcript log channel |
| `DISCORD_RUN_VOICE_CHANNEL_IDS`, `DISCORD_RUN_VOICE_CATEGORY_ID` | bot | Fixed voice pool and temporary fallback |
| `DISCORD_PING_ROLE_TANK_ID`, `DISCORD_PING_ROLE_HEALER_ID`, `DISCORD_PING_ROLE_DPS_ID` | web, bot | Optional explicit ping roles |
| `DISCORD_ANNOUNCEMENT_CHANNEL_ID` | bot | Optional one-time product announcements |
| `DISCORD_SIGNUP_CHANNEL_ID`, `DISCORD_ROSTER_CHANNEL_ID` | bot | Legacy or test fallback when no Run category is set |
| `DISCORD_WCL_REPORT_AUTHOR_IDS`, `DISCORD_WCL_REPORT_CHANNEL_IDS` | web | Trusted log bots and log channels; empty means off |
| `DISCORD_SYNC_INTERVAL_MS` | bot | Optional poll interval, default 5000 (not in `.env.example`) |
| `ROSTER_BOSS_EXCEPTIONS_ENABLED` | web | Feature switch, unset means off |
| `NEXT_DEPLOYMENT_ID` | build | Optional override of the deployment id |

At startup the bot fails only if there is no channel destination at all (no Run category and no legacy signup channel). Missing markers or the archive category are per-poll warnings.

### Provider callbacks

- Discord OAuth: `<BETTER_AUTH_URL>/api/auth/callback/discord`
- Battle.net: `<BETTER_AUTH_URL>/api/integrations/battlenet/callback`, must match the Battle.net client and `BLIZZARD_REDIRECT_URI` exactly

### Discord bot permissions

**View Channels, Send Messages, Embed Links, Read Message History, Manage Channels** (the last only for per-Run channel creation, rename and reposition). The Run archive log channel additionally needs **Attach Files**; the voice category **Manage Channels**, **View Channel** and **Connect**. The current bot permissions are listed as a risk in [HANDOVER.md](HANDOVER.md#security-risks): do not solve a permission gap by granting Administrator.

## Feature switch: boss-specific roster exceptions

`ROSTER_BOSS_EXCEPTIONS_ENABLED` is **unset (off) in production** until it is
deliberately switched on. While off, the roster API refuses boss exception
input, so the additive table `run_roster_boss_exception` stays empty and every
Run behaves as before. Switching it off again later stops new or changed plans
only: plans already stored keep applying (Discord, DMs, Start checks, audit,
reservations) so nothing is judged against the wrong Character. See
[Boss-specific exceptions](DEVELOPER.md#boss-specific-exceptions).

## Optional: fixed Run voice channels (Raid #1 / Raid #2)

When a Run starts, the bot assigns it the first free fixed voice channel and
releases it when the Run ends. It never creates, renames or deletes these
channels. Set the ids in assignment order and restart the bot:

```bash
DISCORD_RUN_VOICE_CHANNEL_IDS="<Raid #1 id>,<Raid #2 id>"
```

When every fixed channel is taken (or the variable is unset) the temporary
channel below is used, if its category is configured.

## Optional: temporary Run voice channels

When a Run starts, the bot can create a voice channel `Raid with <Raid Lead>`
and link it in Raid Invite DMs. It is kept while the Run is `IN_PROGRESS`, then
deleted once the Run is `COMPLETED` / `CANCELLED` / app-archived **and** nobody
is connected (see [Run voice channels](DEVELOPER.md#run-voice-channels)).
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

## Monitoring and logging

There is no external monitoring and no health endpoint. What exists:

| Source | What it shows |
| --- | --- |
| `/manage/system` (ADMIN / OWNER) | Per-provider health from `IntegrationEvent`, recent events, last scheduled sync, backup status |
| `/manage/characters` (ADMIN / OWNER) | Sync health, errors and backoff per Character |
| `/manage/analytics` (ADMIN / OWNER) | Operational counts |
| `journalctl -u boostinghub-*` | Service and job logs |
| Bot startup line `Discord Message Content: AVAILABLE \| UNAVAILABLE \| UNKNOWN` | Privileged access of the bot's application |

Log lines worth knowing: `[discord-bot] warcraft-logs link`, `[wcl-discovery] recorded / evaluated / linked`, `[consumable-auto-audit] start|analyzed|failed|error`, and JSON lines with `character_sync_failed` / `character_sync_rate_limited`. By design they carry no tokens, message text or character identity.

## Diagnosis

### Operations cheatsheet

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
curl -sS -o /dev/null -w '%{http_code}\n' https://manawyrm-boosting.com/
```

| Symptom | Check first |
| --- | --- |
| Site down | `systemctl status boostinghub-web`, `curl` against `127.0.0.1:3000`, then the reverse proxy |
| Bot offline | `systemctl status boostinghub-discord-bot`, exactly one process tree (`systemd-cgls -u boostinghub-discord-bot.service --no-pager`), `BOOSTINGHUB_BOT_API_TOKEN` equal for web and bot |
| Discord posts do not update | Bot log for repeated errors, `/manage/system`, Discord permissions, marker channel configuration |
| Transcripts or log links incomplete | Message Content access (below) |
| Character data stale | `/manage/characters`, the timer, the job log, Blizzard credentials and rate limits |
| Deploy refused | Output of the helper; see [Failed deployments](DEPLOYMENT.md#failed-deployments) |
| `SqlQueryError: column … does not exist` | Pending migration: `npm run db:status` |

## Discord Message Content access (transcripts and log-bot links)

Run transcripts and the Warcraft Logs link scan read channel history over the
Discord **REST** API (`GET /channels/{id}/messages`). The gateway only requests
`Guilds` + `GuildVoiceStates`; no gateway message listener exists, so the code
does **not** request the `MessageContent` gateway intent (requesting it without
the portal toggle would make Discord reject the login).

REST responses still follow the application's privileged access: without it
Discord returns empty `content`, `embeds`, `attachments`, `components` and
`poll` for other authors' messages. Exceptions stay visible — the bot's own
messages, messages that mention it, DMs — which makes a transcript look
deceptively complete (Manawyrm Hub's own posts and embeds are there, members'
text is not).

Enable it on the application the **production** bot uses (check the bot's
application, never a remembered id):

Discord Developer Portal → *that application* → **Bot** → *Privileged Gateway
Intents* → **Message Content Intent** → save, then restart the bot.

*Discord policy (separate from what the bot checks):* whether an application may
use the toggle on its own or must go through Discord's privileged intent review
is Discord's decision and changes over time. As of 2026-09 Discord requires the
review — renewed yearly — once more than 10,000 unique users can see the app;
below that the toggle is self-service. See Discord's
[Getting Started with Privileged Intent Review](https://docs.discord.com/developers/gateway/getting-started-with-privileged-intent-review).
The bot never infers access from server or user counts — only from its
application flags (below).

Check it — the bot logs one line at startup:

- `Discord Message Content: AVAILABLE (runtime-confirmed via application flags)` — on.
- `Discord Message Content: UNAVAILABLE (runtime-confirmed …)` + warning — off: user-authored transcript text and automatic Warcraft Logs link detection are incomplete.
- `Discord Message Content: UNKNOWN (could not be determined)` — the application could not be read; check the portal by hand.

*Technical capability:* the bot reads this from its application flags
(`GET /applications/@me`). `GATEWAY_MESSAGE_CONTENT` (1 << 18, access granted
through Discord's review) or `GATEWAY_MESSAGE_CONTENT_LIMITED` (1 << 19, access
enabled with the Bot page toggle) — either one means Message Content is
available; neither means it is not.

While it is off:

- transcripts mark withheld messages as **(message content unavailable)**, show a
  notice, and record `Message Content: PARTIAL` / `UNAVAILABLE` in the file;
  archival and channel deletion proceed normally — they never wait for access;
- the Warcraft Logs scan sees no text or embeds from the log bot, so nothing is
  linked automatically; **manual** report linking on the Run page still works.

## Warcraft Logs log bot (optional)

Reports posted by a trusted log bot are linked to their Runs, and the
Consumables Audit runs ~15 min after the Run is completed (see
[Automatic linking and audit](DEVELOPER.md#automatic-linking-and-audit)). Two sources:

- a **dedicated log channel** the log bot posts every Run's report into (usually a
  webhook) — the server matches each report to Runs by its fights;
- a link the log bot posts in a **Run's own channel** — linked to that Run directly.

It is off until configured:

1. Find the log bot's Discord **author** id (Developer Mode → right-click the bot → Copy User ID;
   for a webhook it is the webhook id).
2. Find the dedicated log **channel** id (right-click the channel → Copy Channel ID).
   Author ids and channel ids are different things.
3. Add to `/var/www/boostinghub/.env` (read by the **web app**; `WARCRAFT_LOGS_CLIENT_ID` /
   `WARCRAFT_LOGS_CLIENT_SECRET` must be set too):

   ```
   DISCORD_WCL_REPORT_AUTHOR_IDS="<author id>"
   DISCORD_WCL_REPORT_CHANNEL_IDS="<channel id>"
   ```
4. Make sure **Message Content** access is on for the production bot's application
   (see [Discord Message Content access](#discord-message-content-access-transcripts-and-log-bot-links)):
   without it the log bot's links are invisible to the scan. Confirm with the
   bot's startup line `Discord Message Content: AVAILABLE`.
5. Restart the web app, then the bot (the normal `update-server.sh` restart does both). The bot needs
   **View Channel** and **Read Message History** in Run channels and in the log channel.

The log channel is read once a minute from a durable position (a restart never
re-reads its history; the very first read starts 3 days back). Found links are
matched on the bot's ~5-minute Warcraft Logs tick; the server logs
`[wcl-discovery] recorded / evaluated / linked` (report code, status, linked Run
ids — never message text).

**First start after adding a log channel.** There is no cursor yet, so the first
read (within ~1 min of the bot's first sync) starts 3 days back and records every
trusted report link from those 3 days (`[wcl-discovery] recorded`); older posts
are never read. Each is due immediately and evaluated on the next ~5-minute tick,
at most 5 per tick: a report whose Run is COMPLETED is linked at once
(`linked`); one already linked (e.g. pasted manually) becomes `MATCHED` without
a second link or an audit reset; one whose Run is still running stays `PENDING`.
The cursor row is written after the first read that saw messages. A Run's audit
still runs no earlier than 15 min after it was completed, and an already
analyzed Run is re-audited only if the link is new to it.

## Regular maintenance

| Task | When | How |
| --- | --- | --- |
| Check backups and timers | Weekly | `/manage/system`, `systemctl list-timers 'boostinghub-*'` |
| TLS certificate | Before expiry | In the hosting panel; date handed over privately |
| Slash commands | When the command list changes | `sudo -u boostinghub npm run bot:register-commands` |
| New raid season | Content patch | Raid Catalog imports, `src/lib/raid-seasons.ts`, Products |
| Item socket table | After a content patch | `node scripts/generate-wow-item-sockets.mjs` and commit the result |
| Consumable catalog | New season | `src/lib/consumable-catalog.ts` |
| Dependencies | Regularly | `npm audit`, review, deploy normally |
| Platform Owner | Once | `sudo -u boostinghub npm run owner:bootstrap -- --user-id <uuid>`; see [Platform Owner](DEVELOPER.md#platform-owner) |

### Publishing the Discord guides

The guides live in two normal Discord channels (ids in `src/discord-bot/guide-channels.ts`) and are edited in place. No threads, no forum posts. Canonical text: `src/guides/booster-guide.ts` and `src/guides/raidlead-guide.ts`. Screenshots: `docs/guides/screenshots/`, captured at 1440×900 in the dark theme with no browser chrome.

```bash
npm run guide:screenshots            # Booster screenshots (local DEV_AUTH + Playwright)
npm run guide:raidlead:screenshots   # Raid Lead screenshots
npm run guide:booster:preview        # list cards, no Discord I/O
npm run guide:booster:publish        # upsert the five Booster cards
npm run guide:raidlead:preview
npm run guide:raidlead:publish       # upsert the six Raid Lead cards
```

On the server, run the publish commands from the app directory as the app user: `sudo -u boostinghub npm run guide:booster:publish`.

Safety rules:

- Preview is the default of the script; only `--publish` mutates Discord.
- Canonical messages are identified by the footer `guide:<kind>:v2:<cardKey>` plus an optional `asset:<sha12>`, never by "the last messages". A changed screenshot changes the asset hash and forces an edit.
- Duplicate markers or foreign authors make the publisher refuse.
- Every publish writes a local rollback snapshot (`tmp-booster-guide-snapshots/`, `tmp-raidlead-guide-snapshots/`, gitignored). `--snapshot-dir=<path>` changes the location for the Booster guide.
- **The Discord guides use redacted live images** (`live-*.png`) and `rl-09-finish-run.png`, which comes from the local test system. New live images need every name, tag and personal note masked and cropped out, and only the final file may be committed. The capture scripts below do not produce them.
- **Capture scripts: only from a freshly seeded local database** (`npm run test:db:reset` on a dedicated database, then run the app against it), never from a database that has seen a real Discord login: a real name would end up in the repository and in Discord. Look at every image before committing or publishing. The seed's Run dates lie in the past, so views of `/runs` and `/my-runs` need `?id=all` to show Runs.
- Publishing changes Discord for everyone, so it is a deliberate step after a release, not part of a deploy.

#### Replacing a guide with new messages

Discord limits edits to messages older than one hour (seen as HTTP 429 "Maximum number of edits to messages older than 1 hour"). A full text refresh should therefore replace the messages instead of editing them. Replace runs in separate steps, one guide at a time:

```bash
npm run guide:booster:replace:plan      # read-only: shows what would happen
npm run guide:booster:replace:publish   # snapshot, create and verify new messages, delete nothing
# check the new messages in Discord
npm run guide:booster:replace:retire    # verify again, delete only the saved old ids, verify the end
```

The same three commands exist as `guide:raidlead:replace:*`. On the server, run them as the app user from the app directory.

- **Refuses to start** when the channel holds anything except this bot's guide messages with known markers: other authors, unmarked messages, unknown markers or duplicates.
- **Saves first:** all old messages, their image bytes and the old ids go to `replace-<channelId>/` in the snapshot directory before the first create.
- **New messages** are created one at a time with a pause, without pings or push notifications, and with a nonce, so a repeated create within a few minutes returns the first message.
- **Verification** compares text, footer, button, image bytes, mentions and order, and accepts only the saved old and new ids in the channel.
- **Deletes** only old ids saved in the state file, and only after a fresh verification. Other authors' messages are never deleted.
- **429:** waits once when Discord asks for 60 seconds or less. A second 429, a longer wait or a global limit stops the run and records the earliest next try. There are no retry loops.
- **After any stop**, read the output and `state.json`. Running the same command again continues from the saved ids and creates nothing twice. A publish failure keeps the old guide in place.
- **Changed text or screenshots** during a replacement make the run refuse. Remove the unfinished new messages deliberately, and move `state.json` away only after that.
- **Normal `--publish`** refuses while a replacement is unfinished. A leftover `lock` file means another run or a crash; remove it only when no such process is running.
- To start another replacement after a finished one, move the old `replace-<channelId>/` folder away.

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
2. Stop **all four timers**, so no background job or scheduled `pg_dump` can start
   mid-restore, then stop the writers. Check that no job is still in progress:

   ```bash
   systemctl stop boostinghub-character-sync.timer boostinghub-community-schedule.timer \
     boostinghub-battlenet-links.timer boostinghub-backup.timer
   systemctl stop boostinghub-discord-bot.service boostinghub-web.service
   systemctl is-active boostinghub-character-sync.service boostinghub-community-schedule.service \
     boostinghub-battlenet-links.service boostinghub-backup.service   # all inactive
   ```

3. Make sure the application code on disk matches the schema in the dump (see [Rollback](DEPLOYMENT.md#rollback)).
4. Restore as the PostgreSQL superuser via local peer authentication, so no password
   appears on a command line:

   ```bash
   sudo -u postgres pg_restore --clean --if-exists --dbname=<database> \
     /var/backups/boostinghub/<chosen>.dump
   ```

5. Restore the normal state: start the services, then all timers. Verify all six are
   `active`, then run the smoke checklist in [DEPLOYMENT.md](DEPLOYMENT.md#production-smoke-checklist).

   ```bash
   systemctl start boostinghub-web.service boostinghub-discord-bot.service
   systemctl start boostinghub-character-sync.timer boostinghub-community-schedule.timer \
     boostinghub-battlenet-links.timer boostinghub-backup.timer
   systemctl is-active boostinghub-web boostinghub-discord-bot boostinghub-character-sync.timer \
     boostinghub-community-schedule.timer boostinghub-battlenet-links.timer boostinghub-backup.timer
   ```

Never run `prisma migrate reset`, drop the schema or recreate the database as a
"fix". Migrations are never auto-reversed.

Backups are stored on the production host only. An off-site copy is not documented and is an open point in [HANDOVER.md](HANDOVER.md#security-risks).

## Operational dependencies

| Dependency | Needed for | If unavailable |
| --- | --- | --- |
| PostgreSQL (local host package) | Everything | App down |
| Reverse proxy and hosting panel | Public access, TLS | Site unreachable, services keep running |
| Discord API and gateway | Login, bot, DMs, role sync | Login fails; Run state stays safe, Discord work retries |
| Blizzard API | Add Character, sync, lockouts, Raid Catalog import | Add Character fails; existing data kept, jobs retry |
| Warcraft Logs API | Consumables Audit, rankings | Audit retries, then stops; manual linking remains |
| Raider.IO API | Optional item level raise | Soft failure, ignored |
| GitHub (HTTPS clone of a public repository) | Deploys | No deploy possible; the running system is unaffected |
| Hosting provider account | Server, DNS, firewall, recovery | Not available to the current maintainer; see [HANDOVER.md](HANDOVER.md#handover-to-the-new-maintainer) |

## Security checklist

- PostgreSQL listens on `127.0.0.1` / `::1` only; Next.js binds `127.0.0.1:3000`.
- Public inbound limited to what the host needs; review the actual exposure at handover (no public PostgreSQL, no public Next.js port).
- `.env` is mode `600`, owned by `boostinghub`. No secrets in Git, unit files, docs or logs.
- Root services execute only root-owned files (`/usr/local/libexec/boostinghub/`),
  never files inside the app checkout.
- Ops scripts never print secret values. Use `env-status.py` rather than `cat .env`.
- Development switches (`DEV_AUTH_ENABLED`, `DEV_ACCOUNT_BOOTSTRAP_ENABLED`) stay `false`.
- **`npm run db:seed` deletes existing data** and replaces it with test fixtures. Never run it on the server. It refuses `NODE_ENV=production`, the production database, non-local hosts, extra connection parameters and any database not named in `SEED_CONFIRM_DATABASE`. To recover data, use the restore procedure, never the seed.
- Next.js sends these headers on every path (`next.config.ts`): `Strict-Transport-Security` (15552000 s), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/microphone/geolocation disabled). `poweredByHeader` is false.
- Next.js suppresses `X-Powered-By: Next.js` (`poweredByHeader: false`). On 2026-11-02 production also stopped emitting Apache `X-Powered-By: PleskLin` for `manawyrm-boosting.com` by adding `Header unset X-Powered-By` to the persistent Plesk additional directives files `/var/www/vhosts/system/manawyrm-boosting.com/conf/vhost.conf` and `vhost_ssl.conf` (do **not** edit generated `plesk.conf.d/server.conf`). Other vhosts are unchanged. Backups of the pre-change files live beside those confs as `*.bak-pre-xpb-*`.
- Content-Security-Policy: production sends **Report-Only** only (`Content-Security-Policy-Report-Only` from `next.config.ts`). No enforcing `Content-Security-Policy` header. See [Content Security Policy](#content-security-policy). Do not enable an **enforcing** CSP from the hosting panel without matching the app inventory.
- After a Discord-bot deploy, confirm rate-limit waits with
  `journalctl -u boostinghub-discord-bot --since "1 hour ago" | grep 'rate limited'`.
  The bot logs each Discord REST rate-limit wait; absence of lines does not prove the sync is fast, only that no wait was observed in that window.

## Content Security Policy

Status in production (`5802735`): **Report-Only** via `next.config.ts` (not enforcing). Inventory and rollout notes: [docs/audit/CSP-PREPARATION.md](audit/CSP-PREPARATION.md). Public landing observation on 2026-11-02 loaded self-hosted scripts/styles/fonts/images under the Report-Only policy; authenticated Discord/Battle.net/character/run flows were not exercised in that pass. Owner decision required before flipping to enforce or changing production headers outside the app.

## Operational non-goals

- Docker/Compose replacement of this host stack, Kubernetes, a second reverse proxy
- Copying local or development databases into production
- Running Vitest or `test:db:reset` against production (tests use `TEST_DATABASE_URL` only)

