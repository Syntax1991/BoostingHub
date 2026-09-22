# User settings and notifications

## Purpose

BoostingHub separates **Profile** (identity / account operations) from **Settings**
(user-controlled application preferences).

Settings sections:

1. **Notifications** — Discord DM delivery preferences (in-app is always on)
2. **Regional** — personal IANA timezone
3. **Gameplay** — Default Character preference for signup UX
4. **Active sessions** — list and revoke signed-in devices (via Prisma; revoke via Better Auth)

| Type | When created | Web | Discord DM |
| --- | --- | --- | --- |
| `ROSTER_SELECTED` | Roster **publish** for **newly** SELECTED signups only | Always | Master + `dmRosterSelectedEnabled` + Discord linked |
| `RAID_INVITE` | **Start Run** for each SELECTED signup | Always | Master + `dmRaidInviteEnabled` + Discord linked |
| `RUN_CANCELLED` | Run → `CANCELLED` for Users with PENDING/SELECTED | Always | Master + `dmRunCancelledEnabled` + Discord linked |
| `RUN_RESCHEDULED` | `scheduledStartAt` actually changes | Always | Master + `dmRunRescheduledEnabled` + Discord linked |
| `ROSTER_REMOVED` | Publish: previous SELECTED → NOT_SELECTED | Always | Master + `dmRosterRemovedEnabled` + Discord linked |

There is **no historical backfill**. Draft roster selection never notifies.
Republish dedupes via deterministic `sourceKey`.

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
