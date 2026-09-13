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
| `PUT /api/bot/runs/:runId/lootbuddies` | `setLootbuddies` over HTTP |
| `POST /api/bot/runs/:runId/signup/cancel` | `cancelBoosterSignup` over HTTP |
| `GET /api/bot/my-signups` | Backs `/mysignups` |
| `GET /api/bot/runs/:runId/roster` | Discord-ready final roster DTO |
| `PUT /api/bot/runs/:runId/discord-state` | Records a created channel id, or a posted message's channel/message id |

Every handler: authenticate the bot service → resolve the acting Discord User (only for per-User routes) → validate with Zod → call the Service → map the domain result/error to JSON. No Repository use in a Route Handler.

## Security

- **Bot service identity**: `BOOSTINGHUB_BOT_API_TOKEN`, a high-entropy shared secret compared with `crypto.timingSafeEqual` (`src/auth/bot-auth.ts`). Grants access to the bot API surface only — never an ADMIN/RAID_LEAD bypass. Never an ADMIN session cookie, Discord OAuth login token, or Battle.net token.
- **Acting User identity**: `User.discordUserId` — the immutable Discord snowflake, never `discordUsername` or a display name. The bot forwards `interaction.user.id` (already authenticated by Discord's own interaction signature before the bot's code ever saw it) as the `x-discord-user-id` header; a request with no header or an unlinked id is rejected (`NOT_AUTHENTICATED` / `NOT_FOUND`). A client-supplied `userId` in a request body is never read — every Bot API schema omits that field entirely, so it is silently dropped even if a malicious caller includes one.
- Every mutation still runs full normal per-User authorization (`Character` ownership, `BoosterQualification`, signup window) — bot service auth only gets a request past the door.

## Sync architecture

Run/Signup/Roster state never depends synchronously on Discord. `discordSyncService.listSyncWork(now?)` (`src/services/discord-sync.service.ts`) is the single place that decides "something changed", and returns three **independent** lanes:

- **`channels`** — channel reconciliation (name, parent category, and CURRENT/NEXT section ordering) for every Run that already has a persisted `RunDiscordPost.runChannelId`. Completely unconditional: it does not depend on the signup/roster message being dirty, on `Run.status` (DRAFT included), or on anything else — a Run that already owns a dedicated channel always gets a `channels` item, every poll. See "Channel reconciliation" and "Weekly raid-ID sections" below.
- **`signups`** — a signature (`uniqueSignupCount:signupWindowOpen:runStatus:desiredChannelName:targetBucket`) is compared against `RunDiscordPost.lastSignupSignature`. DRAFT runs are never candidates. The *first* post additionally requires signup to be genuinely available right now (`isSignupWindowOpen` — OPEN or ROSTERING with `signupsOpen` true) **and** the Run's raid-ID week to currently classify CURRENT or NEXT (see "Weekly raid-ID sections") — a Run the bot first sees only after it already reached PUBLISHED/COMPLETED/CANCELLED never gets a brand-new post for a signup phase that's already over, and a Run scheduled further out than NEXT never gets Discord infrastructure before its week is actually current or upcoming. Once a post exists, later updates are unconditional (any non-DRAFT status, any week bucket), so the same message keeps reflecting the Run's real state — including signups closing, or the Run's own channel rolling from NEXT into CURRENT — all the way through completion. `desiredChannelName`/`targetBucket` are folded into the signature as legacy wake-up signals (historical: before `channels` existed, they were the only way a rename/section move ever got picked up) — kept for now as lower-risk, though `channels` is the actual authoritative fix; a rename, Archive/Restore, or weekly rollover no longer *depends* on them to reach the channel.
- **`roster`** — `RunRoster.version` is compared against `RunDiscordPost.lastRosterVersion`; only runs with a published roster are candidates.

`RunDiscordPost` (additive migrations `20260910T2332_discord_integration_state` and `20260911T0136_discord_run_channel`) is small, presentation-only integration state — the channel/message ids the bot already created/posted, so a restart reuses/edits them instead of duplicating. It is never a second source of truth for Run/Signup/Roster data.

