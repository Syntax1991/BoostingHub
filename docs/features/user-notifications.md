# User notifications

## Purpose

In-app (web) notifications and optional Discord DMs for two events:

| Type | When created | Web | Discord DM |
| --- | --- | --- | --- |
| `ROSTER_SELECTED` | Roster **publish** for **newly** SELECTED signups only | Always | If `dmRosterSelectedEnabled` and linked Discord at creation |
| `RAID_INVITE` | **Start Run** for each SELECTED signup | Always | If `dmRaidInviteEnabled` and linked Discord at creation |

There is **no historical backfill**. Draft roster selection never notifies. Republish dedupes via deterministic `sourceKey`.

## Preferences

Stored on `User`:

- `dmRosterSelectedEnabled` (default `true`)
- `dmRaidInviteEnabled` (default `true`)

Preferences are **independent**. In-app notifications cannot be disabled. Discord preference is **snapshotted** into `UserNotification.discordDeliveryStatus` / `discordUserId` at creation — later preference changes do not rewrite existing rows.

## Idempotency (`sourceKey`)

- Roster pick: `roster-selected:<runId>:<publishedVersion>:<signupId>`
- Raid invite: `raid-invite:<runId>:<signupId>`

Duplicate creates are ignored (`createInTx` / unique `sourceKey`).

## Publish vs Start boundaries

- **Publish**: creates `ROSTER_SELECTED` only for signups that were not already SELECTED before this publish (newly selected). Does **not** send Raid Invite.
- **Start Run**: creates `RAID_INVITE` for every SELECTED signup once the run becomes `IN_PROGRESS`. Does **not** re-create roster-selected rows.

## Discord delivery states

| Status | Meaning |
| --- | --- |
| `PENDING` | Preference on + Discord linked at creation; bot should DM |
| `SKIPPED` | Preference off or no Discord id at creation; never returned as sync work |
| `SENT` | Bot delivered successfully |
| `FAILED_PERMANENT` | Cannot DM (closed DMs / permission); no retry |

Transient Discord errors leave the row `PENDING` for a later poll. `SKIPPED` / `SENT` / `FAILED_PERMANENT` are never returned as bot work.

## Bot delivery

`discordSyncService.listSyncWork` exposes `notificationDms` from pending `UserNotification` rows (both types). Legacy `raidInvites` is always `[]` so the old SELECTED + `raidInviteSentSignupIds` loop cannot double-send. On successful RAID_INVITE DM, the bot also appends legacy `raidInviteSentSignupIds` for continuity.

Delivery result is recorded via `PUT /api/bot/runs/:runId/discord-state` with `kind: "notification-dm"`.

## Surfaces

- Header bell (latest 5 + unread count) → `/notifications`
- Profile → Discord DM toggles
- Controllers: `notification.actions.ts` / `notificationController`
- Service: `notification.service.ts` → `userNotificationRepository`
