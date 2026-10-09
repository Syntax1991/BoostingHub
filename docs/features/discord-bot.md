# Discord bot

## Purpose

Discord is a second interaction surface for the exact same signup domain the Web app uses — never a parallel implementation. A User may sign up through the Web dialog or through a Discord Run embed; both manipulate the same `RunSignup` rows through `signupService.setCharacterOffers` / `setLootbuddies` / `cancelBoosterSignup`. There is no separate "Discord signup" record.

## Architecture

```text
Discord
  → Discord Bot process (src/discord-bot/*, discord.js)
  → Bot API (src/app/api/bot/*, Next.js Route Handlers)
  → Service (signupService, discordSyncService)
  → Repository → PostgreSQL
```

The bot never connects to PostgreSQL and never imports a Repository or Service directly. Everything it knows about BoostingHub comes from the Bot API, so Web and Discord can never drift into different eligibility rules.

Same repository, separate long-lived process: `src/discord-bot/` holds the bot's own entrypoint, run independently of the Next.js app (`npm run bot:start`). It may import shared pure types/enums for compile-time safety but must not import `@/services/*` or `@/repositories/*` for execution — only `@/discord-bot/bot-api-client.ts` talks to BoostingHub, over HTTP.

## Bot API

Route Handlers under `/api/bot/*` (see [run-signups.md](run-signups.md) for the domain they call):

| Route | Purpose |
| --- | --- |
| `GET /api/bot/discord/sync` | Independent channel-reconciliation work (`channels`) plus what needs a Discord post created or refreshed (`signups`/`roster`) |
| `GET /api/bot/runs/:runId/signup-options` | Eligible Booster Characters + `activeBoosterOffers` + `activeLootbuddies` for the acting Discord User |
| `PUT /api/bot/runs/:runId/signup` | `setCharacterOffers` (BOOSTER-only) over HTTP |
| `POST /api/bot/runs/:runId/signup/quick` | `quickSignupBoosters` (additive Booster Quick Signup) |
| `PUT /api/bot/runs/:runId/lootbuddies` | `setLootbuddies` over HTTP |
| `POST /api/bot/runs/:runId/signup/cancel` | `cancelBoosterSignup` / withdraw-from-run over HTTP |
| `GET /api/bot/my-signups` | Backs `/mysignups` |
| `GET /api/bot/runs/:runId/roster` | Discord-ready final roster DTO |
| `PUT /api/bot/runs/:runId/discord-state` | Records a created channel id, or a posted message's channel/message id |
| `POST /api/bot/runs/:runId/warcraft-logs` | System: a trusted log bot posted a Warcraft Logs report link in this Run's channel → link it (see below) |
| `POST /api/bot/warcraft-logs/auto-audit` | System: one bounded pass of the post-completion Consumables Audit |

Every handler: authenticate the bot service → resolve the acting Discord User (only for per-User routes) → validate with Zod → call the Service → map the domain result/error to JSON. No Repository use in a Route Handler.

## Security