The bot's `sync-loop.ts` polls `GET /api/bot/discord/sync` on an interval (`DISCORD_SYNC_INTERVAL_MS`, default 60s) and processes `channels` **before** `signups`/`roster`, so a Run's channel is already in its correct name/category/section before any new message work is applied. The resolved channel ids from that pass are reused for the message paths (no duplicate rename/move for a Run that appears in more than one lane the same poll). A failed pass is logged and retried on the next tick — it never throws the process down or blocks a BoostingHub Run transition.

## Per-Run Discord channel

Preferred mode: each Run that becomes signup-available gets its own dedicated Discord text channel, created under the ONE configured Run category (`DISCORD_RUN_CATEGORY_ID`) — CURRENT- and NEXT-week Runs share this same category (Discord channels cannot contain child channels, so there is no separate "NEXT category" — see "Weekly raid-ID sections" below) — so a community sees one channel per raid rather than one shared signup channel.

**Trigger**: the same gate as the first signup post (`isSignupWindowOpen`) **and** the Run's raid-ID week currently classifying CURRENT or NEXT — a Run is never given Discord infrastructure while still `DRAFT`, never retroactively for a Run that reached PUBLISHED/COMPLETED/CANCELLED without ever having been signup-available, and never while scheduled too far out to be CURRENT or NEXT yet.

**Naming**: `buildDiscordRunChannelName` (`src/lib/discord-channel-name.ts`, pure and unit-tested) computes `{weekday}-{HHMM}-{difficulty}-{raidLead}` in the community timezone (e.g. `sat-2200-hc-titan`) from authoritative Run data (`scheduledStartAt`, `difficulty`, `raidLeadName`) — never a raw concatenation of user-provided text, and never a `current`/`next`/week-number segment (that grouping is expressed by section position, not the name — see below). **Gap**: the reference format also has `{runType}` (e.g. `vip`) and `{progress}` (e.g. `7of9`) segments; the current Run domain has no product/type field and no persisted boss-progression field, so those segments are omitted rather than inventing schema for channel cosmetics. The builder accepts them as optional inputs and will include them automatically if/when those fields exist — no builder change needed then.

**Identity**: `RunDiscordPost.runChannelId` is the only authoritative identity, recorded the instant the channel is created — before any message is posted into it, so a crash between creation and posting can never cause a retry to create a second channel. The channel is **never located by name** afterward, since a rename changes the name but not the id.

**Rename, not replace**: when the desired name changes (schedule/difficulty/raid-lead edit before roster lock), the sync pass calls `channel.setName(...)` on the *same* channel id. A completed/published Run's source fields are no longer editable through normal Run edit rules, so historical channels are never renamed after the fact.

**Never deleted, never cloned**: cancellation, completion, Archive/Restore, and weekly rollover all leave the channel in place with its full history and identity — Archive/Restore *does* move it to a different category, and weekly rollover *does* change its position within the active category (see "Channel reconciliation" and "Weekly raid-ID sections" below), but neither is ever a delete/recreate/clone. The signup embed's buttons/content still update to reflect a closed/cancelled state in the same message.

**Self-healing**: if the stored channel id no longer resolves in Discord (deleted out-of-band), the next sync pass creates a replacement rather than leaving the Run without a home — this is recovery, never the bot deleting anything itself. This self-healing is exclusive to the signup path (gated by `isSignupWindowOpen` + week bucket, same as first-channel provisioning); `channels` reconciliation and the roster path only reuse a channel that already exists — if a Run's channel is missing when only `channels`/roster work would have reached it, that item is skipped with a warning rather than provisioning anything.

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
2. Sort the CURRENT-targeted and NEXT-targeted items chronologically by `scheduledStartAt` (tie-broken by `runId`); any channel in the category that BoostingHub doesn't own (not a marker, not a Run's `existingRunChannelId`) keeps its position relative to other unmanaged channels in whichever zone (before `#current-id`, between the markers, after `#next-id`) it already sits in.
3. Build the full desired top-to-bottom order — `[unmanaged before] #current-id [CURRENT Run channels, chronological] [unmanaged between] #next-id [NEXT Run channels, chronological] [unmanaged after]` — and compare it against the category's actual current order. Already matching: zero API calls.
4. Otherwise, submit the ENTIRE category's channels as one dense `setPositions([...])` call (discord.js's `guild.channels.setPositions`), including the two markers. This is a confirmed requirement of Discord's real API — a sparse payload naming only the channels that need to move, leaving the rest (including the markers) unspecified, is silently ignored rather than applied; see the code comment on `reconcileWeekSectionPositions` for how this was discovered against a live server.

