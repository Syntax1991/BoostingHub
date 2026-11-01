# BoostingHub API reference

Every HTTP route and Server Action that exists in the code, how each is authenticated, and how errors are returned. Nothing here is planned; if it is not in `src/app/**/route.ts` or `src/controllers/*.actions.ts`, it does not exist.

BoostingHub has no public API. The HTTP surface serves Better Auth, the Battle.net connection, one manager download and the Discord bot. The web UI itself uses Server Actions.

## Contents

- [Overview](#overview)
- [Authentication and authorization](#authentication-and-authorization)
- [Error handling](#error-handling)
- [Better Auth routes](#better-auth-routes)
- [Battle.net integration routes](#battlenet-integration-routes)
- [Archive transcript download](#archive-transcript-download)
- [Discord bot API](#discord-bot-api)
  - [Conventions](#conventions)
  - [Per-User routes](#per-user-routes)
  - [System routes](#system-routes)
  - [PUT discord-state](#put-discord-state)
  - [GET discord/sync](#get-discordsync)
- [Webhooks](#webhooks)
- [Server Actions](#server-actions)
- [External integrations](#external-integrations)

## Overview

| Surface | Base | Authentication | Consumer |
| --- | --- | --- | --- |
| Better Auth | `/api/auth/*` | Better Auth | Browser |
| Battle.net | `/api/integrations/battlenet/*` | Session | Browser redirect |
| Archive transcript | `/runs/:runId/archive-transcript` | Session and Run management right | Manager's browser |
| Bot API | `/api/bot/*` | Service token, plus a Discord user id on per-User routes | Discord bot process |
| Server Actions | `src/controllers/*.actions.ts` | Session | Web UI |

## Authentication and authorization

**Web.** Better Auth holds the session. `src/proxy.ts` redirects signed-out browsers based on cookie presence, which is only a convenience. Controllers call `requireUser()`, `requireAdmin()`, `requireManagerOrRedirect()` and related helpers (`src/auth/`), and Services re-check authorization (for example `assertCanManageRun`). Role details: [Authentication and authorization](DEVELOPER.md#authentication-and-authorization).

**Bot service.** `assertBotServiceAuthorized` requires `Authorization: Bearer <BOOSTINGHUB_BOT_API_TOKEN>`, compared in constant time.

| Case | Status | Code |
| --- | --- | --- |
| Token not configured on the server | 503 | `NOT_AUTHORIZED` |
| Token missing or wrong | 401 | `NOT_AUTHORIZED` |

The token only opens the bot surface. It never grants a domain role.

**Bot acting User.** Per-User routes also read `x-discord-user-id`, the Discord id of the member who triggered the interaction. `resolveActingDiscordUser` maps it through `User.discordUserId`. A `userId` in a request body is never read.

| Case | Status | Code |
| --- | --- | --- |
| Header missing | 401 | `NOT_AUTHENTICATED` |
| No BoostingHub account for that id | 404 | `DISCORD_ACCOUNT_NOT_LINKED` |
| Account disabled | 403 | `ACCOUNT_DISABLED` |

The call then runs the same Service and the same per-User rules as the web.

## Error handling

Bot API envelope (`src/lib/bot-api-result.ts`):

```json
{ "ok": true, "data": {} }
```

```json
{ "ok": false, "code": "SOME_CODE", "message": "Readable text." }
```

| Error | Status | Code |
| --- | --- | --- |
| `DomainError` | The error's own status | The error's own code |
| Zod validation | 400 | `VALIDATION_FAILED` |
| Anything else | 500 | `UNEXPECTED` |

All domain codes are defined in `src/lib/errors.ts`. Server Actions never throw to the client; they return `ActionResult` (`src/lib/action-result.ts`):

```ts
type ActionResult =
  | { ok: true; message: string; runId?: string }
  | { ok: false; code: string; message: string /* plus optional details such as pendingWarnings */ };
```

`ROSTER_WARNING_CONFIRMATION_REQUIRED` carries `pendingWarnings`, so the UI can re-prompt with the current state. See [Selection risk](DEVELOPER.md#selection-risk-clean--warning--blocked).

## Better Auth routes

`GET` and `POST /api/auth/*` are delegated to Better Auth (`toNextJsHandler(auth)`, configured in `src/auth/auth.ts`). The route set belongs to the library. BoostingHub relies on:

- Discord OAuth with the callback `/api/auth/callback/discord`, enabled when `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are set
- Email and password for seeded credential accounts, outside production only and when `DEV_AUTH_ENABLED=true`
- Sessions, whose listing and revocation are exposed through `session.actions.ts`

## Battle.net integration routes

Both routes require a signed-in session and answer with redirects, not JSON.

| Route | Input | Result |
| --- | --- | --- |
| `GET /api/integrations/battlenet/connect` | Query `region=EU\|US` | Sets the state cookie and redirects to Battle.net |
| `GET /api/integrations/battlenet/callback` | Query `code`, `state` or `error` from Battle.net | Validates state, exchanges the code, upserts the connection, opens an import session, auto-links exact matches, clears the cookie, then redirects to `/characters` |

The callback adds `battlenet=connected` or `battlenet=error` with `code=<DOMAIN_CODE>` (for example `BATTLENET_ACCOUNT_PROFILE_FORBIDDEN`) to the `/characters` URL. A signed-out user is redirected to login with `next=/characters`. User OAuth tokens are never stored.

## Archive transcript download

`GET /runs/:runId/archive-transcript` (route handler in `src/app/(app)/runs/[runId]/archive-transcript/route.ts`).

- Requires a session and `canManageRun`. Anyone else gets `404 NOT_FOUND`, so the existence of a Run is not revealed.
- Success: `200` with the stored HTML, `content-type: text/html; charset=utf-8`, `content-disposition: attachment`, `cache-control: private, no-store`.
- Errors: JSON `{ ok: false, code, message }`, also `404` when no transcript exists yet.

## Discord bot API

The separate bot process (`src/discord-bot/`) reaches BoostingHub only through these routes, with `src/discord-bot/bot-api-client.ts`. Bot design: [Discord bot](DEVELOPER.md#discord-bot).

### Conventions

- `:runId` always comes from the URL, never from the body.
- `snowflake` means a Discord id string. Most routes use `^\d{15,25}$`; `voice-presence` accepts `^\d{5,25}$`.
- Every handler: authenticate the service, resolve the acting User if needed, validate with Zod, call a Service, map the result. No Repository access in a handler.
- `data` shapes below name the source DTO when it is large. The TypeScript type of the named Service method is the contract.

### Per-User routes

Require the service token and `x-discord-user-id`.

| Route | Request | `data` |
| --- | --- | --- |
| `GET /api/bot/my-signups` | none | `signupService.getMyRuns` (backs `/mysignups`) |
| `GET /api/bot/runs/:runId/signup-options` | none | `signupService.getSignupOptions`: eligible Characters, active Booster offers and Lootbuddies |
| `PUT /api/bot/runs/:runId/signup` | `{ offers: [{ characterId, offeredRoles[] }] }`, max 50. The complete desired Booster set | `signupService.setCharacterOffers` result |
| `POST /api/bot/runs/:runId/signup/quick` | none | `QuickSignupBoostersResult`: `added`, `alreadySigned`, `skippedNoDefaultRole`, `skippedUnavailable`, `skippedReservationConflict`, `skippedInactive`, `skippedIneligible` |
| `POST /api/bot/runs/:runId/signup/cancel` | Optional `{ reason?: string \| null }`, max 2000 | `signupService.withdrawFromRun` result. A picked User without a reason gets `WITHDRAW_REASON_REQUIRED` and nothing is written |
| `GET /api/bot/runs/:runId/signup/note` | none | `signupService.getRunNote` |
| `PUT /api/bot/runs/:runId/signup/note` | `{ note: string \| null }`, max 2000; blank clears | `signupService.setRunNote` |
| `PUT /api/bot/runs/:runId/lootbuddies` | `{ lootbuddies: [{ signupId?, wowClass, mode, verification? }] }`, max 20. The complete desired set | `signupService.setLootbuddies` result |
| `POST /api/bot/runs/:runId/archive` | none | `runService.archiveRun`: same rules as the app (Raid Lead of the Run or Admin, COMPLETED or CANCELLED, not twice) |

### System routes

Require the service token only.

| Route | Request | `data` and purpose |
| --- | --- | --- |
| `GET /api/bot/discord/sync` | Header `x-class-emoji-fingerprint` or query `classEmojiFingerprint`, optional | All pending Discord work; see [GET discord/sync](#get-discordsync) |
| `PUT /api/bot/discord/schedule-state` | `{ bucket: CURRENT\|NEXT, channelId, messageId, signature }` | `{ ok: true }`. Records the persistent Schedule message |
| `POST /api/bot/discord/member-names` | none | One bounded player-name refresh pass (`discordMemberNameSyncService.runDuePass`) |
| `POST /api/bot/discord/voice-presence` | `{ runs: [{ runId, channelId, discordUserIds[] }] }`, max 50 Runs, members capped by `VOICE_PRESENCE_MAX_MEMBERS` | Reports who is in each running Run's voice channel; kept in memory only |
| `GET /api/bot/discord/global-announcements/:key` | Key `^[a-z0-9][a-z0-9._-]{0,127}$` (case-insensitive) | `{ recorded: false }` or `{ recorded: true, key, channelId, messageId }` |
| `PUT /api/bot/discord/global-announcements/:key` | `{ channelId, messageId }` | Records a sent one-time announcement; idempotent per key |
| `GET /api/bot/notifications/:notificationId/delivery-authority` | none | Fresh DM deliverability, checked right before sending |
| `PUT /api/bot/notifications/:notificationId/delivery` | `{ result: SENT\|FAILED_PERMANENT }` | `{ recorded: boolean }`. Account-level notifications; compare-and-set on `PENDING` |
| `GET /api/bot/run-announcements/:announcementId/delivery-authority` | none | Fresh channel-post deliverability, checked right before sending |
| `GET /api/bot/runs/:runId/roster` | none | Roster embed DTO (draft or published lineup), or `404 NOT_FOUND` |
| `GET /api/bot/runs/:runId/start` | none | Final Setup DTO, or `404 NOT_FOUND` before Start |
| `GET /api/bot/runs/:runId/discord-retirement` | none | `{ retire: boolean }`. Checked right before an irreversible channel delete; only a live `archivedAt` returns true |
| `PUT /api/bot/runs/:runId/discord-state` | Discriminated union; see [PUT discord-state](#put-discord-state) | `{ recorded: true }` |
| `POST /api/bot/runs/:runId/warcraft-logs` | `{ reportCode, channelId, messageId, authorId }` | `runWarcraftLogsService.attachFromDiscord`. Re-checks allowlist, channel and Run status. Idempotent |
| `POST /api/bot/warcraft-logs/discoveries` | `{ channelId, messageId, authorId, reportCode }` | Records a report found in a dedicated log channel. Idempotent per message and report |
| `PUT /api/bot/warcraft-logs/channels/:channelId/cursor` | `{ messageId }` | `{ ok: true }`. Forward-only, configured channels only |
| `POST /api/bot/warcraft-logs/auto-audit` | none | `{ discovery, audit }`. One bounded discovery pass, then one audit pass, each behind its own advisory lock |

`reportCode` must match `WARCRAFT_LOGS_REPORT_CODE` (`src/lib/warcraft-logs`).

### PUT discord-state

`PUT /api/bot/runs/:runId/discord-state`. The `kind` values are a stable wire contract. This is bookkeeping of Discord identity, never authoritative Run or signup state.

| `kind` | Other fields | Effect |
| --- | --- | --- |
| `channel` | `channelId` | Records the Run's text channel |
| `clear-channel` | none | Drops `runChannelId`, unguarded; no longer used for retirement |
| `channel-gone` | `channelId` | Compare-and-set clear of everything held by that deleted channel |
| `voice-channel` | `channelId` | Records the Run's voice channel |
| `clear-voice-channel` | `channelId` | Clears it only while it still equals that id |
| `signup` | `channelId`, `messageId`, optional `classEmojiFingerprint` | Records the signup message |
| `roster` | `channelId`, `messageId`, optional `postRevision`, `classEmojiFingerprint` | Records the roster message; `postRevision` acknowledges an explicit Publish |
| `start` | `channelId`, `messageId`, optional `voiceChannelId` | Records the Final Setup post |
| `archive-artifacts` | `closeMessageId`, `transcriptMessageId`, `transcriptHtml` (max 5 MB), `transcriptFilename` | Stores archive message ids and the transcript |
| `raid-invite` | `signupId` | Appends to the legacy invite list |
| `wcl-scan-cursor` | `channelId`, `messageId` | Advances the Run channel's scan cursor, forward only |
| `notification-dm` | `notificationId`, `result: SENT\|FAILED_PERMANENT` | Records a Run notification's DM outcome |
| `run-announcement` | `announcementId`, `result: SENT\|SKIPPED\|FAILED_PERMANENT` | Records a channel announcement's outcome |

### GET discord/sync

`discordSyncService.listSyncWork` decides what changed, and the bot acts on it. Item types are exported from `src/services/discord-sync.service.ts`.

| Field | Content |
| --- | --- |
| `channels` | Every Run with a stored channel: desired name, target bucket, retirement flag |
| `voiceChannels` | Voice channel create, keep and cleanup work |
| `signups` | Signup posts to create or refresh, each with its `embed` DTO |
| `roster` | Roster posts, mode `POST` or `REFRESH` |
| `start` | Final Setup posts |
| `raidInvites` | Always empty; legacy field. Invites come through `notificationDms` |
| `notificationDms` | Pending Run DMs that are due |
| `accountNotificationDms` | Pending account-level DMs |
| `runAnnouncements` | Pending channel announcements, oldest first |
| `warcraftLogsReportAuthorIds` | Trusted log bot ids |
| `warcraftLogsReportChannels` | Dedicated log channels with their cursors |
| `schedules` | The two persistent Schedule posts (`CURRENT`, `NEXT`) |

## Webhooks

BoostingHub exposes **no inbound webhook endpoint**, and Discord interactions reach the bot over its gateway connection, not over HTTP. The only webhook involved is an external one: a log tool may post Warcraft Logs links into a Discord channel through a Discord webhook, and the bot reads that channel over Discord's REST API. It is trusted by author id (`DISCORD_WCL_REPORT_AUTHOR_IDS`).

## Server Actions

All live in `src/controllers/`. Each validates with Zod, calls a Service and returns `ActionResult` or a result extending it. **Entry check** is what the controller does before the Service; the Service enforces the finer rule (for example `canManageRun`). The input schemas are in `src/validators/`, named after the feature.

| File | Entry check | Actions | Service rule |
| --- | --- | --- | --- |
| `auth.actions.ts` | none | `signInWithDevIdentity`, `signOutAction` | Dev identity is refused in production |
| `session.actions.ts` | In the Service | `revokeSessionAction`, `revokeOtherSessionsAction`, `revokeAllSessionsAction` | Own sessions |
| `settings.actions.ts` | User | `updateNotificationSettingsAction`, `updateRegionalSettingsAction`, `updateGameplaySettingsAction` | Own settings |
| `notification.actions.ts` | User | `markNotificationReadAction`, `markAllNotificationsReadAction` | Own notifications |
| `character.actions.ts` | User | `lookupCharacterFromRaiderIoAction`, `lookupCharactersFromRaiderIoAction`, `createCharacterAction`, `createCharactersAction`, `updateCharacterAction`, `deactivateCharacterAction`, `reactivateCharacterAction`, `deleteCharacterAction` | Owner |
| `character-weekly-availability.actions.ts` | User | `setCharacterCurrentResetAvailabilityAction` | Owner |
| `blizzard.actions.ts` | User | `disconnectBattleNetAction`, `importBattleNetCharactersAction`, `linkBattleNetCharacterAction`, `refreshBlizzardCharacterAction`, `refreshAllBattleNetCharactersAction`, `enrichImportCandidateAction`, `loadImportSessionAction` | Owner; 60 s refresh cooldown |
| `warcraft-logs.actions.ts` | User | `linkWarcraftLogsCharacterAction`, `linkMissingWarcraftLogsCharactersAction` | Owner |
| `signup.actions.ts` | User | `getSignupOptionsAction`, `createBoosterSignupAction`, `setCharacterOffersAction`, `setLootbuddiesAction`, `cancelBoosterSignupAction`, `withdrawPickedSignupAction`, `withdrawSignupAction` | Own signups; eligibility rules |
| `run.actions.ts` | User | `createManyRunsAction`, `updateRunAction`, `openRunAction`, `closeRunSignupsAction`, `reopenRunSignupsAction`, `cancelRunAction`, `reactivateRunAction`, `startRunAction`, `completeRunAction`, `archiveRunAction`, `restoreRunAction`, `deleteRunAction` | Manager of the Run; delete is ADMIN / OWNER on an unused draft |
| `roster.actions.ts` | User | `saveRosterDraftAction`, `prepareRosterEditAction`, `validateRosterAction`, `publishRosterAction`, `updateRosterAction`, `repostRosterAction`, `saveExternalBoostersAction`, `searchRosterPlayersAction`, `getRosterManualAddOptionsAction`, `addRosterPlayerAction`, `proposeRosterBuilderAction`, `applyRosterBuilderAction`, `syncRosterCharactersAction`, `requestLateFillHelpAction`, `getPingRolesDialogDataAction`, `requestCustomPingAction` | Manager of the Run |
| `attendance.actions.ts` | User | `setAttendanceAction`, `replaceParticipantAction`, `markAllPresentAction`, `correctAttendanceAction` | Manager of the Run |
| `run-consumable-audit.actions.ts` | User | `attachRunWarcraftLogsReportAction`, `rescanRunWarcraftLogsAction`, `detachRunWarcraftLogsReportAction`, `decideRunWarcraftLogsFightAction`, `analyzeRunConsumablesAction` | ADMIN / the Run's RAID_LEAD; 60 s cooldown |
| `strike.actions.ts` | User | `addStrikeAction`, `revokeStrikeAction` | See [Strikes authorization](DEVELOPER.md#strikes-authorization) |
| `run-template.actions.ts` | User | `createRunTemplateAction`, `updateRunTemplateAction`, `deactivateRunTemplateAction`, `reactivateRunTemplateAction` | ADMIN / OWNER |
| `community-schedule.actions.ts` | User | `createCommunityScheduleSlotAction`, `createCommunitySchedulePlanAction`, `addCommunityScheduleTimesAction`, `updateCommunityScheduleSlotAction`, `deactivateCommunityScheduleSlotAction`, `reactivateCommunityScheduleSlotAction`, `deleteCommunityScheduleSlotAction`, `createCommunityScheduleRunSetupAction`, `updateCommunityScheduleRunSetupAction`, `duplicateCommunityScheduleRunSetupAction`, `deleteCommunityScheduleRunSetupAction`, `materializeCommunityScheduleOccurrenceAction`, `listScheduleAttachCandidatesAction`, `listScheduleAdoptionCandidatesAction`, `attachScheduleRunAction` | Mutations ADMIN / OWNER; RAID_LEAD reads |
| `booster-access.actions.ts` | User / Admin | `requestBoosterAccessAction` (self-service is disabled and refused), `approveBoosterAccessAction`, `rejectBoosterAccessAction` | ADMIN / OWNER review legacy requests |
| `boosting-role.actions.ts` | Admin | `setBoostingRoleAction` | ADMIN / OWNER |
| `user-management.actions.ts` | Admin | `changeAccountRoleAction` | Owner protection, last-admin and active-Run guards |
| `character-operations.actions.ts` | Admin | `adminSyncCharacterAction`, `adminForceRefreshCharacterAction`, `adminForceRefreshAllAction`, `adminDeleteCharacterAction`, `adminReconcileBattleNetLinksAction` | ADMIN / OWNER; bulk has a 10-minute cooldown |
| `raid-catalog.actions.ts` | Admin | `previewRaidImportAction`, `importRaidAction`, `previewSeasonImportAction`, `importSeasonAction`, `previewRaidRefreshAction`, `refreshRaidFromBlizzardAction`, `updateRaidAction`, `retryWclDetectionAction`, `clearWclMappingAction`, `deleteRaidAction`, `archiveRaidAction`, `restoreRaidAction`, `removeDuplicateRaidAction`, `createEncounterAction`, `updateEncounterAction`, `moveEncounterAction`, `deleteEncounterAction`, `createProductAction`, `updateProductAction`, `setProductActiveAction`, `setProductSelectableAction`, `deleteProductAction` | ADMIN / OWNER |
| `system-health.actions.ts` | Admin | `adminSystemForceRefreshAllAction`, `adminSystemWclAutoAuditPassAction` | ADMIN / OWNER |

## External integrations

| Service | Direction | Used for | Authentication | Code |
| --- | --- | --- | --- | --- |
| Discord OAuth | Outbound redirect | Login | `DISCORD_CLIENT_*` | `src/auth/auth.ts` |
| Discord REST, gateway | Outbound | Bot, role and name lookups, channel history | `DISCORD_BOT_TOKEN` | `src/discord-bot/`, `src/services/discord-*.service.ts` |
| Blizzard OAuth, Profile, Game Data | Outbound | Account linking, Character lookup and sync, journal import | `BLIZZARD_*`; user tokens are dropped after the callback, app tokens are cached in memory | `src/integrations/blizzard/` |
| Warcraft Logs v2 GraphQL | Outbound | Character identity, rankings, report fights and events | `WARCRAFT_LOGS_*` client credentials | `src/integrations/warcraft-logs/` |
| Raider.IO | Outbound | Optional item level raise; profile links are only parsed | Optional `RAIDER_IO_ACCESS_KEY` | `src/integrations/raider-io/` |

Socket and consumable game data are checked into the repository and need no call at runtime; `scripts/generate-wow-item-sockets.mjs` refreshes them manually.
