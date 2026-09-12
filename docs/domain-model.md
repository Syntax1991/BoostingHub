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
- `accountRole`: `USER` \| `RAID_LEAD` \| `ADMIN` (ADMIN assigns via user management; never OAuth self-promote)
- timestamps

Email is optional for core behavior. Discord is the primary identity.

## BattleNetConnection

Optional regional Battle.net link for a BoostingHub user. Unique on `(userId, region)` (`EU` \| `US`).

Stores Battle.net account id, optional BattleTag, scope metadata, `connectedAt`, and `lastSuccessfulSyncAt`. User OAuth tokens are **never** persisted here. Discord remains login; this is a secondary game-account connection. See [blizzard-integration.md](features/blizzard-integration.md).

## BattleNetImportSession

Short-lived (~15 min) owned-character snapshot after OAuth. Holds JSON character candidates for import/link selection. Stores no tokens. Clients may only select ids present in this snapshot.

## Character

Belongs to one user. Operators add characters via Blizzard lookup (Add Character) or import/link them from Battle.net. The same Character row is used either way.

- display `name`, `realm`, `region` (`EU` \| `US`)
- `normalizedName` / `normalizedRealm` for owner-scoped case-insensitive uniqueness with region
- unique on `(userId, region, normalizedRealm, normalizedName)`
- class (Blizzard-authoritative), specialization (BoostingHub-owned), primary role (`TANK` \| `HEALER` \| `DPS`, derived from specialization)
- item level: `Int?`, Blizzard `equipped_item_level` when available, `null` ("Unknown") otherwise — never user-entered, never a `0` sentinel
- `isActive` lifecycle (deactivate instead of delete)
- optional scoped Blizzard identity: `blizzardCharacterId` + `blizzardRealmId` with `region`; unique on `(region, blizzardRealmId, blizzardCharacterId)` when set
- optional Warcraft Logs identifier (unused until later integration)
- `lastSyncedAt` set after a successful Blizzard profile sync

Class is immutable after creation. Specialization from Blizzard is import-time prefill only; afterward it stays BoostingHub-owned. `primaryRole` is derived from specialization; signup role must still be valid for the class. Disconnecting Battle.net does not delete Characters. See [character-management.md](features/character-management.md) and [blizzard-integration.md](features/blizzard-integration.md).

## BoosterQualification (current)

Authoritative **account-level** eligibility: User + Difficulty only. See [booster-access-management.md](features/booster-access-management.md).

- unique on `(userId, difficulty)`
- status: `APPROVED` \| `REVOKED`
- granted / revoked metadata and optional notes
- exact difficulty match (no inheritance)
- Characters consume the account qualification; they do not own it

## Legacy BoosterAccess (history)

Preserved historical applications: User + Class + Role + Difficulty (+ optional Character context). Statuses include `PENDING` (legacy queue only). Not the runtime eligibility source after migration.

## Raid / RaidBoss

Reusable **reference content**, not demo users or demo Runs. Catalog: `src/lib/wow-raid-catalog.ts`. `raidRepository.ensureReferenceRaids()` upserts it idempotently (seed and Run create/edit). Dev seed still adds fixture Runs around that content. Blizzard raid ingestion is deferred.

A Raid's **total boss count** is never a stored field — it is computed by counting that Raid's `RaidBoss` rows (`raidRepository` includes the `bosses` relation and returns `totalBossCount` as `bosses.length`). `Run.plannedBossCount` (below) is validated against this computed total, never against a duplicate stored number.

## CharacterRaidLockout

Lockout is **not** `character.locked = true`.

It depends on character + raid + difficulty + `resetIdentifier` (ISO week, e.g. `2026-W37`).

Heroic and Mythic lockouts for the same raid week are independent.

## Run

- title, raid, difficulty, loot type, scheduled start (UTC)
- status, raid lead, notes
- desired tank / healer / DPS counts
- planned boss count
- `signupsOpen`

### Derived title (no manual title entry)

`Run.title` is **server-derived, never client-authored**. Run creation and Edit Run have no title input — they show a read-only "Generated title" preview that live-updates as the schedule/difficulty/lootType/plannedBossCount/raidLead/raid change, computed client-side with the same pure `buildRunTitle` helper (`src/lib/run-title.ts`) the server uses. `createManyRuns` (via `prepareRunDraft`, per row) and `updateRun` always recompute and persist the title server-side from the final normalized values — a client-sent `title` is never accepted (the validators for Create/Edit Run have no `title` field at all).