- **Bot service identity**: `BOOSTINGHUB_BOT_API_TOKEN`, a high-entropy shared secret compared with `crypto.timingSafeEqual` (`src/auth/bot-auth.ts`). Grants access to the bot API surface only — never an ADMIN/RAID_LEAD bypass. Never an ADMIN session cookie, Discord OAuth login token, or Battle.net token.
- **Acting User identity**: `User.discordUserId` — the immutable Discord snowflake, never `discordUsername` or a display name. The bot forwards `interaction.user.id` (already authenticated by Discord's own interaction signature before the bot's code ever saw it) as the `x-discord-user-id` header; a request with no header or an unlinked id is rejected (`NOT_AUTHENTICATED` / `NOT_FOUND`). A client-supplied `userId` in a request body is never read — every Bot API schema omits that field entirely, so it is silently dropped even if a malicious caller includes one.
- Every mutation still runs full normal per-User authorization (`Character` ownership, the owner's Booster role `User.isBooster`, signup window) — bot service auth only gets a request past the door.

## Warcraft Logs report links (log bot)

A trusted log bot's Warcraft Logs report links are linked to Runs automatically (`src/discord-bot/warcraft-logs-links.ts`). Two sources:

- **Dedicated log channels** (`DISCORD_WCL_REPORT_CHANNEL_IDS`; production: the "Manawyrm Logging" webhook posts every Run's report into one channel). `scanReportChannels` reads each configured channel **once** per sync pass (not once per Run), at most once a minute, ≤ 10 pages, from the durable cursor the sync work hands it (`warcraftLogsReportChannels`; first read 3 days back). Trusted links go to `POST /api/bot/warcraft-logs/discoveries`; the cursor (`PUT /api/bot/warcraft-logs/channels/:channelId/cursor`, forward-only) only passes messages the server accepted or permanently refused. A message whose link fails transiently (transport, 401, 429, 5xx) is read again next pass while later messages are still delivered; after 3 days it is given up, so one bad message can never wedge the channel. The bot never matches Runs — the server does (see [run-consumables-audit.md](run-consumables-audit.md#automatic-linking-and-audit)). The log channel never holds back any Run channel's archival.
- **A Run's own channel** — the per-Run scan below.

- **Who is trusted**: only messages whose `author.id` is in `DISCORD_WCL_REPORT_AUTHOR_IDS` (web app env; empty = feature off). `author.id` is the narrowest id every message carries: a bot's user id, or — for a webhook post — the webhook id itself (Discord sets `author.id = webhook_id`). A look-alike webhook/bot with the same display name has a different id. The sync payload hands the list to the bot (`warcraftLogsReportAuthorIds`) and flags channels to read (`scanWarcraftLogs`: IN_PROGRESS or COMPLETED Runs). A booster posting a link attaches nothing.
- **How — lossless cursor scan, no new gateway intent**: every message after a durable per-channel cursor (`RunDiscordPost.warcraftLogsScanCursor`) is read over REST with `after=<cursor>`, 100 per page, oldest → newest (≤ 10 pages per routine pass, at most once a minute per channel, `WCL_CHANNEL_SCAN_INTERVAL_MS`). Before the first scan the cursor is a snowflake at Run start − 10 min, so nothing posted during the Run is skipped however busy the channel is. The cursor is saved via `discord-state` `wcl-scan-cursor` (server: forward-only, current Run channel only) and never advances past a trusted link whose attach must be retried (WCL unavailable / not configured, Bot API unreachable, 401, 429, 5xx); a missing/private report and a permanent Bot API rejection (400/403/404/409/422 — e.g. the channel is no longer the Run's channel) are final and skipped. Content, embed title/description/url and fields are searched for retail report links.
- **Before deletion**: a retiring (COMPLETED) channel gets an unthrottled final scan to its end (≤ 50 pages). If that cannot finish, the channel's transcript/delete is held back and retried next pass — at most 30 min (`WCL_FINAL_SCAN_MAX_DEFER_MS`), then retirement proceeds with a warning.
- **Discord requirement**: the app's **Message Content Intent** must be enabled in the Developer Portal (see [deployment](../deployment-production.md#discord-message-content-access-transcripts-and-log-bot-links)). Without it Discord returns empty `content`/`embeds`/`attachments`/`components`/`poll` over REST for other authors' messages — the scan then finds no link, attaches nothing and simply moves its cursor on (no retry, archival is never held back; manual linking still works). No gateway intent change is needed: the scan is REST-only. The bot logs its access once at startup (`Discord Message Content: AVAILABLE|UNAVAILABLE|UNKNOWN`, from the application flags — `src/discord-bot/message-content.ts`).
- **Server checks** (`runWarcraftLogsService.attachFromDiscord`): bot token, author in the allowlist, the message's channel is this Run's stored `runChannelId`, Run IN_PROGRESS or COMPLETED. Stored as `source = DISCORD_BOT` with the Discord message id and author id and no acting User. Idempotent: an already linked report causes no WCL request. A failed attach tells the bot whether to retry (`retryable`). Fights are not assigned while the Run runs (its window is still open). A **different** report never replaces an existing one (manual or earlier log-bot link): it is linked alongside, and the time-window fight assignment keeps any fights outside this Run out of its audit.
- **Logs**: one structured line per trusted link — `[discord-bot] warcraft-logs link { runId, channelId, messageId, authorId, reportCode, result }` with `result` = `attached` / `already-attached` / `retry` / `failed` / `rejected`. Untrusted authors' messages are skipped without logging. No tokens, secrets or headers are logged.
- **Auto audit**: every 5 min (`WCL_AUTO_AUDIT_INTERVAL_MS`) the bot calls `/api/bot/warcraft-logs/auto-audit`; the API decides what is due. See [run-consumables-audit.md](run-consumables-audit.md#automatic-linking-and-audit).

## Sync architecture

Run/Signup/Roster state never depends synchronously on Discord. `discordSyncService.listSyncWork(now?)` (`src/services/discord-sync.service.ts`) is the single place that decides "something changed", and returns independent lanes including:

- **`channels`** — channel reconciliation (name, parent category, and CURRENT/NEXT section ordering) for every Run that already has a persisted `RunDiscordPost.runChannelId`. Completely unconditional: it does not depend on the signup/roster message being dirty, on `Run.status` (DRAFT included), or on anything else — a Run that already owns a dedicated channel always gets a `channels` item, every poll. See "Channel reconciliation" and "Weekly raid-ID sections" below.
- **`signups`** — a signature (`uniqueSignupCount:signupWindowOpen:runStatus:desiredChannelName:targetBucket`) is compared against `RunDiscordPost.lastSignupSignature`. DRAFT runs are never candidates. The *first* post additionally requires signup to be genuinely available right now (`isSignupWindowOpen` — OPEN / ROSTERING / PUBLISHED with `signupsOpen` true) **and** the Run's raid-ID week to currently classify CURRENT or NEXT (see "Weekly raid-ID sections") — a Run the bot first sees only after it already reached COMPLETED/CANCELLED (or PUBLISHED with signups already closed) never gets a brand-new post for a signup phase that's already over, and a Run scheduled further out than NEXT never gets Discord infrastructure before its week is actually current or upcoming. Once a post exists, later updates are unconditional (any non-DRAFT status, any week bucket), so the same message keeps reflecting the Run's real state — including signups closing, or the Run's own channel rolling from NEXT into CURRENT — all the way through completion. `desiredChannelName`/`targetBucket` are folded into the signature as legacy wake-up signals (historical: before `channels` existed, they were the only way a rename/section move ever got picked up) — kept for now as lower-risk, though `channels` is the actual authoritative fix; a rename, Archive/Restore, or weekly rollover no longer *depends* on them to reach the channel.
- **`roster`** — `RunRoster.version` is compared against `RunDiscordPost.lastRosterVersion`, and the bot's Guild emoji fingerprint against `lastRosterEmojiFingerprint`; only runs with a published roster are candidates.
- **`schedules`** — exactly two global Schedule work items (`CURRENT` + `NEXT`). Server-owned filter/sort/signature; bot creates/edits the persistent marker-channel messages. Independent of Run-channel archival — see "Persistent Schedule posts" under Weekly raid-ID sections.

`RunDiscordPost` (additive migrations `20260910T2332_discord_integration_state`, `20260911T0136_discord_run_channel`, `20260918T1525_add_run_discord_archive_artifacts`, and `20260918T1628_add_run_archive_transcript_html`) is small, presentation-only integration state — the channel/message ids the bot already created/posted (including one-time app-archive close/transcript message ids) plus the HTML transcript body for website download, so a restart reuses/edits them instead of duplicating. It is never a second source of truth for Run/Signup/Roster data.

**Which Runs are polled.** Each pass fully loads only Runs that can still produce Discord lifecycle work: OPEN/ROSTERING/PUBLISHED Runs (possible first signup provisioning — the week gate is applied per pass, so a FUTURE Run becomes eligible without any database write), unarchived IN_PROGRESS Runs (temporary Voice provisioning even before any Discord post exists), and every Run that still holds live Discord identity — a Run channel, a Voice channel, or a signup post identity (including a retired channel's leftover signup identity until the bot confirms the channel gone). Fully retired historical Runs, whose `RunDiscordPost` holds only history (Final Setup markers, archive transcript, Raid Invite history), are skipped entirely. Their Discord state is read for all polled Runs at once. Pending lifecycle announcements stay an independent lane: they are listed on their own and resolve the Run's current channel from that same read, even for a Run that is not otherwise polled.

The bot's `sync-loop.ts` polls `GET /api/bot/discord/sync` on an interval (`DISCORD_SYNC_INTERVAL_MS`, default 5s) and processes `channels` **before** `signups`/`roster`, so a Run's channel is already in its correct name/category/section before any new message work is applied. After Discord signup/lootbuddy/cancel mutations the bot also calls `requestImmediateSync()` so public embeds refresh without waiting for the next poll tick (concurrent kicks coalesce to one follow-up pass). The resolved channel ids from that pass are reused for the message paths (no duplicate rename/move for a Run that appears in more than one lane the same poll). A failed pass is logged and retried on the next tick — it never throws the process down or blocks a BoostingHub Run transition.

## Per-Run Discord channel

Preferred mode: each Run that becomes signup-available gets its own dedicated Discord text channel, created under the ONE configured Run category (`DISCORD_RUN_CATEGORY_ID`) — CURRENT- and NEXT-week Runs share this same category (Discord channels cannot contain child channels, so there is no separate "NEXT category" — see "Weekly raid-ID sections" below) — so a community sees one channel per raid rather than one shared signup channel.

**Trigger**: the same gate as the first signup post (`isSignupWindowOpen`) **and** the Run's raid-ID week currently classifying CURRENT or NEXT — a Run is never given Discord infrastructure while still `DRAFT`, never retroactively for a Run that reached COMPLETED/CANCELLED (or PUBLISHED with signups already closed) without ever having been signup-available, and never while scheduled too far out to be CURRENT or NEXT yet.

**Naming**: `buildDiscordRunChannelName` (`src/lib/discord-channel-name.ts`, pure and unit-tested) computes `{weekday}-{HHMM}-{difficulty}-{lootType}-{coverage}-{raidLead}` in the community timezone (e.g. `sat-2200-hc-vip-7of9-titan`) from authoritative Run data. The Raid Lead segment uses `User.discordRunChannelNickname` when set (RAID_LEAD/ADMIN Settings → Run Channels), otherwise `User.name`. Nickname never changes `Run.title` or web Raid Lead display. Nickname is projected via `Run.raidLead` include (`raidLeadDiscordRunChannelNickname` on `RunListRecord`) — no per-Run Settings lookup. Closed presentation (`buildClosedDiscordRunChannelName`, `closed-` prefix) applies when the Run is app-archived **or** status is COMPLETED/CANCELLED — naming is independent of destructive channel deletion. Grouping CURRENT/NEXT is expressed by section position, not the name.

**Identity**: `RunDiscordPost.runChannelId` is the only authoritative identity, recorded the instant the channel is created — before any message is posted into it, so a crash between creation and posting can never cause a retry to create a second channel. The channel is **never located by name** afterward, since a rename changes the name but not the id.

**Rename, not replace**: when the desired name changes (schedule / difficulty / loot / raid-lead edit — allowed until Start, `PUBLISHED` included), the sync pass calls `channel.setName(...)` on the *same* channel id, and the signup embed is edited in place (no re-announcement). A started / completed Run's fields are no longer editable, so historical channels are never renamed after the fact.

**Channel retirement (not clone)**: destructive TEXT-channel deletion is authorized **only** by explicit app archive (`Run.archivedAt != null`). COMPLETED / CANCELLED without archive keep the Discord text channel (closed naming only) so Cancel→Reactivate can continue in-place and late WCL/log-bot messages can still land. Terminal status alone, schedule PAST/FUTURE placement, Discord ARCHIVE-category holding, or pre-existing archive artifacts never authorize delete. When `archivedAt` is set (and no PENDING lifecycle announcements remain), the next sync pass posts Ticket-Tool archive artifacts to `DISCORD_RUN_ARCHIVE_LOG_CHANNEL_ID`, then **deletes** the dedicated Run TEXT channel and records `channel-gone` for it (see *Retired channel identity* below). The Manawyrm Hub Run row itself remains stored as an archived Run. Weekly rollover for non-archived Runs still moves (never deletes) PAST/FUTURE channels into archive-category holding. A stored `runChannelId` is replaced with a newly created channel **only** when Discord confirms Unknown Channel (10003); Missing Access / rate limits / transient fetch failures keep the stored id and never recreate (avoids duplicate channels on bot restart). Channel reconciliation (name + category) records a confirmed Unknown Channel for a stored Run channel once as `channel-gone`, so a deleted channel stops coming back every poll; a channel that merely does not resolve (wrong type) keeps its stored id.

**Self-healing**: if the stored channel id no longer resolves in Discord (deleted out-of-band), the next sync pass creates a replacement rather than leaving the Run without a home — this is recovery, never the bot deleting anything itself. This self-healing is exclusive to the signup path (gated by `isSignupWindowOpen` + week bucket, same as first-channel provisioning); `channels` reconciliation and the roster path only reuse a channel that already exists — if a Run's channel is missing when only `channels`/roster work would have reached it, that item is skipped with a warning rather than provisioning anything.

**Raidboost Announce**: when the signup path creates a Run channel for the first time, the bot posts one Carl-bot-style announce **before** the signup embed: embed title `<:PhoenixStarDiscord:…> Raidboost Announce <:PhoenixStarDiscord:…>` (Guild emoji name `PhoenixStarDiscord`), description `{NM|HC|MY} {loot emoji} {Difficulty} {Loot} - *Please refer to the channel name for the time* 🕒`. When the Run's `discordRolePing` flag is on (default; set at create/edit), message content also pings Guild roles named `tank`, `healer`, and `dps`. When the flag is off, the announce embed still posts without role mentions. Existing channels are never re-announced (no backfill / no re-ping on later polls). A channel recreated for a Run whose signup post already went out once (`signupPostedAt` set, e.g. after the channel was deleted in Discord) gets its signup embed again but **no** second announce or role ping (`announceOnCreate: false` on the signup work item). Continuity edits for CANCELLED/COMPLETED Runs (after `runChannelId` was cleared on archive delete) never provision a replacement channel — that path previously re-fired role pings. Missing emoji or roles are skipped with a warning; the announce still posts.

**Legacy/test fallback**: when `DISCORD_RUN_CATEGORY_ID` is unset, the bot posts into the single global `DISCORD_SIGNUP_CHANNEL_ID` / `DISCORD_ROSTER_CHANNEL_ID` exactly as before per-Run provisioning existed — useful for a minimal test setup that hasn't created a category yet. At least one of the two configurations is required at startup (`loadBotEnv` fails fast otherwise). `channels` reconciliation only ever concerns `RunDiscordPost.runChannelId` — the legacy global channel ids are never treated as a dedicated Run channel and never appear in `channels`.

**Permissions**: creating, renaming, moving, and repositioning channels requires the bot's role to have **Manage Channels**, in addition to View Channels / Send Messages / Embed Links / Read Message History. The created channel inherits permissions from its parent category by default — no per-channel permission overwrites are created, and a category move never resyncs permissions (`lockPermissions: false` — see "Channel reconciliation").

## Channel reconciliation

**Channel state is reconciled independently from message state.** Before this existed, a Run's channel name and category were only ever corrected as a *side effect* of the bot processing a signup or roster message update — so a Run that already had a settled signup/roster message (the common steady state) got no work item at all, and its channel could sit in the wrong category, wrong week section, or under the wrong name indefinitely.

`discordSyncService.listSyncWork()`'s `channels` lane fixes this: it returns one `ChannelSyncWorkItem` — `{ runId, existingRunChannelId, desiredChannelName, targetBucket, scheduledStartAt }`, with `existingRunChannelId` always non-null — for **every** Run that already has a persisted `RunDiscordPost.runChannelId`, regardless of `Run.status` (DRAFT included, for an abnormal legacy row), archive state, raid-ID week, or whether any signup/roster message currently needs updating. It is expected and correct for this lane to return the same Run on every poll — BoostingHub's database knows the *desired* name/category/ordering but not Discord's *live* `parentId`, position, or actual channel name (including any out-of-band manual change), so the bot must keep re-checking. This is also what makes automatic weekly rollover (NEXT → CURRENT) work with zero database writes — see "Weekly raid-ID sections" below.

Two independent mechanisms act on `channels`, both in `src/discord-bot/channel-reconciliation.ts`, deliberately decoupled from discord.js's concrete channel types so they're unit-testable without a live bot token (`channel-reconciliation.test.ts`):

**1. `reconcileExistingRunChannel`/`reconcileChannels`** — name and parent category, one channel at a time:

1. Fetch the channel by its persisted id (`sync-loop.ts`'s adapter prefers `client.channels.cache` over a `fetch` REST call).
2. If it can't be resolved (deleted or inaccessible): log a warning and skip — never crash, never provision a replacement (that stays exclusive to the signup path above), and never let one bad channel stop the rest of the batch from reconciling.
3. If its name doesn't match `desiredChannelName`: `setName(...)` in place.
4. Independently, resolve the desired parent from `item.targetBucket` — `"CURRENT"` and `"NEXT"` both → the ONE `DISCORD_RUN_CATEGORY_ID`; `"ARCHIVE"` → `DISCORD_RUN_ARCHIVE_CATEGORY_ID`. The bot never computes `targetBucket` itself — it always arrives already decided by `discordSyncService` (see "Weekly raid-ID sections"). If the resolved category env var is unset: log a warning and leave the channel where it is. If its current `parentId` already matches: no-op. Otherwise `setParent(desiredParentId, { lockPermissions: false })` — a plain move, never a permission resync, never a delete/recreate/clone.

**2. `reconcileWeekSectionPositions`** — CURRENT/NEXT ordering *within* the one active category, computed once per poll across every CURRENT/NEXT `channels` item together (position is inherently a multi-channel concern, unlike name/parent):

1. List the active category's current children (id + live `position`) and locate the two marker channels (`DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID`/`DISCORD_RUN_NEXT_MARKER_CHANNEL_ID`) among them. Missing either marker, the category itself not resolving, or the markers being out of order (`#next-id` above `#current-id`) all warn and skip this poll's position reconciliation entirely — never inventing a replacement anchor, never silently swapping the markers.
2. Sort each section by time: CURRENT (between the markers) and NEXT (after `#next-id`) each contain BoostingHub's Run channels (time from `scheduledStartAt`) **and** any manually created Run channels already in that section whose name starts with `{weekday}-{HHMM}` (e.g. `fri-1300-…`), interleaved by minute of the raid week (Wednesday 06:00 Europe/Berlin first; ties: BoostingHub first). Unmanaged channels without a recognisable time keep their relative order at the end of their section; channels above `#current-id` are untouched, and nothing is moved between sections.
3. Build the full desired top-to-bottom order — `[unmanaged before] #current-id [CURRENT section by time] [CURRENT untimed] #next-id [NEXT section by time] [NEXT untimed]` — and compare it against the category's actual current order. Already matching: zero API calls.
4. Otherwise, submit the ENTIRE category's channels as one dense `setPositions([...])` call (discord.js's `guild.channels.setPositions`), including the two markers. This is a confirmed requirement of Discord's real API — a sparse payload naming only the channels that need to move, leaving the rest (including the markers) unspecified, is silently ignored rather than applied; see the code comment on `reconcileWeekSectionPositions` for how this was discovered against a live server.

Steps 3–4 of the first mechanism, and the whole of the second, are each independently idempotent. `sync-loop.ts` runs channel reconciliation (name + parent) first, then any signup/roster message work (which may provision a first channel), then **one** CURRENT/NEXT position reconciliation that includes both pre-existing `channels` items and any channels created in this same pass — so a brand-new CURRENT/NEXT Run channel finishes its first successful sync already in the correct marker section. Position reconciliation runs in a `finally` after provisioning is known, so a later signup/roster embed send/edit failure cannot leave a newly created channel below `#next-id` until the next poll. After each `setPositions` write the bot **fresh-fetches** the category from Discord (REST `guild.channels.fetch()`, not cache alone) and verifies relative order; if Discord's create→position consistency briefly leaves the new channel below `#next-id` despite a successful write, the same sync pass retries reconcile+verify up to two more times with a short bounded delay (not the 60s poll). Later polls still self-heal manual drift and weekly NEXT → CURRENT rollover via the same reconciler. A `runId -> channelId` map from the name/parent pass lets the message paths reuse the same resolved channel instead of re-resolving (and potentially re-renaming/re-moving) it a second time in the same poll.

**Archive / completion / cancel**:
- **Terminal status** (COMPLETED / CANCELLED): closes the Run operationally; Discord channel gets closed naming but stays until app archive.
- **Explicit app archive** (`Run.archivedAt`): sole destructive TEXT-channel retirement authority (`retireChannel: true` only when archived, and no PENDING lifecycle announcements).
- **Schedule ARCHIVE category** (PAST/FUTURE): non-destructive holding — move only, `retireChannel: false`.
- **Voice channels**: independent temporary lifecycle (RETIRE_IF_EMPTY on COMPLETED/CANCELLED/archived) — not gated by app archive.

`retireChannel` is true only when `Run.archivedAt` is set **and** there are no `PENDING` `RunDiscordAnnouncement` rows for that Run. Lifecycle channel announcements (reschedule / cancel / reactivate) still post on the existing channel; Cancel→Reactivate normally keeps the same channel without replacement. While a cancel (or earlier reschedule) announcement is still `PENDING`, retirement is blocked (`retireChannel: false`, `pendingLifecycleAnnouncements: true`). Immediately before Discord send, the bot re-checks deliverability (`GET .../delivery-authority`) so stale in-memory CANCELLED work cannot post after Reactivate; recording `SENT` is compare-and-set on `PENDING` only. Transient Discord send failures leave the announcement `PENDING` and keep the channel. Missing channel / Missing Access → terminal `FAILED_PERMANENT` or `SKIPPED` for cancel/reschedule; `RUN_REACTIVATED` with no channel yet stays `PENDING` for continuity recovery (legacy channel-loss cases). Immediately before every irreversible channel.delete(), the bot re-checks current retirement authority via `GET /api/bot/runs/:runId/discord-retirement` — only the live row's `archivedAt != null` may return `{ retire: true }`. Restore Archive clears `archivedAt` and immediately revokes delete authority. The next sync pass after announcements are terminal and the Run is app-archived:
1. Renames the dedicated channel to `closed-{weekday}-{HHMM}-{difficulty}-{lootType}-{coverage}-{raidLead}` via `buildClosedDiscordRunChannelName` (in place — **never** moved into `DISCORD_RUN_ARCHIVE_CATEGORY_ID` for retirement; schedule holding may already have moved PAST/FUTURE channels into that category without deleting them).
2. Posts Ticket-Tool-style archive artifacts **once** into `DISCORD_RUN_ARCHIVE_LOG_CHANNEL_ID` (e.g. `#raid-open-channel-logs`):
   - Message 1: `<Server-Info>` xml code block + `transcript-{channelName}.html` attachment. Every message keeps author, time, id (and edit time); its text slot is the escaped text, or honestly `(message content unavailable)` when Discord withheld it (no Message Content access — the bot's own posts and messages mentioning it are still delivered), `(system message)` / `(no text)` only when the message really had none. Attachments (name + size, never downloaded) and stickers are listed. A notice at the top and `Message Content: AVAILABLE|PARTIAL|UNAVAILABLE|UNKNOWN` (header line + `<meta name="manawyrm-message-content">`) state how complete the text is. All interpolated values are HTML-escaped. Missing access never blocks archival.
   - Message 2: green details embed (Ticket Owner / Ticket Name / Panel Name / Users in transcript) + **Direct Link** button to the attachment
   - Persists the same HTML on `RunDiscordPost` for manager download at `/runs/[runId]/archive-transcript`
   Idempotency: `archiveArtifactsNeeded` until Discord message ids **and** `archiveTranscriptHtml` are recorded. When ids already exist but HTML is missing (legacy rows), the bot rebuilds HTML from the Run channel and records it without re-posting to Discord. When the log channel env is unset, Discord posts are skipped with a warning and the Run channel is left alone until artifacts can be written. If the details embed fails after the transcript attachment was posted, transcript message id + HTML are still recorded (durable archive authority) and deletion may proceed once `archivedAt` remains set.
3. **Deletes** the Run's Discord TEXT channel (only after successful archive preservation + fresh `archivedAt` check) and records `channel-gone` for that exact channel id — the Manawyrm Hub Run remains as an archived Run; only the Discord channel is removed. Leftover channels from older deploys are deleted on a later poll once artifacts are already complete and the Run is still archived.

**Retired channel identity.** Once a retiring Run channel is confirmed gone, the bot reports `channel-gone {channelId}` — never `clear-channel`:

| Outcome while retiring | State update |
| --- | --- |
| Channel deleted by the bot | `channel-gone` (exact id) |
| Discord says Unknown Channel (delete, or transcript fetch) | `channel-gone` (exact id) |
| Missing Access / Missing Permissions | none — identity kept, retried next pass (the channel may still exist) |
| Channel exists but is not a usable/deletable text channel | none — identity kept, logged |
| Other Discord/API error | none — identity kept, retried next pass |

`channel-gone` runs `clearDeletedChannelIdentity(runId, channelId)`: one compare-and-set UPDATE per group, each requiring the stored id to still equal `channelId` — Run channel; signup channel + message + signature; roster channel + message + version. So it clears everything the deleted channel held (otherwise the Run's signup identity would keep it a zero-work sync candidate forever), never a replacement channel recorded meanwhile, and never a signup post living in a different (shared/legacy) channel. Final Setup markers, Voice identity, archive transcript and Raid Invite history are kept. `clear-channel` (drops only `runChannelId`, unguarded) is no longer used for retirement.

### Run channel lifecycle announcements

Durable `RunDiscordAnnouncement` rows (`RUN_RESCHEDULED` / `RUN_CANCELLED`) are created by `runService` on successful schedule change / cancel — never by calling Discord from the web process. The bot's existing sync poll includes a bounded `runAnnouncements` lane (createdAt ASC). Posts use embeds with Discord native timestamps (`<t:…:F>`); no `@everyone` / role / member pings. No channel is provisioned solely for a lifecycle message. User DM preferences never gate these channel posts.

PAST/FUTURE schedule holding still uses the ARCHIVE category as a **silent move only** — live schedule-based name, no `closed-` rename, no log posts, no delete (`retireChannel: false`).

**Restore**: `runService.restoreRun` clears `archivedAt` and clears archive-artifact message ids so a later re-archive can post again. Restore immediately revokes TEXT-channel delete authority (fresh `discord-retirement` check returns false). If the channel was already deleted under a prior archive, restore does not resurrect it — a later CURRENT/NEXT signup window may provision a fresh channel via the normal signup path / continuity recovery. Restore never invents Discord infrastructure on its own.

Neither Archive nor Restore creates signup/roster message work by itself — retirement with no other Run change produces the one-time transcript post + channel delete only when `archivedAt` is set.

## Weekly raid-ID sections

Phoenix Discord keeps ONE active Run category (e.g. "Weekly Raid Schedule") with two manually-managed marker text channels inside it — `#current-id` and `#next-id` — that visually divide it into a **CURRENT** raid-ID week section and a **NEXT** one. Discord channels cannot contain child channels, so CURRENT and NEXT are not, and cannot be, separate categories; they are ordered blocks of Run channels sitting above/below the two markers within the one category:

```text
Weekly Raid Schedule              <- the ONE active category (DISCORD_RUN_CATEGORY_ID)
  #current-id                     <- marker channel (DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID)
  sun-1800-hc-vip-8of8-...        <- CURRENT Run channels, chronological
  mon-1800-hc-vip-8of8-...
  #next-id                        <- marker channel (DISCORD_RUN_NEXT_MARKER_CHANNEL_ID)
  sun-1900-hc-vip-5of8-...        <- NEXT Run channels, chronological
  mon-1900-hc-unsaved-8of8-...
```

BoostingHub places each Run's dedicated channel according to its `scheduledStartAt`, re-evaluated on every sync pass — there is no persisted week bucket or channel position anywhere in the schema, and no cron mutates a Run row for weekly rollover.

**Marker channels are manual Discord infrastructure, not BoostingHub-owned channels.** They are ordinary text channels a human creates and places inside the active category; BoostingHub never creates, renames, deletes, archives, or reparents them. Their ids are pure environment configuration (`DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID`/`DISCORD_RUN_NEXT_MARKER_CHANNEL_ID`), exactly like a configured category id. Their live `position` **may** shift as a side effect of the section-ordering payload described below (e.g. `#next-id` moves down whenever the CURRENT section gains a channel) — this is a mechanical consequence of how Discord's position API works, not BoostingHub taking editorial control of the markers: their id, name, and parent are never touched, and their relative order to each other (`#current-id` above `#next-id`) is asserted up front and never itself changed.

**Persistent Schedule posts.** Each marker channel is also the home for exactly one canonical Schedule message:

- `#current-id` → **📅 Current Raid ID — Schedule** — active CURRENT-week Runs only
- `#next-id` → **📅 Next Raid ID — Schedule** — active NEXT-week Runs only

The Schedule is an operational read model, not history. Included statuses: `OPEN`, `ROSTERING`, `PUBLISHED`, `IN_PROGRESS` with `archivedAt` null. Excluded immediately: `DRAFT`, `COMPLETED`, `CANCELLED`, application-archived Runs (`archivedAt != null`), plus week buckets `PAST` and `FUTURE` beyond NEXT. Completed, Cancelled, and app-archived Runs disappear from the Schedule on the next sync even while their Run channel still exists for final WCL scan / transcript / archive — archival and transcript history remain the history authority. Rows sort by `scheduledStartAt` ASC with stable `runId` tie-break. A Run without a dedicated channel yet still appears (no `<#channel>` mention). Reschedules reorder within a bucket or move CURRENT ↔ NEXT; leaving both buckets removes the Run from both messages.

Identity lives in `DiscordSchedulePost` (one row per bucket: `channelId`, `messageId`, `lastSignature`) — never in `RunDiscordPost`. The server builds the desired embed + deterministic signature (`SCHEDULE_MESSAGE_FORMAT_VERSION` + bucket + per-Run fields); the bot creates or edits the same Discord message in place. Even when the signature is unchanged, the bot still verifies the stored message id still exists (direct fetch, no channel scan). Confirmed Discord Unknown Message (`10008`) creates exactly one replacement; Missing Access / Missing Permissions / network / timeouts keep the stored identity and retry next poll — they never spawn a duplicate. If the configured marker channel id changes, the bot posts the canonical Schedule into the new marker immediately and best-effort deletes the exact previous stored message afterward. Empty weeks edit the same message to `No active Runs scheduled.` — the message is never deleted. Schedule sync is an independent lane: its failures never block signup, roster, voice, WCL, or archive work, and it never waits on archival. Realistic weekly volume fits one embed description (Discord 4096-char limit); there is no multi-message paginator.

**Boundary**: Wednesday 06:00 **Europe/Berlin** — a local wall-clock instant, not a fixed UTC offset. Europe/Berlin alternates between CET (UTC+1) and CEST (UTC+2); the reset stays 06:00 local across that transition, which is why `classifyRunWeek()` (`src/lib/wow-run-week.ts`) recomputes the boundary from real calendar dates via timezone-aware arithmetic on every call rather than adding `7 * 24h` in milliseconds to the previous boundary — the latter would silently drift the local reset time by an hour across a DST transition. This is a **product-specific** boundary, unrelated to `wow-weekly-reset.ts`'s fixed-UTC Blizzard regional reset (used only for lockout/encounter classification) — the two are never derived from each other.

**Half-open windows**, given `currentStart` = the most recent Wednesday 06:00 Europe/Berlin at or before `now`, `nextStart` = 7 local calendar days later, `followingStart` = 7 more:

| Bucket | Range |
| --- | --- |
| PAST | `scheduledStartAt < currentStart` |
| CURRENT | `currentStart <= scheduledStartAt < nextStart` |
| NEXT | `nextStart <= scheduledStartAt < followingStart` |
| FUTURE | `scheduledStartAt >= followingStart` |

**App archival always wins.** `resolveDiscordTarget` (`discord-sync.service.ts`) checks `Run.archivedAt` first — an archived Run always targets ARCHIVE (a real, separate category) regardless of what its schedule would otherwise classify. Only when a Run is *not* app-archived does its raid-ID week decide the target: CURRENT/NEXT map to the CURRENT/NEXT sections of the one active category; **PAST and FUTURE both map to ARCHIVE** as a holding placement — this keeps the strict invariant that the CURRENT section contains only CURRENT-week Runs and the NEXT section contains only NEXT-week Runs, without ever deleting/recreating an already-provisioned channel that has simply aged out of the active rotation (PAST) or hasn't reached it yet (FUTURE, legacy data only — see below). This never touches `Run.archivedAt`; a PAST/FUTURE Run sitting in ARCHIVE holding is not "app-archived" and stays fully editable/manageable exactly as any other non-archived Run of its status.

**Far-future first-channel suppression**: a Run classified FUTURE with no existing `runChannelId` never gets one — not a channel, not a `RunDiscordPost` row, not a signup message — even while `OPEN` with `signupsOpen: true`. First-channel provisioning requires **both** `isSignupWindowOpen` **and** a CURRENT/NEXT classification (see "Per-Run Discord channel" above); FUTURE and PAST both fail that second condition. A Run scheduled two raid-ID weeks out today produces zero Discord side effects until the calendar catches up.

**Automatic rollover, no database write**: because `channels` reconciliation re-derives `targetBucket` from `scheduledStartAt` + real time on *every* poll, a Run that was NEXT yesterday and becomes CURRENT after this week's Wednesday 06:00 rollover is picked up by the very next sync pass. Unlike Archive/Restore, this specific transition is **not** a parent-category move — CURRENT and NEXT already share the same parent — it is a *position* change, computed by `reconcileWeekSectionPositions`: the channel moves from below `#next-id` to between `#current-id` and `#next-id`, same channel id, same category. No cron, no scheduled job, no Run row update. The same mechanism handles a Run that was legacy-provisioned while FUTURE (pre-dating this feature, or created before its week became eligible) sitting in ARCHIVE holding: once real time advances it into NEXT and then CURRENT, the same channel id moves ARCHIVE → (active category, NEXT section) → (active category, CURRENT section) across successive weekly rollovers, never deleted or recreated.

**Environment variables**:

- `DISCORD_RUN_CATEGORY_ID` — the ONE active Run category, unchanged in meaning from before this feature. CURRENT and NEXT both resolve to it.
- `DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID` / `DISCORD_RUN_NEXT_MARKER_CHANNEL_ID` — the two marker channels. Required for CURRENT/NEXT position reconciliation and for the persistent Schedule posts; if either is unset, that reconciliation / Schedule bucket is skipped with a warning each poll (channels still get the correct category and name, just not corrected ordering / Schedule).
- `DISCORD_RUN_ARCHIVE_CATEGORY_ID` — unchanged in meaning, now also the holding place for PAST/FUTURE-existing channels in addition to app-archived Runs.

`loadBotEnv` (`src/discord-bot/env.ts`) still only hard-fails at startup when *no* channel destination exists at all (no `DISCORD_RUN_CATEGORY_ID` and no legacy `DISCORD_SIGNUP_CHANNEL_ID`); missing markers or a missing ARCHIVE category are per-poll warnings at reconciliation time, never a startup failure.

**Unmanaged channels**: a channel that's neither a configured marker nor a persisted `RunDiscordPost.runChannelId` is never renamed, deleted, or reparented, and never leaves the zone (before `#current-id`, between the markers, after `#next-id`) it already sits in. Within the CURRENT and NEXT sections, a manually created Run channel named `{weekday}-{HHMM}-…` is **repositioned by time** together with BoostingHub's own Run channels, so the whole section reads chronologically; any other unmanaged channel keeps its relative order at the end of its section, and channels above `#current-id` are never moved. Because Discord's position API requires submitting the category's full channel list at once (see "Channel reconciliation"), unmanaged channel ids appear in that one batched call whenever anything in the category needs reordering.

## Signup embed

Posted into the Run's dedicated channel (or the legacy global signup channel — see Per-Run Discord channel above) once a Run is actually signup-available (not merely non-`DRAFT` — see Sync architecture above). Summary fields: Run title, difficulty, **product label** (e.g. Season 2 Bundle), **ordered per-raid content summary** (e.g. `Tide 1/1 · The Venomous Abyss 8/8`), scheduled time, **unique signup count**, status, loot type, and **Raid Lead** (`<@id>` when linked). Role columns use Guild custom emojis named `tank` / `healer` (or `heal`) / `dps` / `loot` / `raidlead` when present (unicode fallback otherwise). Class emojis use the class name (`warrior`, `mage`, …, `dk`, `dh`). Emoji names match case-insensitively, so `:Warrior:` / `:DK:` / `:Tank:` / `:DPS:` work too. Guild emoji metadata (class and role emojis) comes from one shared per-Guild snapshot cached for **10 minutes** (`class-emoji-lookup.ts`): a sync pass makes at most one emoji REST fetch and usually none, so a new or renamed Guild emoji can take up to 10 minutes to appear. If a refresh fails, the previous snapshot keeps being used (with a warning) and the next pass retries — during a Discord outage that is at most one shared emoji request per sync pass, still half the old two-per-pass rate. With no earlier snapshot the failure propagates as before and nothing is cached. Missing emojis keep the same label/unicode fallbacks. The rare Raidboost Announce still fetches its own emoji and roles when a Run channel is created. It never lists any User's offered Characters (that stays in the ephemeral per-User reply). "Signups: 39" means 39 distinct Users with an active offer, never 39 `RunSignup` rows — a User offering three Characters still counts once.

Buttons: **Signup** (Primary), **Quick Signup** (Success), **Sign as Lootbuddy** (Secondary), **Cancel Signup** (Danger). Signup / Quick Signup / Lootbuddy disable once the signup window closes; Cancel stays enabled (a User may still remove a still-pending offer after the window closes, matching the Web withdraw rule). Custom ids (`src/discord-bot/custom-ids.ts`) carry `action:runId` (never a User id) for the buttons and the character multi-select, and a character-scoped `action:runId:characterId` form for the per-Character role selects described below — every id is validated against the same shape the server accepts before any network call is made.

### Signup / Quick Signup / Lootbuddy button flow

**Signup (Booster)** — Character multi-select + **Next** → staged role editor → Confirm:

1. `interaction.deferReply({ ephemeral: true })`.
2. `GET .../signup-options` for the acting Discord User.
3. If the window is closed or there are no eligible Booster Characters, say so and stop.
4. Start a BOOSTER staging session (seeded from `activeBoosterOffers`) and show Character multi-select with **Next** / **Cancel**. Closing the select dropdown only updates the staged picks in memory and refreshes the same menu — it does not change the step or list selections in the message. **Next** is the only advance into roles.
5. **Next** opens the role editor: per-Character **offered-role** multi-selects (`minValues=1`; single-role classes show a fixed label), Confirm / Cancel. Confirm calls `setCharacterOffers` once with `{ characterId, offeredRoles[] }`; Cancel discards staging only.
6. Staging is in-memory (`signup-staging.ts`), TTL ~15 minutes, wiped on bot restart without touching DB.

**Quick Signup (Booster)** — one click, no Character selector, no staging session:

1. `interaction.deferReply({ ephemeral: true })`.
2. `POST .../signup/quick` for the acting Discord User (`signupService.quickSignupBoosters`).
3. Concise ephemeral feedback: `Signed up with N characters offered.` plus, when relevant, skip reasons (`unavailable` / `scheduling conflict` / `missing default role` / `inactive`). Saved progress is never a skip reason; a non-conflicting reservation is not either.
4. `requestImmediateSync()` so the public Signups embed refreshes through the normal sync lane.

Quick Signup offers all eligible Booster characters (same `evaluateBoosterOptions` authority as manual signup). Saved characters and characters used on non-conflicting runs are included. Characters marked unavailable or reserved for a conflicting run (&lt; 2h) are skipped. Additive (preserves existing `offeredRoles` and selected/draft-selected rows), Booster-only, and never touches Lootbuddies. Web does not expose this accelerator.

Public signup embed Roles field:

- **Signups** = every non-withdrawn offer (PENDING, SELECTED, or NOT_SELECTED) by offered role — hybrids count once per offered role. Selected Users remain listed here; selection does not remove them from the signup pool. Roster publication must not hide unpicked (`NOT_SELECTED`) signups while the signup window remains open.
- Selected lineup is **not** rendered on this message — it lives on the separate **Roster** Discord message (`rosterMessageId`).
- External boosters never appear on the Signup embed.
- Lootbuddy signup column is a volunteered count only (planned Lootbuddy target lives on Roster).
- Participant lines: Discord `<@id>` mention once per User, then distinct class emoji(s) for that User's offers in the column (no Character-Realm, no repeated mentions). Mentions show the server nickname when set; Character identity is in Final Setup and the Web app.
- Footer clarifies: signup does not mean selected.

**Sign as Lootbuddy** — two steps (no Character selector, no Mode picker on Discord):

1. Click **Sign as Lootbuddy** → ephemeral **multi** class select (1–13 classes).
2. Confirm the selection → immediately `PUT .../lootbuddies` with one `LOOT_ONLY` entry per chosen class (replaces any previous Discord lootbuddy set for that User on the Run).

Mode (`Loot only` / `Play along`) and multi-entry lootbuddy sets remain available on the Web. Stale multi-step wizard buttons from older bot messages redirect the User to click **Sign as Lootbuddy** again.

### Cancel Signup button

`POST .../signup/cancel` (optional body `{ reason }`) — withdraws the User's active **BOOSTER and LOOTBUDDY** participation (`withdrawFromRun`). Lootbuddy-only Users can leave via this same button.

A **picked** User (on the roster or its saved draft) must give a reason: without one the API answers `WITHDRAW_REASON_REQUIRED` and writes nothing, and the button opens a **modal** (`boostinghub:withdraw-reason:<runId>`, one paragraph field, 3–300 chars). The button therefore replies without deferring (a modal must be the first response). The modal submit withdraws with the reason; the Raid Lead gets a `ROSTER_WITHDRAWN` DM (**Roster Withdrawal**: player, character, reason — escaped so it cannot mention anyone — and a link to the Roster tab built from `BETTER_AUTH_URL`). After Start Run a picked User cannot withdraw.

## Roster embed

Posted into the **same Run channel** as the signup embed (or the legacy global roster channel) as a **second Discord message** (`rosterMessageId`), independent of the Signup message. Selected Characters / external boosters only — never the volunteered signup pool. Title is `Roster`; Final Setup (`startMessageId`) remains a separate plain-text operational post after Start.

The lane maintains exactly one Roster message once the Signup message has been
provisioned (also when draft picks / externals / a prior Roster id already
exist). An empty selected lineup still posts/keeps the empty-state Roster embed
(`No players selected yet.`). **Publish Roster** transitions Draft → Published
on that **same** `rosterMessageId` in place — it never appends a second Roster
message. Save / Update / emoji / presentation refreshes also edit the current id.

**Post vs refresh.** The roster lane decides per Run:

| Condition | Mode | Bot action |
| --- | --- | --- |
| `RunRoster.postRevision > (RunDiscordPost.lastRosterPostRevision ?? 0)` | `POST` (carries `postRevision`) | edits the current `rosterMessageId` in place when it exists (or sends exactly one if missing / Discord-deleted), and records `{ kind: "roster", messageId, postRevision }` so `lastRosterPostRevision` acknowledges the fulfilled revision — **same message id** when the message already existed |
| otherwise, no message yet, `lastRosterVersion !== RunRoster.version`, or the bot's Roster render fingerprint (`ROSTER_EMBED_FORMAT_VERSION` + Guild class/role emoji fingerprint) differs from `lastRosterEmojiFingerprint` (null / pre-format posts refresh once) | `REFRESH` | edits the current `rosterMessageId` in place (Save / Update Roster, External Boosters, Raid Lead title change, new or renamed Guild emojis, presentation-format bumps); if that message was deleted in Discord it is re-sent as recovery, without claiming a post revision |

`postRevision` is advanced only by the first Publish and by an explicit **Publish Roster** republish (compare-and-set, see [roster-management.md](roster-management.md#publication)); Save and Update never advance it. There is no historical stack of Roster messages — one live Roster embed per provisioned Run channel (Final Setup after Start is separate).

**Legacy rows.** Rosters published before postRevision existed have `postRevision = 0` and `lastRosterPostRevision = null` (treated as 0): no POST is pending, so their existing message is only refreshed. The next explicit Publish Roster requests revision 1 and edits that same message.

**Delivery.** Recording is idempotent per revision: after the bot records revision N, later polls see no pending POST, and a double-submitted republish request can only advance the revision once. If the bot crashes after Discord accepted an edit/send but before the web app recorded it, the next pass retries (at-least-once for that window) without creating a duplicate when the stored message still edits successfully.

Groups: Tanks, Healers, Melee DPS, Ranged DPS, and Lootbuddies (omitted when empty). Melee/ranged classification comes from `attackTypeForSpecialization` (`src/lib/wow-specializations.ts`) — the one authoritative (class, specialization) → attack-type table, so the bot never re-derives WoW class rules itself. Tank/Healer show a real target from the Run's desired composition counts; **melee/ranged DPS show a bare count with no denominator**, because `Run.desiredDpsCount` is one combined number with no melee/ranged split in the current schema — introducing a fake denominator was deliberately avoided rather than inventing new Run fields for cosmetics.

Each member renders as `<@discordUserId> <:class:> — Character-Realm` when the User has a linked Discord account (class emoji from Guild custom emojis, else the class label), or `<:class:> — Character-Realm` when unlinked. Role column headers use the same Guild role emojis as the signup embed (`tank` / `healer` / `dps` / `loot`), with the same unicode fallbacks (🛡 ✚ ⚔ 📦).

## Raid Invite DMs (Apex-style)

When a Run is **started** (`Start Run` → `IN_PROGRESS`), BoostingHub creates a `RAID_INVITE` `UserNotification` for each SELECTED participant. Publishing the roster earlier does **not** send invites. Discord DM intent is snapshotted from `User.dmRaidInviteEnabled` + linked Discord id at creation.

The bot delivers from `listSyncWork.notificationDms` (PENDING rows only). Legacy `raidInvites` is always empty — do not regenerate invites from SELECTED + `raidInviteSentSignupIds` (avoids double DMs). See [user-notifications.md](user-notifications.md).

```text
📣 **Raid Invite**

{productLabel}
{DD/MM/YYYY HH:mm Europe/Berlin} · {DIFFICULTY}

Assignment: {Role} · {Character} ({Class}) · VIP
Channel: <#runChannelId>
Voice: <#voiceChannelId>

Please be online 10 minutes before start.
```

- VIP appears only on the Assignment line (never duplicated on the schedule line).
- `Channel:` uses the persisted `RunDiscordPost.runChannelId` as a real `<#id>` mention. When that id is missing, the Channel line is omitted — never `#unknown`.
- `Voice:` links the Run's temporary voice channel (see below). The bot prefers the voice channel it created or deleted **in the same sync pass** (voice runs before DMs), else `RunDiscordPost.voiceChannelId` read when the DM is due — so a Quiet-Hours-delayed invite never links a channel that was already deleted. Omitted when there is none. The mention is rendered by the bot only; `UserNotification.message` never contains it.
- Closed DMs (Discord 50007) → `FAILED_PERMANENT` (no retry). Transient errors leave `PENDING`.
- Successful RAID_INVITE DMs also append `RunDiscordPost.raidInviteSentSignupIds` for legacy continuity.
- Users must share the guild with the bot and allow DMs from server members.
- App-archived Runs do not enqueue notification DMs.

Roster Pick DMs (`ROSTER_SELECTED`) use a separate message body (`buildRosterSelectedDmMessage`) and are also delivered via `notificationDms`.

## Temporary Run voice channels

When a Run is `IN_PROGRESS` (after Start Run, with a start snapshot), the bot creates **one** Guild Voice channel for it:

- **Name:** `Raid with <effective Raid Lead>` (`formatRunVoiceChannelName`), where the effective Raid Lead is the assigned Raid Lead's Discord Run channel nickname, else their name (`effectiveRaidLeadChannelName`). Human-readable (not slugged); never `Run.title`, the Start Run actor or a roster member. Renamed if the effective name changes while the Run is running.
- **Where:** the dedicated `DISCORD_RUN_VOICE_CATEGORY_ID` category — never the text Run category (voice channels take no part in CURRENT/NEXT ordering). Permissions are inherited from that category; there are no per-participant overwrites.
- **Lifecycle** (`listSyncWork.voiceChannels`, `src/discord-bot/voice-channels.ts`):
  - `IN_PROGRESS`: the channel is kept, **even when nobody is in it yet**.
  - `COMPLETED` / `CANCELLED` / app-archived: kept **while anyone is connected**; on the first sync pass after it becomes empty it is deleted, and `RunDiscordPost.voiceChannelId` is cleared only after the delete succeeded.
  - No retroactive creation: a Run that ended before the bot observed it gets no voice channel.
- **Independence:** voice is Run-level infrastructure — created regardless of Quiet Hours or anyone's DM preferences, and independent of the text channel's retirement/transcript.
- **Failures never affect the Run:** creation errors (incl. Missing Permissions) persist nothing and retry next poll; Unknown Channel clears the stored id (and, while still `IN_PROGRESS`, recreates once); Missing Permissions / transient errors during cleanup keep the id for a retry; a stored id that is not a voice channel is never deleted or replaced (operator error is logged).
- **Requires** the `GuildVoiceStates` gateway intent (non-privileged; `src/discord-bot/intents.ts`) so member counts are current, and the bot needs **Manage Channels**, **View Channel** and **Connect** visibility in the voice category.
- **`DISCORD_RUN_VOICE_CATEGORY_ID` controls first creation only.** Unset → no new voice channels. An id that is not a category → logged on passes with creation work, nothing created, no fallback. In both cases channels created earlier are still kept, renamed and cleaned up by the rules above, so removing the variable never orphans them.
- **Create → persist:** a new channel is linked (and treated as the Run's channel) only after `RunDiscordPost.voiceChannelId` is recorded. If recording fails, the bot deletes the just-created channel (best effort) and the next poll retries cleanly; if that delete also fails it logs `ORPHANED VOICE CHANNEL` with the Run and channel id for manual cleanup.
- **Final Setup link:** the Final Setup post shows `Voice: <#id>` after the participant sections and before the LFG footer, with the same precedence as the Raid Invite (this pass's voice outcome, even when it is null, else the persisted `voiceChannelId`). A channel created in the same pass as the first Final Setup send is linked in that send. The bot records the id it rendered in `RunDiscordPost.lastStartVoiceChannelId`. While the Run is `IN_PROGRESS` and not archived, a mismatch with `voiceChannelId` (voice added, replaced or cleared) makes the existing post stale, and the bot edits it in place without a roster-version bump. Final Setup never provisions voice. The web Start Run preview never shows a Voice line.

## `/guide`

`/guide booster` and `/guide raidlead` reply ephemerally with a link (text + link button) to the guide's plain Discord channel in the current guild — no threads. The channel ids live in `src/discord-bot/guide-channels.ts`, which the posting scripts (`scripts/post-*-guide.mts`, run manually over SSH — see [discord-posts.md](../guides/discord-posts.md)) also use as their default target. Unknown subcommands are ignored.

## `/mysignups`

Read-only, ephemeral, registered per-guild (`npm run bot:register-commands`). Groups the same flat per-Character rows `signupService.getMyRuns` returns into one line per Run + participation type — "Offered: A, B, C · Selected: B" — matching the Web My Runs presentation. There is no `/signup` command: the Run embed's buttons are the only signup entry point, so Web and Discord never maintain two independent flows.

## Deployment

- Next.js app: one process (existing deployment, unchanged).
- Discord bot: a second, independent long-lived Node process — it holds a persistent Gateway WebSocket, which does not fit a request-scoped Next.js process.
- Suggested host: Plesk with SSH, `systemd` managing the bot process — see [`deploy/production/systemd/boostinghub-discord-bot.service`](../../deploy/production/systemd/boostinghub-discord-bot.service) (the tracked copy of the live production unit; installation is described in [`docs/deployment-production.md`](../deployment-production.md)), or run `npm run bot:start` under any other process supervisor. Run exactly one bot instance. Register slash commands once per deploy (or whenever the command list changes) with `npm run bot:register-commands` — the gateway process does not do this itself.
- Required Discord bot permissions: **View Channels, Send Messages, Embed Links, Read Message History, Manage Channels** (the last one only for per-Run channel creation/rename/reposition — not requested when running in legacy single-channel mode). The Run archive log channel additionally needs **Attach Files** (HTML transcript). Never grant Administrator to solve a permission gap.
- Environment variables: see `.env.example` (`DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`, `DISCORD_RUN_CATEGORY_ID` (preferred, the one active Run category) plus `DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID`/`DISCORD_RUN_NEXT_MARKER_CHANNEL_ID` (section ordering anchors) or `DISCORD_SIGNUP_CHANNEL_ID`/`DISCORD_ROSTER_CHANNEL_ID` (legacy fallback), `DISCORD_RUN_ARCHIVE_CATEGORY_ID`, `DISCORD_RUN_ARCHIVE_LOG_CHANNEL_ID`, optional `DISCORD_RUN_VOICE_CATEGORY_ID` (temporary Run voice channels), optional `DISCORD_WCL_REPORT_AUTHOR_IDS` (trusted Warcraft Logs log bots — read by the web app), `BOOSTINGHUB_API_BASE_URL`, `BOOSTINGHUB_BOT_API_TOKEN`). Secrets live only in the server environment, never in the repository.

### Run lifecycle → Discord

```text
BoostingHub Run becomes OPEN (signup-available) while its raid-ID week is CURRENT or NEXT
  → per-Run Discord channel created under DISCORD_RUN_CATEGORY_ID (position-reconciled in the same sync pass)
  → signup embed posted into that channel
  → User interactions (Signup / Lootbuddy / Cancel) update the same message
  → Wednesday 06:00 Europe/Berlin rollover: same channel, same category, moves above #next-id into the CURRENT section (no DB write)
  → Raid Lead publishes the roster
  → final roster embed posted into the SAME channel
  → republish edits that same roster message
  → completion/cancellation: channel and history preserved, never deleted
  → schedule ages into PAST: same channel moves into DISCORD_RUN_ARCHIVE_CATEGORY_ID holding (Run.archivedAt untouched)
  → Archive: same channel moves to DISCORD_RUN_ARCHIVE_CATEGORY_ID (overrides week classification)
  → Restore: same channel moves back to the active category, positioned into whatever section its schedule currently classifies (or ARCHIVE holding for PAST/FUTURE)
```

Every one of these moves is reconciled by the independent `channels` lane (see "Channel reconciliation" above) — each happens whether or not the signup/roster message for that Run currently needs any other update.

## MVCS / testing

- Pure, fully unit-tested: `custom-ids.ts`, `format.ts`, `discord-channel-name.ts`'s `buildDiscordRunChannelName`, `wow-run-week.ts`'s `classifyRunWeek` (basic classification, half-open boundary equality, winter/summer, and both DST transitions — with an explicit test proving the CURRENT→NEXT gap is *not* a fixed 168 UTC hours across a transition), `discord-schedule.ts` (Schedule eligibility, CURRENT/NEXT filtering, ordering, signature convergence, empty state, format-version bump), `embeds/signup-embed.ts`, `embeds/roster-embed.ts`, `bot-api-client.ts` (mocked `fetch`, including `listSyncWork`'s `channels[]`), `env.ts`'s `loadBotEnv` (the one active category, independent marker-channel resolution, and the ARCHIVE category), `interactions/error-copy.ts`, `interactions/signup-flow.ts`'s `buildSelectOptions`/`parseSelectedOffers`, `commands/mysignups.ts`'s `formatMySignups`, `channel-reconciliation.ts`'s `reconcileExistingRunChannel`/`reconcileChannels` (CURRENT/NEXT sharing one category, ARCHIVE move, rename, missing-category, missing-channel, failure-isolation), and `reconcileWeekSectionPositions` (chronological CURRENT/NEXT ordering, manual drift correction, marker identity/name/parent never touched even though their position may appear in the payload, unmanaged channels keep their relative position, missing/invalid marker config, ARCHIVE items ignored — all against fake position lists, no discord.js or live token needed). Schedule edit-in-place / deleted-message recovery / failure isolation vs archive+signup: `sync-loop.test.ts`. Service lane: `discord-schedule-sync.test.ts`.
- Bot API routes: tested by calling the exported Route Handler functions directly with constructed `NextRequest`s (`src/app/api/bot/bot-routes.test.ts`), including a contract test asserting `GET /api/bot/discord/sync` exposes `channels` alongside `signups`/`roster`, each carrying `targetBucket` and `scheduledStartAt` — no live Discord credentials required.
- `discord-sync.service.ts`: tested against the real dev database like every other Service, including channel provisioning/idempotency/rename, the independent `channels` lane, and weekly target resolution with an injectable `now` — CURRENT/NEXT eligible for first provisioning, PAST/FUTURE blocked, app archival overriding week classification, and a same-Run rollover test (NEXT → CURRENT across two `listSyncWork` calls with no Run mutation in between) (`src/services/discord-sync.service.test.ts`).
- The discord.js Client wiring itself (`client.ts`, `sync-loop.ts`'s actual channel fetch/create/message send/edit/`setPositions` calls, `register-commands.ts`) cannot be unit-tested without a live bot token — it was verified structurally (typecheck, production build, and a boot smoke test against Discord's own token validation) rather than end-to-end. `sync-loop.ts` is kept as thin as possible specifically so the real reconciliation *logic* lives in the unit-tested `channel-reconciliation.ts` instead.

## Deferred

`/runs` browse command, Discord-side Raid Lead/Admin actions (roster selection and Strike management stay Web-only), Discord role synchronization, preferred/ranked Character offers, Run type/progress channel-name segments (no domain field to source them from yet), Dawn Boosting integration of any kind.
