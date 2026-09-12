# Discord bot

## Purpose

Discord is a second interaction surface for the exact same signup domain the Web app uses — never a parallel implementation. A User may sign up through the Web dialog or through a Discord Run embed; both manipulate the same `RunSignup` rows through `signupService.setCharacterOffers` / `cancelActiveOffers`. There is no separate "Discord signup" record.

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
| `GET /api/bot/runs/:runId/signup-options` | Eligible Characters + current offers for the acting Discord User |
| `PUT /api/bot/runs/:runId/signup` | `setCharacterOffers` over HTTP |
| `POST /api/bot/runs/:runId/signup/cancel` | `cancelActiveOffers` over HTTP |
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

- **`channels`** — channel reconciliation (name + CURRENT/NEXT/ARCHIVE category) for every Run that already has a persisted `RunDiscordPost.runChannelId`. Completely unconditional: it does not depend on the signup/roster message being dirty, on `Run.status` (DRAFT included), or on anything else — a Run that already owns a dedicated channel always gets a `channels` item, every poll. See "Channel reconciliation" and "Weekly raid-ID categories" below.
- **`signups`** — a signature (`uniqueSignupCount:signupWindowOpen:runStatus:desiredChannelName:targetBucket`) is compared against `RunDiscordPost.lastSignupSignature`. DRAFT runs are never candidates. The *first* post additionally requires signup to be genuinely available right now (`isSignupWindowOpen` — OPEN or ROSTERING with `signupsOpen` true) **and** the Run's raid-ID week to currently classify CURRENT or NEXT (see "Weekly raid-ID categories") — a Run the bot first sees only after it already reached PUBLISHED/COMPLETED/CANCELLED never gets a brand-new post for a signup phase that's already over, and a Run scheduled further out than NEXT never gets Discord infrastructure before its week is actually current or upcoming. Once a post exists, later updates are unconditional (any non-DRAFT status, any week bucket), so the same message keeps reflecting the Run's real state — including signups closing, or the Run's own channel rolling from NEXT into CURRENT — all the way through completion. `desiredChannelName`/`targetBucket` are folded into the signature as legacy wake-up signals (historical: before `channels` existed, they were the only way a rename/category move ever got picked up) — kept for now as lower-risk, though `channels` is the actual authoritative fix; a rename, Archive/Restore, or weekly rollover no longer *depends* on them to reach the channel.
- **`roster`** — `RunRoster.version` is compared against `RunDiscordPost.lastRosterVersion`; only runs with a published roster are candidates.

`RunDiscordPost` (additive migrations `20260910T2332_discord_integration_state` and `20260911T0136_discord_run_channel`) is small, presentation-only integration state — the channel/message ids the bot already created/posted, so a restart reuses/edits them instead of duplicating. It is never a second source of truth for Run/Signup/Roster data.

The bot's `sync-loop.ts` polls `GET /api/bot/discord/sync` on an interval (`DISCORD_SYNC_INTERVAL_MS`, default 60s) and processes `channels` **before** `signups`/`roster`, so a Run's channel is already in its correct name/category before any new message work is applied. The resolved channel ids from that pass are reused for the message paths (no duplicate rename/move for a Run that appears in more than one lane the same poll). A failed pass is logged and retried on the next tick — it never throws the process down or blocks a BoostingHub Run transition.

## Per-Run Discord channel

Preferred mode: each Run that becomes signup-available gets its own dedicated Discord text channel, created under a configured category — `DISCORD_RUN_CURRENT_CATEGORY_ID` or `DISCORD_RUN_NEXT_CATEGORY_ID` depending on the Run's raid-ID week (see "Weekly raid-ID categories" below) — so a community sees one channel per raid, correctly grouped by week, rather than one shared signup channel.

**Trigger**: the same gate as the first signup post (`isSignupWindowOpen`) **and** the Run's raid-ID week currently classifying CURRENT or NEXT — a Run is never given Discord infrastructure while still `DRAFT`, never retroactively for a Run that reached PUBLISHED/COMPLETED/CANCELLED without ever having been signup-available, and never while scheduled too far out to be CURRENT or NEXT yet.