Steps 3–4 of the first mechanism, and the whole of the second, are each independently idempotent. `sync-loop.ts` runs channel reconciliation (name + parent) first, then any signup/roster message work (which may provision a first channel), then **one** CURRENT/NEXT position reconciliation that includes both pre-existing `channels` items and any channels created in this same pass — so a brand-new CURRENT/NEXT Run channel finishes its first successful sync already in the correct marker section. Position reconciliation runs in a `finally` after provisioning is known, so a later signup/roster embed send/edit failure cannot leave a newly created channel below `#next-id` until the next poll. After each `setPositions` write the bot **fresh-fetches** the category from Discord (REST `guild.channels.fetch()`, not cache alone) and verifies relative order; if Discord's create→position consistency briefly leaves the new channel below `#next-id` despite a successful write, the same sync pass retries reconcile+verify up to two more times with a short bounded delay (not the 60s poll). Later polls still self-heal manual drift and weekly NEXT → CURRENT rollover via the same reconciler. A `runId -> channelId` map from the name/parent pass lets the message paths reuse the same resolved channel instead of re-resolving (and potentially re-renaming/re-moving) it a second time in the same poll.

**Archive**: `runService.archiveRun` sets `Run.archivedAt`; the next sync pass moves the Run's existing channel to `DISCORD_RUN_ARCHIVE_CATEGORY_ID` — same channel, same history, same messages. App archival always overrides raid-ID week classification (see below).
**Restore**: `runService.restoreRun` clears `archivedAt`; the next sync pass re-derives placement from the Run's schedule — CURRENT/NEXT-scheduled goes back to the one active category (positioned into the correct section on the following position-reconciliation pass), and a PAST/FUTURE schedule stays in ARCHIVE holding. Restore is deliberately never "back to the one active category" as a single undifferentiated destination — which section it lands in is always re-derived from the schedule.
Neither ever creates message work by itself — an Archive/Restore with no other Run change produces zero signup/roster reposts, only the channel move.

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

**Marker channels are manual Discord infrastructure, not BoostingHub state.** They are ordinary text channels a human creates and places inside the active category; BoostingHub never creates, renames, deletes, archives, or reparents them, and never sends/edits/deletes messages inside them. Their ids are pure environment configuration (`DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID`/`DISCORD_RUN_NEXT_MARKER_CHANNEL_ID`), exactly like a configured category id. Their live `position` **may** shift as a side effect of the section-ordering payload described below (e.g. `#next-id` moves down whenever the CURRENT section gains a channel) — this is a mechanical consequence of how Discord's position API works, not BoostingHub taking editorial control of the markers: their id, name, parent, and content are never touched, and their relative order to each other (`#current-id` above `#next-id`) is asserted up front and never itself changed.

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
- `DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID` / `DISCORD_RUN_NEXT_MARKER_CHANNEL_ID` — the two marker channels. Required for CURRENT/NEXT position reconciliation; if either is unset, that reconciliation is skipped with a warning each poll (channels still get the correct category and name, just not corrected ordering).
- `DISCORD_RUN_ARCHIVE_CATEGORY_ID` — unchanged in meaning, now also the holding place for PAST/FUTURE-existing channels in addition to app-archived Runs.

`loadBotEnv` (`src/discord-bot/env.ts`) still only hard-fails at startup when *no* channel destination exists at all (no `DISCORD_RUN_CATEGORY_ID` and no legacy `DISCORD_SIGNUP_CHANNEL_ID`); missing markers or a missing ARCHIVE category are per-poll warnings at reconciliation time, never a startup failure.

**Unmanaged channels**: a channel that's neither a configured marker nor a persisted `RunDiscordPost.runChannelId` is never renamed, deleted, or reparented, and keeps its position relative to other unmanaged channels in whichever zone (before `#current-id`, between the markers, after `#next-id`) it already sits in — reconciliation only ever decides new positions for BoostingHub-owned Run channels and the two markers (see above), never for a manually created Phoenix channel's own ordering relative to other unmanaged channels. Because Discord's position API requires submitting the category's full channel list at once (see "Channel reconciliation"), an unmanaged channel's id does appear in that one batched call whenever anything in the category needs reordering — but always with its own pre-existing relative position preserved, never a new one BoostingHub chose for it.

