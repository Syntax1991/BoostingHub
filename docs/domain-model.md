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

## BattleNetConnection

Optional regional Battle.net link for a BoostingHub user. Unique on `(userId, region)` (`EU` \| `US`).

Stores Battle.net account id, optional BattleTag, scope metadata, `connectedAt`, and `lastSuccessfulSyncAt`. User OAuth tokens are **never** persisted here. Discord remains login; this is a secondary game-account connection. See [blizzard-integration.md](features/blizzard-integration.md).

## BattleNetImportSession

Short-lived (~15 min) owned-character snapshot after OAuth. Holds JSON character candidates for import/link selection. Stores no tokens. Clients may only select ids present in this snapshot.

## Character

Belongs to one user. Operators may create characters manually or import/link them from Battle.net. The same Character row is used either way.

- display `name`, `realm`, `region` (`EU` \| `US`)
- `normalizedName` / `normalizedRealm` for owner-scoped case-insensitive uniqueness with region
- unique on `(userId, region, normalizedRealm, normalizedName)`
- class, specialization, primary role (`TANK` \| `HEALER` \| `DPS`)
- item level (manual, or from Blizzard `equipped_item_level` when linked/refreshed)
- `isActive` lifecycle (deactivate instead of delete)
- optional scoped Blizzard identity: `blizzardCharacterId` + `blizzardRealmId` with `region`; unique on `(region, blizzardRealmId, blizzardCharacterId)` when set
- optional Warcraft Logs identifier (unused until later integration)
- `lastSyncedAt` set after a successful Blizzard profile sync

Class is immutable after creation. Specialization from Blizzard is import-time prefill only; afterward it stays BoostingHub-owned. `primaryRole` is derived from specialization; BoosterAccess may approve additional roles. Disconnecting Battle.net does not delete Characters. See [character-management.md](features/character-management.md) and [blizzard-integration.md](features/blizzard-integration.md).

## BoosterAccess

Normalized **account-level** approval, not `isBooster` and not a JSON blob. See [booster-access-management.md](features/booster-access-management.md).

- user (required), optional requesting character (context only)
- class, role, difficulty
- status: `PENDING` \| `APPROVED` \| `REJECTED` \| `REVOKED`
- approved at / approved by (set while approved; last approval kept after revoke)
- reviewed at / reviewed by (last admin decision)
- notes: optional owner-visible reject/revoke reason

Unique on `(userId, wowClass, role, difficulty)`. `characterId` is not part of uniqueness. Characters consume matching approvals; they do not own the row. Heroic healer approval does not grant Mythic or Normal healer approval. One row is reused across the lifecycle; rejection does not delete the row.

## Raid / RaidBoss

Reusable **reference content**, not demo users or demo Runs. Catalog: `src/lib/wow-raid-catalog.ts`. `raidRepository.ensureReferenceRaids()` upserts it idempotently (seed and Run create/edit). Dev seed still adds fixture Runs around that content. Blizzard raid ingestion is deferred.

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

`signupsOpen` is independent of status. Run Management creates drafts, opens runs, toggles the signup window, and cancels. Roster Management owns `OPEN → ROSTERING` and publish to `PUBLISHED`. Start/complete owns `PUBLISHED → IN_PROGRESS → COMPLETED`. `DRAFT` is management-only; ordinary users do not discover it. See [run-management.md](features/run-management.md) and [run-lifecycle-attendance.md](features/run-lifecycle-attendance.md).

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

See [docs/features/run-signups.md](features/run-signups.md) and [docs/features/run-detail.md](features/run-detail.md).

## RunRoster / RunRosterEntry

One roster document per run. Draft selection lives in `RunRosterEntry` and is independent of `RunSignup.status` until Publish.

- `RunRoster.runId` unique
- `state`: `DRAFT` until first publish, then `PUBLISHED` (including while a replacement draft is edited)
- `version` for stale-write protection
- `publishedAt` / `publishedById` after a successful publish
- `RunRosterEntry` unique on `(rosterId, signupId)`; rows are currently selected draft members

One selected signup per user per run is enforced in `RosterService`, not as a database constraint.

See [docs/features/roster-management.md](features/roster-management.md).

## RunAttendance

One attendance row per published selected `RunRosterEntry` for a started Run.

- unique on `rosterEntryId`
- status: `UNMARKED` \| `PRESENT` \| `LATE` \| `LEFT_EARLY` \| `NO_SHOW` \| `EXCUSED` \| `STANDBY`
- optional manager note, `markedAt` / `markedById`

Created when a published Run starts. See [run-lifecycle-attendance.md](features/run-lifecycle-attendance.md).

## RunSettlement / RunPayoutEntry

One gold settlement per completed Run. Entries come from `RunAttendance`. Status: `DRAFT` → `FINALIZED` → `PAID`. Amounts are whole gold integers. See [run-payouts.md](features/run-payouts.md).

## ActivityEvent

Development/operational activity feed for the dashboard. Not a KPI warehouse.