**Naming**: `buildDiscordRunChannelName` (`src/lib/discord-channel-name.ts`, pure and unit-tested) computes `{weekday}-{HHMM}-{difficulty}-{raidLead}` in the community timezone (e.g. `sat-2200-hc-titan`) from authoritative Run data (`scheduledStartAt`, `difficulty`, `raidLeadName`) — never a raw concatenation of user-provided text. **Gap**: the reference format also has `{runType}` (e.g. `vip`) and `{progress}` (e.g. `7of9`) segments; the current Run domain has no product/type field and no persisted boss-progression field, so those segments are omitted rather than inventing schema for channel cosmetics. The builder accepts them as optional inputs and will include them automatically if/when those fields exist — no builder change needed then.

**Identity**: `RunDiscordPost.runChannelId` is the only authoritative identity, recorded the instant the channel is created — before any message is posted into it, so a crash between creation and posting can never cause a retry to create a second channel. The channel is **never located by name** afterward, since a rename changes the name but not the id.

**Rename, not replace**: when the desired name changes (schedule/difficulty/raid-lead edit before roster lock), the sync pass calls `channel.setName(...)` on the *same* channel id. A completed/published Run's source fields are no longer editable through normal Run edit rules, so historical channels are never renamed after the fact.

**Never deleted, never cloned**: cancellation, completion, Archive/Restore, and weekly rollover all leave the channel in place with its full history and identity — each of those *does* move it to a different category (see "Channel reconciliation" and "Weekly raid-ID categories" below), but that is always a move, never a delete/recreate/clone. The signup embed's buttons/content still update to reflect a closed/cancelled state in the same message.

**Self-healing**: if the stored channel id no longer resolves in Discord (deleted out-of-band), the next sync pass creates a replacement rather than leaving the Run without a home — this is recovery, never the bot deleting anything itself. This self-healing is exclusive to the signup path (gated by `isSignupWindowOpen` + week bucket, same as first-channel provisioning); `channels` reconciliation and the roster path only reuse a channel that already exists — if a Run's channel is missing when only `channels`/roster work would have reached it, that item is skipped with a warning rather than provisioning anything.

**Legacy/test fallback**: when neither `DISCORD_RUN_CURRENT_CATEGORY_ID` nor `DISCORD_RUN_NEXT_CATEGORY_ID` (nor the deprecated `DISCORD_RUN_CATEGORY_ID`, a CURRENT-only fallback) is set, the bot posts into the single global `DISCORD_SIGNUP_CHANNEL_ID` / `DISCORD_ROSTER_CHANNEL_ID` exactly as before per-Run provisioning existed — useful for a minimal test setup that hasn't created categories yet. At least one CURRENT-resolving configuration or `DISCORD_SIGNUP_CHANNEL_ID` is required at startup (`loadBotEnv` fails fast otherwise); `DISCORD_RUN_NEXT_CATEGORY_ID` has no such fallback and simply produces a per-Run warning (never a silent CURRENT substitution) if a NEXT-week Run needs it while it's unset. `channels` reconciliation only ever concerns `RunDiscordPost.runChannelId` — the legacy global channel ids are never treated as a dedicated Run channel and never appear in `channels`.

**Permissions**: creating, renaming, and moving channels requires the bot's role to have **Manage Channels**, in addition to View Channels / Send Messages / Embed Links / Read Message History. The created channel inherits permissions from its parent category by default — no per-channel permission overwrites are created, and a category move never resyncs permissions (`lockPermissions: false` — see "Channel reconciliation").

## Channel reconciliation

**Channel state is reconciled independently from message state.** Before this existed, a Run's channel name and category were only ever corrected as a *side effect* of the bot processing a signup or roster message update — so a Run that already had a settled signup/roster message (the common steady state) got no work item at all, and its channel could sit in the wrong category or under the wrong name indefinitely.

`discordSyncService.listSyncWork()`'s `channels` lane fixes this: it returns one `ChannelSyncWorkItem` — `{ runId, existingRunChannelId, desiredChannelName, targetBucket }`, with `existingRunChannelId` always non-null — for **every** Run that already has a persisted `RunDiscordPost.runChannelId`, regardless of `Run.status` (DRAFT included, for an abnormal legacy row), archive state, raid-ID week, or whether any signup/roster message currently needs updating. It is expected and correct for this lane to return the same Run on every poll — BoostingHub's database knows the *desired* name/category but not Discord's *live* `parentId` or actual channel name (including any out-of-band manual change), so the bot must keep re-checking. This is also what makes automatic weekly rollover (NEXT → CURRENT) work with zero database writes — see "Weekly raid-ID categories" below.