## Signup embed

Posted into the Run's dedicated channel (or the legacy global signup channel — see Per-Run Discord channel above) once a Run is actually signup-available (not merely non-`DRAFT` — see Sync architecture above). Content only — Run title, difficulty, raid, scheduled time, **unique signup count**, and status; it never lists any User's offered Characters (that stays in the ephemeral per-User reply). "Signups: 39" means 39 distinct Users with an active offer, never 39 `RunSignup` rows — a User offering three Characters still counts once.

Buttons: **Signup** (Primary), **Sign as Lootbuddy** (Secondary), **Cancel Signup** (Danger). Signup/Lootbuddy disable once the signup window closes; Cancel stays enabled (a User may still remove a still-pending offer after the window closes, matching the Web withdraw rule). Custom ids (`src/discord-bot/custom-ids.ts`) carry `action:runId` (never a User id) for the buttons and the character multi-select, and a character-scoped `action:runId:characterId` form for the per-Character role selects described below — every id is validated against the same shape the server accepts before any network call is made.

### Signup / Lootbuddy button flow

**Signup (Booster)** — Character multi-select → staged role editor → Confirm:

1. `interaction.deferReply({ ephemeral: true })`.
2. `GET .../signup-options` for the acting Discord User.
3. If the window is closed or there are no eligible Booster Characters, say so and stop.
4. Show an ephemeral multi-select of eligible Characters (preselect current `activeBoosterOffers`). Labels show persisted role or specialization default.
5. Submitting stages a BOOSTER session (`handleCharacterSelect`) — nothing persisted yet.
6. Staging editor: per-Character role selects, Confirm / Cancel. Confirm calls `setCharacterOffers` once; Cancel discards staging only.
7. Staging is in-memory (`signup-staging.ts`), TTL ~15 minutes, wiped on bot restart without touching DB.

**Sign as Lootbuddy** — staged Class + Mode collection (no Character selector):

1. Preload existing `activeLootbuddies` into a dedicated Lootbuddy staging session.
2. Summary of staged entries (Class — Mode). Buttons: Add / Edit / Remove / Confirm / Cancel.
3. Add/Edit: pick `WowClass`, then pick Mode (`Loot only` / `Play along`).
4. Confirm calls `PUT .../lootbuddies` (`setLootbuddies`) once with the full desired set; Cancel discards staging and leaves DB untouched.
5. Zero-character Users can complete this flow. Identical Class+Mode entries are allowed as distinct rows.

### Cancel Signup button

`POST .../signup/cancel` — withdraws the User's active **BOOSTER** offer-set only (`cancelBoosterSignup`). Lootbuddies are unchanged. A protected Booster offer rejects the whole cancellation.

## Final roster embed

Posted into the **same Run channel** as the signup embed (or the legacy global roster channel) when a roster is first published, and **edited in place** (never reposted) whenever `RunRoster.version` advances on republish. Selected Characters only — never the full offer set. One Run, one channel, both signup and roster information — no separate roster channel per Run in this MVP.

Groups: Tanks, Healers, Melee DPS, Ranged DPS, and Lootbuddies (omitted when empty). Melee/ranged classification comes from `attackTypeForSpecialization` (`src/lib/wow-specializations.ts`) — the one authoritative (class, specialization) → attack-type table, so the bot never re-derives WoW class rules itself. Tank/Healer show a real target from the Run's desired counts; **melee/ranged DPS show a bare count with no denominator**, because `Run.desiredDpsCount` is one combined number with no melee/ranged split in the current schema — introducing a fake denominator was deliberately avoided rather than inventing new Run fields for cosmetics.

Each member renders as `<@discordUserId> — Character-Realm` when the User has a linked Discord account, or `Character-Realm` alone otherwise.

## `/mysignups`

The one slash command. Read-only, ephemeral, registered per-guild (`npm run bot:register-commands`). Groups the same flat per-Character rows `signupService.getMyRuns` returns into one line per Run + participation type — "Offered: A, B, C · Selected: B" — matching the Web My Runs presentation. There is no `/signup` command: the Run embed's buttons are the only signup entry point, so Web and Discord never maintain two independent flows.

## Deployment

