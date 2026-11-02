# Phase 3 — Production refactoring / code quality

## STATUS

- **Phase:** 3 — Production refactoring / code quality
- **Result:** DONE
- **Completion criteria:** Satisfied on branch `test/audit-batch-a` (2026-11-02)

A18 and A19 landed as separate commits. Four production modules imported only by tests were deleted after confirming no `src/` consumers (static or dynamic). Naming review produced one safe rename-only commit; remaining overlapping `lib`/`services` stems are documented as deferred (need product ownership decisions, not mechanical renames). A16 (`lib/gold.ts`) remains an explicit owner decision and was not removed.

## GIT

| Item | Value |
| --- | --- |
| Branch | `test/audit-batch-a` |
| A18 | `11fc614` — `tx.orm.public` replaces repeated ORM casts; helpers removed |
| A19 | `cc14bdf` — remove empty `raidInvites` sync lane |
| Dead modules | `e2a0979` — delete four test-only production modules |
| Naming | `8666f32` — rename `domain.test.ts` → `auth-run-state-datetime.test.ts` |
| Report | this commit |

## WORK COMPLETED

### A18 — transaction ORM casts

- Replaced `((tx.orm as { public?: … }).public ?? (tx.orm as unknown as …)) as …` across repositories, `community-schedule.service`, and four integration suites.
- Deleted `txOrmOf` / `resolveTxOrm` helpers that typed `orm` as `unknown` and erased `tx.orm.public`.
- Call sites now use `tx.orm.public` directly.

### A19 — dead `raidInvites` lane

Removed from web + bot (deployed together on this branch):

| Surface | Change |
| --- | --- |
| `discordSyncService.listSyncWork` | Dropped `raidInvites` / `RaidInviteWorkItem` |
| `GET /api/bot/discord/sync` | No longer projects `raidInvites` |
| `bot-api-client` SyncWork + `recordDiscordState` | Removed `raidInvites` and `kind: "raid-invite"` |
| `sync-loop` | Removed lane + `syncRaidInvite` |
| `PUT …/discord-state` | Removed `raid-invite` schema branch |

**Kept:** `runDiscordPostRepository.recordRaidInviteSent` / `raidInviteSentSignupIds`, written by `recordNotificationDmDelivery` when a `RAID_INVITE` DM is `SENT`.

### Dead-code candidates (verified unused in `src/`)

Deleted:

- `src/components/manage/roster-run-commitments.tsx` (+ unit suite)
- `src/lib/roster-candidate-counts.ts` (+ unit suite)
- `src/lib/character-availability.ts` (+ unit suite)
- `src/repositories/character-availability.repository.ts`

Integration tests that proved legacy `CharacterAvailabilityBlock` rows are ignored now insert via `orm.CharacterAvailabilityBlock` directly. Table remains in the contract (deprecated, inert).

### Naming review

| Action | Detail |
| --- | --- |
| Done | Renamed misnamed `tests/unit/lib/domain.test.ts` → `auth-run-state-datetime.test.ts` (behaviour unchanged) |
| Deferred | Overlapping stems in both `lib/` and `services/` (e.g. operational-analytics, character-schedule-conflict); controller `.actions` vs `.controller` mix (intentional); A16 `gold.ts` owner decision |
| Constraint | No public fields, columns, persisted keys, or Discord payload renames |

## QUALITY AND VALIDATION

| Check | Result |
| --- | --- |
| `npm run lint` | Pass (0 errors) after unused `TxOrm`/`orm` cleanup |
| `npx tsc --noEmit` | Pass |
| `npm run build` | Pass |
| Focused A19 suites | `notification-raid-invite`, `bot-routes`, `sync-loop` — 106/106 |
| Focused dead-code suites | `schedule-conflict-integrity`, `character-schedule-commitments` — 5/5 |
| Naming suite | `auth-run-state-datetime` — 12/12 |

## FINDINGS

- A19 analysis note that listed `discordSyncService.recordRaidInviteSent` as dead was partially wrong: the **service method** remains the notification-DM path into the repository; only the sync-work lane and discord-state kind were dead.
- Removing test-only UI/helpers did not change product behaviour; roster conflict presentation lives elsewhere under live imports.
- Further naming churn without ownership decisions would create churn without clarity — deferred explicitly.

## NEXT PHASE

- **Phase 4 — Performance, security, reliability**
- Measured before/after for agreed hotspots; security follow-ups from the audit table (A3 etc.); reliability items; then `PHASE-4.md`.

## RELEASE SAFETY

No merges, deployments, production database writes, live Discord operations, force-pushes, history rewrites, or new repository creation. Wire change for A19 is additive-safe for older bots that already ignored empty `raidInvites` (`?? []`); this branch removes the field for co-deployed web+bot.