`src/discord-bot/channel-reconciliation.ts` holds the actual reconciliation logic, deliberately decoupled from discord.js's concrete channel types behind a narrow `ReconcilableChannel`/`ChannelFetcher` interface so it is unit-testable without a live bot token (`channel-reconciliation.test.ts`). For each item:

1. Fetch the channel by its persisted id (`sync-loop.ts`'s adapter prefers `client.channels.cache` over a `fetch` REST call).
2. If it can't be resolved (deleted or inaccessible): log a warning and skip — never crash, never provision a replacement (that stays exclusive to the signup path above), and never let one bad channel stop the rest of the batch from reconciling.
3. If its name doesn't match `desiredChannelName`: `setName(...)` in place.
4. Independently, resolve the desired parent from `item.targetBucket` — `"CURRENT"` → `DISCORD_RUN_CURRENT_CATEGORY_ID`, `"NEXT"` → `DISCORD_RUN_NEXT_CATEGORY_ID`, `"ARCHIVE"` → `DISCORD_RUN_ARCHIVE_CATEGORY_ID`. The bot never computes `targetBucket` itself — it always arrives already decided by `discordSyncService` (see "Weekly raid-ID categories"). If the resolved category env var is unset: log a warning and leave the channel where it is (never invents another parent, and NEXT is never substituted with CURRENT or vice versa). If its current `parentId` already matches: no-op. Otherwise `setParent(desiredParentId, { lockPermissions: false })` — a plain move, never a permission resync, never a delete/recreate/clone.

Steps 3 and 4 are each independently idempotent — a channel that's already correctly named and correctly placed produces zero Discord API calls.

`sync-loop.ts` runs `channels` reconciliation first, before any signup/roster message work, and keeps a `runId -> channelId` map from that pass so the message paths reuse the same resolved channel instead of re-resolving (and potentially re-renaming/re-moving) it a second time in the same poll.

**Archive**: `runService.archiveRun` sets `Run.archivedAt`; the next sync pass moves the Run's existing channel to `DISCORD_RUN_ARCHIVE_CATEGORY_ID` — same channel, same history, same messages. App archival always overrides raid-ID week classification (see below).
**Restore**: `runService.restoreRun` clears `archivedAt`; the next sync pass re-derives placement from the Run's schedule — CURRENT-scheduled goes to `DISCORD_RUN_CURRENT_CATEGORY_ID`, NEXT-scheduled to `DISCORD_RUN_NEXT_CATEGORY_ID`, and a PAST/FUTURE schedule stays in ARCHIVE holding. Restore is deliberately never "back to the one active category" — there hasn't been a single active category since weekly raid-ID categories replaced it.
Neither ever creates message work by itself — an Archive/Restore with no other Run change produces zero signup/roster reposts, only the channel move.

## Weekly raid-ID categories

Phoenix Discord keeps separate categories for the **CURRENT** raid-ID week and the **NEXT** one. BoostingHub places each Run's dedicated channel according to its `scheduledStartAt`, re-evaluated on every sync pass — there is no persisted week bucket anywhere in the schema, and no cron mutates a Run row for weekly rollover.

**Boundary**: Wednesday 06:00 **Europe/Berlin** — a local wall-clock instant, not a fixed UTC offset. Europe/Berlin alternates between CET (UTC+1) and CEST (UTC+2); the reset stays 06:00 local across that transition, which is why `classifyRunWeek()` (`src/lib/wow-run-week.ts`) recomputes the boundary from real calendar dates via timezone-aware arithmetic on every call rather than adding `7 * 24h` in milliseconds to the previous boundary — the latter would silently drift the local reset time by an hour across a DST transition. This is a **product-specific** boundary, unrelated to `wow-weekly-reset.ts`'s fixed-UTC Blizzard regional reset (used only for lockout/encounter classification) — the two are never derived from each other.

**Half-open windows**, given `currentStart` = the most recent Wednesday 06:00 Europe/Berlin at or before `now`, `nextStart` = 7 local calendar days later, `followingStart` = 7 more:

| Bucket | Range |
| --- | --- |
| PAST | `scheduledStartAt < currentStart` |
| CURRENT | `currentStart <= scheduledStartAt < nextStart` |
| NEXT | `nextStart <= scheduledStartAt < followingStart` |
| FUTURE | `scheduledStartAt >= followingStart` |

**App archival always wins.** `resolveDiscordTarget` (`discord-sync.service.ts`) checks `Run.archivedAt` first — an archived Run always targets ARCHIVE regardless of what its schedule would otherwise classify. Only when a Run is *not* app-archived does its raid-ID week decide the target: CURRENT/NEXT map directly to the CURRENT/NEXT categories; **PAST and FUTURE both map to ARCHIVE** as a holding placement — this keeps the strict invariant that CURRENT contains only CURRENT-week Runs and NEXT contains only NEXT-week Runs, without ever deleting/recreating an already-provisioned channel that has simply aged out of the active rotation (PAST) or hasn't reached it yet (FUTURE, legacy data only — see below). This never touches `Run.archivedAt`; a PAST/FUTURE Run sitting in ARCHIVE holding is not "app-archived" and stays fully editable/manageable exactly as any other non-archived Run of its status.

**Far-future first-channel suppression**: a Run classified FUTURE with no existing `runChannelId` never gets one — not a channel, not a `RunDiscordPost` row, not a signup message — even while `OPEN` with `signupsOpen: true`. First-channel provisioning requires **both** `isSignupWindowOpen` **and** a CURRENT/NEXT classification (see "Per-Run Discord channel" above); FUTURE and PAST both fail that second condition. A Run scheduled two raid-ID weeks out today produces zero Discord side effects until the calendar catches up.

**Automatic rollover, no database write**: because `channels` reconciliation re-derives `targetBucket` from `scheduledStartAt` + real time on *every* poll (see "Channel reconciliation" above), a Run that was NEXT yesterday and becomes CURRENT after this week's Wednesday 06:00 rollover is picked up by the very next sync pass — same channel id, `setParent(DISCORD_RUN_CURRENT_CATEGORY_ID, { lockPermissions: false })`. No cron, no scheduled job, no Run row update. The same mechanism handles a Run that was legacy-provisioned while FUTURE (pre-dating this feature, or created before its week became eligible) sitting in ARCHIVE holding: once real time advances it into NEXT and then CURRENT, the same channel id moves ARCHIVE → NEXT → CURRENT across successive weekly rollovers, never deleted or recreated.

**Environment variables**:

- `DISCORD_RUN_CURRENT_CATEGORY_ID` — preferred, explicit. Falls back to the deprecated `DISCORD_RUN_CATEGORY_ID` when unset.
- `DISCORD_RUN_NEXT_CATEGORY_ID` — has **no** legacy fallback. If unset while a Run needs NEXT placement, the bot logs a warning and leaves that Run's channel where it is — it is never substituted with CURRENT.
- `DISCORD_RUN_CATEGORY_ID` — **deprecated**. Resolves CURRENT only, purely so existing single-category deployments keep working without immediate reconfiguration. Never resolves NEXT under any circumstance.
- `DISCORD_RUN_ARCHIVE_CATEGORY_ID` — unchanged in meaning, now also the holding place for PAST/FUTURE-existing channels in addition to app-archived Runs.

`loadBotEnv` (`src/discord-bot/env.ts`) still only hard-fails at startup when *no* channel destination exists at all (no CURRENT-resolving category and no legacy `DISCORD_SIGNUP_CHANNEL_ID`); a missing NEXT or ARCHIVE category is a per-Run warning at reconciliation time, never a startup failure, matching how a missing ARCHIVE category already behaved before this feature.

**Unmanaged channels**: reconciliation only ever touches channels BoostingHub owns via a persisted `RunDiscordPost.runChannelId`. It never enumerates a category's contents and never moves a manually created Phoenix channel merely because it happens to live inside CURRENT or NEXT.

## Signup embed

Posted into the Run's dedicated channel (or the legacy global signup channel — see Per-Run Discord channel above) once a Run is actually signup-available (not merely non-`DRAFT` — see Sync architecture above). Content only — Run title, difficulty, raid, scheduled time, **unique signup count**, and status; it never lists any User's offered Characters (that stays in the ephemeral per-User reply). "Signups: 39" means 39 distinct Users with an active offer, never 39 `RunSignup` rows — a User offering three Characters still counts once.

Buttons: **Signup** (Primary), **Sign as Lootbuddy** (Secondary), **Cancel Signup** (Danger). Signup/Lootbuddy disable once the signup window closes; Cancel stays enabled (a User may still remove a still-pending offer after the window closes, matching the Web withdraw rule). Custom ids (`src/discord-bot/custom-ids.ts`) carry `action:runId` (never a User id) for the buttons and the character multi-select, and a character-scoped `action:runId:characterId` form for the per-Character role selects described below — every id is validated against the same shape the server accepts before any network call is made.

### Signup / Lootbuddy button flow

1. `interaction.deferReply({ ephemeral: true })`.
2. `GET .../signup-options` for the acting Discord User.
3. If the window is closed or there are no eligible Characters, say so and stop.
4. Show an ephemeral multi-select with one option per eligible Character, preselecting the User's current active offers. For BOOSTER, each label shows the Character's persisted role if it already has an active offer, else its specialization-derived default (suffixed "(default)"), for information only. LOOTBUDDY has no role dimension.
5. **LOOTBUDDY** submits and applies immediately — there is nothing to configure. **BOOSTER** submits into a staging step instead (`handleCharacterSelect` in `signup-flow.ts`): nothing is persisted yet. Each selected Character's role resolves to its existing offer's role, else its specialization default, else (for a single-role class) the only role it can perform, else stays unresolved until chosen.
6. The same ephemeral message is replaced with the **staging editor** (`renderStagingEditor`): one role select per staged Character whose class can perform more than one role (up to 4 rows — Discord allows 5 action rows per message and one is reserved for the buttons below; a longer tail points to the Web dialog rather than capping the product-wide offer count), each defaulted to that Character's currently staged role; single-role Characters are listed as read-only text. A **Confirm Signup** (or **Confirm Changes**, when editing an already-persisted offer) and a **Cancel** button are always present. Picking a role (`handleRoleSelect`) only updates the staged session and re-renders this same editor — still no persistence.
7. **Confirm** (`handleConfirmSignupButton`) is the one and only mutation point: it calls `setCharacterOffers` exactly once with the complete staged desired set, then clears the session. A failure (`SIGNUP_CLOSED`, `INVALID_CHARACTER_ROLE`, `CHARACTER_ALREADY_SELECTED_OTHER_RUN`, …) keeps the session and re-renders the editor with the mapped error so the User can fix and retry. **Cancel** (`handleDiscardSignupButton`) discards the staged session and calls no API at all — distinct from the persisted-offer "Cancel Signup" button below, which withdraws an already-saved signup via `cancelActiveOffers`.
8. Staging state lives only in an in-memory, per-(Discord User, Run) session (`signup-staging.ts`) — keyed so one User can never see or mutate another's, TTL-renewed on activity to match Discord's own ~15 minute interaction-editing window, and wiped (never corrupting persisted signup state) on bot restart. A stale or missing session answers with an explicit "editor has expired" message rather than silently doing nothing.

### Cancel Signup button

`POST .../signup/cancel` — withdraws the User's entire active offer-set atomically. A protected offer (currently roster-selected, or published-and-locked) rejects the whole cancellation with the server's own explanation.

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
- Required Discord bot permissions: **View Channels, Send Messages, Embed Links, Read Message History, Manage Channels** (the last one only for per-Run channel creation/rename — not requested when running in legacy single-channel mode). Never grant Administrator to solve a permission gap.
- Environment variables: see `.env.example` (`DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`, `DISCORD_RUN_CURRENT_CATEGORY_ID` and `DISCORD_RUN_NEXT_CATEGORY_ID` (preferred; `DISCORD_RUN_CATEGORY_ID` is a deprecated CURRENT-only fallback) or `DISCORD_SIGNUP_CHANNEL_ID`/`DISCORD_ROSTER_CHANNEL_ID` (legacy fallback), `DISCORD_RUN_ARCHIVE_CATEGORY_ID`, `BOOSTINGHUB_API_BASE_URL`, `BOOSTINGHUB_BOT_API_TOKEN`). Secrets live only in the server environment, never in the repository.

### Run lifecycle → Discord

```text
BoostingHub Run becomes OPEN (signup-available) while its raid-ID week is CURRENT or NEXT
  → per-Run Discord channel created under DISCORD_RUN_CURRENT_CATEGORY_ID or DISCORD_RUN_NEXT_CATEGORY_ID
  → signup embed posted into that channel
  → User interactions (Signup / Lootbuddy / Cancel) update the same message
  → Wednesday 06:00 Europe/Berlin rollover: same channel moves NEXT -> CURRENT (no DB write)
  → Raid Lead publishes the roster
  → final roster embed posted into the SAME channel
  → republish edits that same roster message
  → completion/cancellation: channel and history preserved, never deleted
  → schedule ages into PAST: same channel moves into DISCORD_RUN_ARCHIVE_CATEGORY_ID holding (Run.archivedAt untouched)
  → Archive: same channel moves to DISCORD_RUN_ARCHIVE_CATEGORY_ID (overrides week classification)
  → Restore: same channel moves back to whatever its schedule currently classifies (CURRENT/NEXT/ARCHIVE holding)
```

Every one of these moves is reconciled by the independent `channels` lane (see "Channel reconciliation" above) — each happens whether or not the signup/roster message for that Run currently needs any other update.

## MVCS / testing

- Pure, fully unit-tested: `custom-ids.ts`, `format.ts`, `discord-channel-name.ts`'s `buildDiscordRunChannelName`, `wow-run-week.ts`'s `classifyRunWeek` (basic classification, half-open boundary equality, winter/summer, and both DST transitions — with an explicit test proving the CURRENT→NEXT gap is *not* a fixed 168 UTC hours across a transition), `embeds/signup-embed.ts`, `embeds/roster-embed.ts`, `bot-api-client.ts` (mocked `fetch`, including `listSyncWork`'s `channels[]`), `env.ts`'s `loadBotEnv` (CURRENT/NEXT/ARCHIVE resolution, the deprecated `DISCORD_RUN_CATEGORY_ID` fallback, and that NEXT never inherits it), `interactions/error-copy.ts`, `interactions/signup-flow.ts`'s `buildSelectOptions`/`parseSelectedOffers`, `commands/mysignups.ts`'s `formatMySignups`, and `channel-reconciliation.ts`'s `reconcileExistingRunChannel`/`reconcileChannels` (CURRENT/NEXT/ARCHIVE moves and no-ops, rename, missing-category per bucket, missing-channel, failure-isolation — all against a fake `ReconcilableChannel`, no discord.js or live token needed).
- Bot API routes: tested by calling the exported Route Handler functions directly with constructed `NextRequest`s (`src/app/api/bot/bot-routes.test.ts`), including a contract test asserting `GET /api/bot/discord/sync` exposes `channels` alongside `signups`/`roster`, each carrying `targetBucket` — no live Discord credentials required.
- `discord-sync.service.ts`: tested against the real dev database like every other Service, including channel provisioning/idempotency/rename, the independent `channels` lane, and weekly target resolution with an injectable `now` — CURRENT/NEXT eligible for first provisioning, PAST/FUTURE blocked, app archival overriding week classification, and a same-Run rollover test (NEXT → CURRENT across two `listSyncWork` calls with no Run mutation in between) (`src/services/discord-sync.service.test.ts`).
- The discord.js Client wiring itself (`client.ts`, `sync-loop.ts`'s actual channel fetch/create/message send/edit calls, `register-commands.ts`) cannot be unit-tested without a live bot token — it was verified structurally (typecheck, production build, and a boot smoke test against Discord's own token validation) rather than end-to-end. `sync-loop.ts` is kept as thin as possible specifically so the real reconciliation *logic* lives in the unit-tested `channel-reconciliation.ts` instead.

## Deferred

Selection/roster-published notifications, `/runs` browse command, Discord-side Raid Lead/Admin actions (roster selection and Strike management stay Web-only), Discord role synchronization, preferred/ranked Character offers, chronological channel ordering within the category, Run type/progress channel-name segments (no domain field to source them from yet), Dawn Boosting integration of any kind.
