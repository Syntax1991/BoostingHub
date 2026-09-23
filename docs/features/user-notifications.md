# User settings and notifications

## Purpose

BoostingHub separates **Profile** (identity / account operations) from **Settings**
(user-controlled application preferences).

Settings sections:

1. **Notifications** — Discord DM delivery preferences (in-app is always on)
2. **Regional** — personal IANA timezone
3. **Gameplay** — Default Character preference for signup UX
4. **Active sessions** — list and revoke signed-in devices (via Prisma; revoke via Better Auth)

| Type | When created | Web | Run channel | Discord DM |
| --- | --- | --- | --- | --- |
| `ROSTER_SELECTED` | Roster **publish** for **newly** SELECTED signups only | Always | — | Master + `dmRosterSelectedEnabled` + Discord linked |
| `RAID_INVITE` | **Start Run** for each SELECTED signup | Always | — | Master + `dmRaidInviteEnabled` + Discord linked |
| `RUN_CANCELLED` | Run → `CANCELLED` for Users with PENDING/SELECTED | Always | YES if dedicated channel exists (before retirement) | Master + `dmRunCancelledEnabled` + Discord linked |
| `RUN_RESCHEDULED` | `scheduledStartAt` actually changes | Always | YES if dedicated channel exists | Master + `dmRunRescheduledEnabled` + Discord linked |
| `ROSTER_REMOVED` | Publish: previous SELECTED → NOT_SELECTED | Always | — | Master + `dmRosterRemovedEnabled` + Discord linked |

**Run channel announcements** (`RunDiscordAnnouncement`) are shared Run communication.
They are **not** controlled by User DM preferences (`discordDmEnabled=false` does not
suppress the channel post). They use deterministic `sourceKey` values distinct from
UserNotification keys:

- Reschedule: `run-rescheduled:<runId>:<scheduleRevision>`
- Cancel: `run-cancelled:<runId>`

No historical backfill — only lifecycle events after deployment create rows.

## Settings ownership

Route: `/settings`

Sidebar: **Settings** (after Profile).

Only the authenticated owner may view or update their settings.

## Preferences

Stored on `User`:

- `discordDmEnabled` (default `true`) — master override; does not rewrite per-event toggles
- `dmRosterSelectedEnabled` / `dmRaidInviteEnabled` / `dmRunCancelledEnabled` /
  `dmRunRescheduledEnabled` / `dmRosterRemovedEnabled` (default `true`)
- `timeZone` (default `Europe/Berlin`) — personal presentation only
- `defaultCharacterId` (nullable) — signup UX preference only
- `discordRunChannelNickname` (nullable) — RAID_LEAD/ADMIN only; Discord Run
  channel Raid Lead segment. Null falls back to `User.name`. Does **not** change
  `Run.title` or web identity.

### Effective Discord DM rule

At creation:

`discordDmEnabled AND eventSpecificDmEnabled AND usable Discord identity`

→ `PENDING`, else `SKIPPED`. Snapshotted; never re-evaluated later.

## Quiet Hours

Not implemented in this phase. Future work would need timezone-aware deferred
delivery (`deliverAfter` / `nextAttemptAt`) and DST-safe scheduling.

## Idempotency (`sourceKey`)

- Roster pick: `roster-selected:<runId>:<publishedVersion>:<signupId>`
- Roster removed: `roster-removed:<runId>:<publishedVersion>:<signupId>`
- Raid invite: `raid-invite:<runId>:<signupId>`
- Run cancelled: `run-cancelled:<runId>:<userId>`
- Run rescheduled: `run-rescheduled:<runId>:<scheduleRevision>:<userId>`

`Run.scheduleRevision` increments only when `scheduledStartAt` changes.

## Community timezone authority

User timezone must **not** alter:

- generated `Run.title`
- Discord channel names
- raid-ID week boundaries / CURRENT/NEXT classification

Shared Discord channel posts prefer Discord native timestamps (`<t:UNIX:F>`)
where appropriate. Personal DMs also prefer native timestamps.

## Default Character

Preference only. Never bypasses Booster Access, qualifications, difficulty,
weekly availability, lockouts, cross-run reservations, role validity, or active
state. Existing active signup state wins over the preference. Never auto-submits.

## Surfaces

- Header bell (latest 5 + unread count) → `/notifications`
- Settings → Notifications / Regional / Gameplay / Active sessions
- Controllers: `settings.actions.ts`, `notification.actions.ts`, `session.actions.ts`
- Services: `settingsService`, `notificationService`, `runLifecycleNotificationService`, `sessionManagementService`
