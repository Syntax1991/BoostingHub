# Domain model

Timestamps are stored as `timestamptz` (UTC). Formatting happens in `src/lib/datetime.ts`.

## Distinctions that must not collapse

| Concept | Meaning | Examples |
| --- | --- | --- |
| Account permission | What the account may do in the app | `USER`, `RAID_LEAD`, `ADMIN` |
| Booster eligibility | Granular approval to boost a combination | Shaman + Healer + Heroic |
| Run participation type | How this person is on **this** run | `BOOSTER`, `LOOTBUDDY` |
| Run status | Lifecycle of the operation | `OPEN`, `ROSTERING` |
| Signup status | Lifecycle of one signup row | `PENDING`, `SELECTED` |

A user is never permanently “the booster” or “the lootbuddy”. The same account can boost Run A and join Run B as a lootbuddy.

## User

Application account and Better Auth `user` row.

- `id`, `name` (display name), optional `email`
- Discord user id, username, avatar (`image`)
- `accountStatus`: `ACTIVE` \| `DISABLED`
- `accountRole`: `USER` \| `RAID_LEAD` \| `ADMIN`
- timestamps

Email is optional for core behavior. Discord is the primary identity.

## Character

Belongs to a user. Reads come from the live database for the current session. Create/edit is not implemented yet; seed supplies local QA characters. Blizzard character IDs are reserved for a later integration.

- name, realm, region (`EU` \| `US`)
- class, optional specialization, primary role (`TANK` \| `HEALER` \| `DPS`)
- item level, active flag
- optional Blizzard and Warcraft Logs identifiers (unused until later integrations)
- `lastSyncedAt` (null until a real sync exists)

## BoosterAccess

Normalized approval, not `isBooster` and not a JSON blob.

- user (required), optional character
- class, role, difficulty
- status: `PENDING` \| `APPROVED` \| `REVOKED`
- approved at / approved by / notes

Unique on `(userId, wowClass, role, difficulty)`. Heroic healer approval does not grant Mythic healer approval.

## Raid / RaidBoss

Reusable content. Seeded with Manaforge Omega for development. Blizzard raid ingestion is deferred.

## CharacterRaidLockout

Lockout is **not** `character.locked = true`.

It depends on character + raid + difficulty + `resetIdentifier` (ISO week, e.g. `2026-W37`).

Heroic and Mythic lockouts for the same raid week are independent.

## Run

- title, raid, difficulty, scheduled start (UTC)
- status, raid lead, notes
- desired tank / healer / DPS counts
- `signupsOpen`

Run statuses:

| Status | Meaning |
| --- | --- |
| `DRAFT` | Lead is preparing the run. Not an open signup. |
| `OPEN` | Signups may be accepted when `signupsOpen` is true. |
| `ROSTERING` | Lead is selecting. Signups may still be open or closed independently. |
| `PUBLISHED` | Roster is published. Signup window is expected closed. |
| `IN_PROGRESS` | The run is happening. |
| `COMPLETED` | Finished. |
| `CANCELLED` | Will not happen. |

## RunSignup

Participation on a specific run. The same user may offer multiple characters; duplicate rows are prevented per run + user + character + participation type. A withdrawn row keeps that unique key and can be revived.

- participation type: `BOOSTER` \| `LOOTBUDDY`
- character (required for new Phase 2 signups)
- booster role and `isBackup` (backup is not a status)
- lootbuddy `lootbuddyMode`: `LOOT_ONLY` \| `PLAYING`
- lootbuddy `lootbuddyVerification`: `NONE` \| `ACCESS` \| `TRIAL` (metadata, not an approval workflow)
- status: `PENDING` \| `SELECTED` \| `NOT_SELECTED` \| `WITHDRAWN`

Player-created signups start as `PENDING`. `SELECTED` / `NOT_SELECTED` remain roster outcomes.

Signup counts on run lists exclude `WITHDRAWN`.

See [docs/features/run-signups.md](features/run-signups.md).

## RunRoster / RunRosterEntry

One roster document per run. Draft selection lives in `RunRosterEntry` and is independent of `RunSignup.status` until Publish.

- `RunRoster.runId` unique
- `state`: `DRAFT` until first publish, then `PUBLISHED` (including while a replacement draft is edited)
- `version` for stale-write protection
- `publishedAt` / `publishedById` after a successful publish
- `RunRosterEntry` unique on `(rosterId, signupId)`; rows are currently selected draft members

One selected signup per user per run is enforced in `RosterService`, not as a database constraint.

See [docs/features/roster-management.md](features/roster-management.md).

## ActivityEvent

Development/operational activity feed for the dashboard. Not a KPI warehouse.