- Next.js app: one process (existing deployment, unchanged).
- Discord bot: a second, independent long-lived Node process — it holds a persistent Gateway WebSocket, which does not fit a request-scoped Next.js process.
- Suggested host: Plesk with SSH, `systemd` managing the bot process — see [`deploy/discord-bot.service`](../../deploy/discord-bot.service) for a working example unit, or run `npm run bot:start` under any other process supervisor. Register slash commands once per deploy (or whenever the command list changes) with `npm run bot:register-commands` — the gateway process does not do this itself.
- Required Discord bot permissions: **View Channels, Send Messages, Embed Links, Read Message History, Manage Channels** (the last one only for per-Run channel creation/rename/reposition — not requested when running in legacy single-channel mode). Never grant Administrator to solve a permission gap.
- Environment variables: see `.env.example` (`DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`, `DISCORD_RUN_CATEGORY_ID` (preferred, the one active Run category) plus `DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID`/`DISCORD_RUN_NEXT_MARKER_CHANNEL_ID` (section ordering anchors) or `DISCORD_SIGNUP_CHANNEL_ID`/`DISCORD_ROSTER_CHANNEL_ID` (legacy fallback), `DISCORD_RUN_ARCHIVE_CATEGORY_ID`, `BOOSTINGHUB_API_BASE_URL`, `BOOSTINGHUB_BOT_API_TOKEN`). Secrets live only in the server environment, never in the repository.

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

- Pure, fully unit-tested: `custom-ids.ts`, `format.ts`, `discord-channel-name.ts`'s `buildDiscordRunChannelName`, `wow-run-week.ts`'s `classifyRunWeek` (basic classification, half-open boundary equality, winter/summer, and both DST transitions — with an explicit test proving the CURRENT→NEXT gap is *not* a fixed 168 UTC hours across a transition), `embeds/signup-embed.ts`, `embeds/roster-embed.ts`, `bot-api-client.ts` (mocked `fetch`, including `listSyncWork`'s `channels[]`), `env.ts`'s `loadBotEnv` (the one active category, independent marker-channel resolution, and the ARCHIVE category), `interactions/error-copy.ts`, `interactions/signup-flow.ts`'s `buildSelectOptions`/`parseSelectedOffers`, `commands/mysignups.ts`'s `formatMySignups`, `channel-reconciliation.ts`'s `reconcileExistingRunChannel`/`reconcileChannels` (CURRENT/NEXT sharing one category, ARCHIVE move, rename, missing-category, missing-channel, failure-isolation), and `reconcileWeekSectionPositions` (chronological CURRENT/NEXT ordering, manual drift correction, marker identity/name/parent never touched even though their position may appear in the payload, unmanaged channels keep their relative position, missing/invalid marker config, ARCHIVE items ignored — all against fake position lists, no discord.js or live token needed).
- Bot API routes: tested by calling the exported Route Handler functions directly with constructed `NextRequest`s (`src/app/api/bot/bot-routes.test.ts`), including a contract test asserting `GET /api/bot/discord/sync` exposes `channels` alongside `signups`/`roster`, each carrying `targetBucket` and `scheduledStartAt` — no live Discord credentials required.
- `discord-sync.service.ts`: tested against the real dev database like every other Service, including channel provisioning/idempotency/rename, the independent `channels` lane, and weekly target resolution with an injectable `now` — CURRENT/NEXT eligible for first provisioning, PAST/FUTURE blocked, app archival overriding week classification, and a same-Run rollover test (NEXT → CURRENT across two `listSyncWork` calls with no Run mutation in between) (`src/services/discord-sync.service.test.ts`).
- The discord.js Client wiring itself (`client.ts`, `sync-loop.ts`'s actual channel fetch/create/message send/edit/`setPositions` calls, `register-commands.ts`) cannot be unit-tested without a live bot token — it was verified structurally (typecheck, production build, and a boot smoke test against Discord's own token validation) rather than end-to-end. `sync-loop.ts` is kept as thin as possible specifically so the real reconciliation *logic* lives in the unit-tested `channel-reconciliation.ts` instead.

## Deferred

Selection/roster-published notifications, `/runs` browse command, Discord-side Raid Lead/Admin actions (roster selection and Strike management stay Web-only), Discord role synchronization, preferred/ranked Character offers, Run type/progress channel-name segments (no domain field to source them from yet), Dawn Boosting integration of any kind.
