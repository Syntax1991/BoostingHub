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
| `GET /api/bot/discord/sync` | What needs a Discord post created or refreshed |
| `GET /api/bot/runs/:runId/signup-options` | Eligible Characters + current offers for the acting Discord User |
| `PUT /api/bot/runs/:runId/signup` | `setCharacterOffers` over HTTP |
| `POST /api/bot/runs/:runId/signup/cancel` | `cancelActiveOffers` over HTTP |
| `GET /api/bot/my-signups` | Backs `/mysignups` |
| `GET /api/bot/runs/:runId/roster` | Discord-ready final roster DTO |
| `PUT /api/bot/runs/:runId/discord-state` | Records a posted message's channel/message id |

Every handler: authenticate the bot service → resolve the acting Discord User (only for per-User routes) → validate with Zod → call the Service → map the domain result/error to JSON. No Repository use in a Route Handler.

## Security

- **Bot service identity**: `BOOSTINGHUB_BOT_API_TOKEN`, a high-entropy shared secret compared with `crypto.timingSafeEqual` (`src/auth/bot-auth.ts`). Grants access to the bot API surface only — never an ADMIN/RAID_LEAD bypass. Never an ADMIN session cookie, Discord OAuth login token, or Battle.net token.
- **Acting User identity**: `User.discordUserId` — the immutable Discord snowflake, never `discordUsername` or a display name. The bot forwards `interaction.user.id` (already authenticated by Discord's own interaction signature before the bot's code ever saw it) as the `x-discord-user-id` header; a request with no header or an unlinked id is rejected (`NOT_AUTHENTICATED` / `NOT_FOUND`). A client-supplied `userId` in a request body is never read — every Bot API schema omits that field entirely, so it is silently dropped even if a malicious caller includes one.
- Every mutation still runs full normal per-User authorization (`Character` ownership, `BoosterQualification`, signup window) — bot service auth only gets a request past the door.

## Sync architecture

Run/Signup/Roster state never depends synchronously on Discord. `discordSyncService.listSyncWork()` (`src/services/discord-sync.service.ts`) is the single place that decides "something changed":

- **Signup embed**: a cheap signature (`uniqueSignupCount:signupWindowOpen:runStatus`) is compared against `RunDiscordPost.lastSignupSignature`. DRAFT runs are never candidates.
- **Roster embed**: `RunRoster.version` is compared against `RunDiscordPost.lastRosterVersion`; only runs with a published roster are candidates.

`RunDiscordPost` (one additive migration, `20260910T2332_discord_integration_state`) is small, presentation-only integration state — the channel/message id the bot already posted, so a restart edits the existing message instead of reposting. It is never a second source of truth for Run/Signup/Roster data.

The bot's `sync-loop.ts` polls `GET /api/bot/discord/sync` on an interval (`DISCORD_SYNC_INTERVAL_MS`, default 60s), edits an existing message when `existingChannelId`/`existingMessageId` are present (falling back to a fresh post if that message was deleted out-of-band), and records the result via `PUT /api/bot/runs/:runId/discord-state`. A failed pass is logged and retried on the next tick — it never throws the process down or blocks a BoostingHub Run transition.

## Signup embed

Posted to `DISCORD_SIGNUP_CHANNEL_ID` once a Run leaves `DRAFT`. Content only — Run title, difficulty, raid, scheduled time, **unique signup count**, and status; it never lists any User's offered Characters (that stays in the ephemeral per-User reply). "Signups: 39" means 39 distinct Users with an active offer, never 39 `RunSignup` rows — a User offering three Characters still counts once.

Buttons: **Signup** (Primary), **Sign as Lootbuddy** (Secondary), **Cancel Signup** (Danger). Signup/Lootbuddy disable once the signup window closes; Cancel stays enabled (a User may still remove a still-pending offer after the window closes, matching the Web withdraw rule). Custom ids (`src/discord-bot/custom-ids.ts`) carry only `action:runId` — never a User id — and are validated against the same id shape the server accepts before any network call is made.

### Signup / Lootbuddy button flow