Format: `{weekday} {HH:mm} {difficulty} {lootType} {planned}/{total} {raidLead}` in the Europe/Berlin community timezone — e.g. `Thu 21:00 HC VIP 7/9 Titan`. Difficulty abbreviations are `NM`/`HC`/`MY`; loot-type labels are `Saved`/`Unsaved`/`VIP`. Raid Lead is always the canonical BoostingHub display name, never a Discord nickname.

Historical Runs are **not** retroactively retitled — a migration backfills `lootType = UNSAVED` and `plannedBossCount = <raid's total boss count>` for existing rows, but their `title` stays whatever it already was until the Run is next edited (which always regenerates it, including for a notes-only or composition-only edit — recomputation is deterministic and cheap, so there's no "did the title's source fields actually change" check).

### RunLootType

`SAVED` \| `UNSAVED` \| `VIP` — independent of `RaidDifficulty`, not a combined enum. **Compatibility is a Service-layer rule, not a schema constraint**: every difficulty allows every loot type except `MYTHIC + SAVED`, which is rejected everywhere (Create, Edit, the future Mass Create feature, and Discord naming) via one central helper, `isLootTypeAllowedForDifficulty` / `assertValidRunLootType` in `src/services/run-state.ts` (throwing `RUN_LOOT_TYPE_INVALID`). New Runs default to `UNSAVED` — the only loot type valid for every difficulty including Mythic, so the default never needs a client-side override. The Create/Edit UI disables the `SAVED` option and auto-switches to `UNSAVED` when the selected difficulty is Mythic.

### Planned boss count

`Run.plannedBossCount` must satisfy `1 <= plannedBossCount <= <raid's total boss count>` (validated by `assertValidPlannedBossCount`, throwing `RUN_BOSS_COUNT_INVALID`). Create defaults it to the raid's full total; selecting a different raid resets it to that raid's total.

### Historical raid availability

A raid is never deleted when superseded — `RaidRecord.availableForRuns` (catalog: `WowRaidCatalogEntry.availableForRuns`, persisted on the existing `Raid.isActive` column, no separate column) controls only whether it can be picked for a **new** Run, independent of `currentForLockouts` (the separate Blizzard lockout-derivation target). `createManyRuns` (the one canonical creation path, 1–25 rows) rejects an unavailable raid with `RAID_NOT_AVAILABLE_FOR_RUNS` for any row; `updateRun` only enforces this when the raid is actually changing to a different one — keeping an existing (possibly historical) raid, including a difficulty-only change, is never blocked. See [run-management.md § Historical raid availability](features/run-management.md#historical-raid-availability) for the full detail.

### Discord channel naming

Discord run-channel names are derived from the same structured fields as the title — never parsed from `Run.title` — via `buildDiscordRunChannelName` (`src/lib/discord-channel-name.ts`): `{weekday}-{HHMM}-{difficulty}-{lootType}-{planned}of{total}-{raidLead}`, e.g. `thu-2100-hc-vip-7of9-titan`. Difficulty and loot type are always separate hyphenated segments (`hc-vip`, never `hcvip`), so an invalid state like `my-saved` can never render. Any change to a naming-source field (schedule, difficulty, loot type, planned boss count, or raid lead) renames the Run's existing Discord channel in place — the bot never creates a replacement channel or reposts existing messages for a rename.

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

## Strike

Disciplinary history record against a **User** (never a Character). Optional `runId`, proven against BoostingHub's own signup history — never Attendance, which belongs to the external Dawn Boosting operational workflow and is out of scope here. Status `ACTIVE` \| `REVOKED`; no severity, no expiry, no hard delete — revocation is the only correction path and always requires a reason. See [user-strikes.md](features/user-strikes.md).

## RunDiscordPost

Presentation-only Discord message identity for one Run — never a second source of truth for Run/Signup/Roster data. One row per Run (`runId` unique): the signup embed's channel/message id and a cheap signature to detect drift, and the roster embed's channel/message id and last-posted `RunRoster.version`. Lets the bot edit its own prior message instead of reposting, and survives a bot restart. See [discord-bot.md](features/discord-bot.md).

## ActivityEvent

Development/operational activity feed for the dashboard. Not a KPI warehouse.