1. `interaction.deferReply({ ephemeral: true })`.
2. `GET .../signup-options` for the acting Discord User.
3. If the window is closed or there are no eligible Characters, say so and stop.
4. Show an ephemeral multi-select (Discord max 25 options) preselecting the User's current active offers of that type; **role defaults server-side** to each Character's own specialization (an explicit non-default role stays a Web-only refinement for this MVP).
5. The select menu's own submission is the confirm step — no extra round trip. `PUT .../signup` with the selected `characterId`s.
6. Ephemeral confirmation, or the mapped domain error (`src/discord-bot/interactions/error-copy.ts` — concise copy for known codes, otherwise the server's own message verbatim; it never invents a new eligibility rule).

### Cancel Signup button

`POST .../signup/cancel` — withdraws the User's entire active offer-set atomically. A protected offer (currently roster-selected, or published-and-locked) rejects the whole cancellation with the server's own explanation.

## Final roster embed

Posted to `DISCORD_ROSTER_CHANNEL_ID` when a roster is first published, and **edited in place** (never reposted) whenever `RunRoster.version` advances on republish. Selected Characters only — never the full offer set.

Groups: Tanks, Healers, Melee DPS, Ranged DPS, and Lootbuddies (omitted when empty). Melee/ranged classification comes from `attackTypeForSpecialization` (`src/lib/wow-specializations.ts`) — the one authoritative (class, specialization) → attack-type table, so the bot never re-derives WoW class rules itself. Tank/Healer show a real target from the Run's desired counts; **melee/ranged DPS show a bare count with no denominator**, because `Run.desiredDpsCount` is one combined number with no melee/ranged split in the current schema — introducing a fake denominator was deliberately avoided rather than inventing new Run fields for cosmetics.

Each member renders as `<@discordUserId> — Character-Realm` when the User has a linked Discord account, or `Character-Realm` alone otherwise.

## `/mysignups`

The one slash command. Read-only, ephemeral, registered per-guild (`npm run bot:register-commands`). Groups the same flat per-Character rows `signupService.getMyRuns` returns into one line per Run + participation type — "Offered: A, B, C · Selected: B" — matching the Web My Runs presentation. There is no `/signup` command: the Run embed's buttons are the only signup entry point, so Web and Discord never maintain two independent flows.

## Deployment

- Next.js app: one process (existing deployment, unchanged).
- Discord bot: a second, independent long-lived Node process — it holds a persistent Gateway WebSocket, which does not fit a request-scoped Next.js process.
- Suggested host: Plesk with SSH, `systemd` managing the bot process — see [`deploy/discord-bot.service`](../../deploy/discord-bot.service) for a working example unit, or run `npm run bot:start` under any other process supervisor. Register slash commands once per deploy (or whenever the command list changes) with `npm run bot:register-commands` — the gateway process does not do this itself.
- Environment variables: see `.env.example` (`DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`, `DISCORD_SIGNUP_CHANNEL_ID`, `DISCORD_ROSTER_CHANNEL_ID`, `BOOSTINGHUB_API_BASE_URL`, `BOOSTINGHUB_BOT_API_TOKEN`). Secrets live only in the server environment, never in the repository.

## MVCS / testing

- Pure, fully unit-tested: `custom-ids.ts`, `format.ts`, `embeds/signup-embed.ts`, `embeds/roster-embed.ts`, `bot-api-client.ts` (mocked `fetch`), `interactions/error-copy.ts`, `commands/mysignups.ts`'s `formatMySignups`.
- Bot API routes: tested by calling the exported Route Handler functions directly with constructed `NextRequest`s (`src/app/api/bot/bot-routes.test.ts`) — no live Discord credentials required.
- `discord-sync.service.ts`: tested against the real dev database like every other Service (`src/services/discord-sync.service.test.ts`).
- The discord.js Client wiring itself (`client.ts`, `sync-loop.ts`'s actual message send/edit calls, `register-commands.ts`) cannot be unit-tested without a live bot token — it was verified structurally (typecheck, production build, and a boot smoke test against Discord's own token validation) rather than end-to-end.

## Deferred

Selection/roster-published notifications, `/runs` browse command, Discord-side Raid Lead/Admin actions (roster selection and Strike management stay Web-only), Discord role synchronization, preferred/ranked Character offers, Dawn Boosting integration of any kind.
