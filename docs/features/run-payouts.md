# Run payouts

## Purpose

Financial settlement of a **completed** Run:

`COMPLETED` → Draft Settlement → calculate participant payouts → Finalize → Mark Paid

Payout eligibility comes from completed `RunAttendance`. This is not a wallet, escrow, or payment provider.

`RunSettlement.totalGold` is the **single** settlement pot field. There is no estimated/final dual model and no Dawn API, cookie, or credential integration — the Raid Lead enters the current pot manually (for example from Dawn).

## Source of Truth

Completed `RunAttendance`.

Not:

- all `RunSignup` rows
- draft roster
- `ActivityEvent`

Start already snapshotted the published selected roster into attendance. Completion requires zero `UNMARKED` rows.

## Settlement Lifecycle

`none` → `DRAFT` → `FINALIZED` → `PAID`

Explicit actions only. No generic status dropdown. No backward transitions in v1.

One `RunSettlement` per Run (`runId` unique). Finalized and paid settlements are immutable. Corrections/revisions are deferred.

## Authorization

| Action | Assigned RAID_LEAD | ADMIN | USER |
| --- | --- | --- | --- |
| Prepare / edit draft / finalize | Own run | Any run | No |
| Mark Paid | No | Yes | No |
| View draft split | Manager DTO | Manager DTO | No |
| View own finalized line | n/a | n/a | Yes |

`canManageRun` remains the ownership check. Mark Paid additionally requires `ADMIN`.

## Gold Unit

Whole World of Warcraft gold, stored as a signed integer.

- `totalGold` from 1 to 2,000,000,000 — the only pot field
- no silver, copper, or floating-point money
- display helper: `151000` → `151,000g`

### Pot semantics (`totalGold`)

| Status | Meaning |
| --- | --- |
| `DRAFT` | Mutable **current pot**. Editing it recalculates the settlement preview immediately. |
| `FINALIZED` / `PAID` | The same field is frozen and is now the final authoritative pot. |

No separate `estimatedPot` / `finalPot` columns. Intermediate Dawn values before finalize are not versioned — edit the existing DRAFT `totalGold`.

## Raid Lead Cut (KEEP / SHARE)

Settlement-time financial decision on `RunSettlement` (not Run creation config):

| Field | Meaning |
| --- | --- |
| `raidLeadCutMode` | `KEEP` or `SHARE` (default `SHARE` for backwards compatibility) |

There is **no** manual `raidLeadCutGold` input. Schema stores only `raidLeadCutMode`. The KEEP cut is auto-calculated as one extra full share (`RAID_LEAD_CUT_SHARE_UNITS = 100`).

### KEEP

- Adds one calculation-only full share (`100` units) into the same weighted allocation as attendance shares
- That synthetic share uses allocation key `__raid_lead_cut__` — never persisted as attendance
- `dedicatedRaidLeadPayout` = gold allocated to that synthetic share
- Attendance rows receive only their attendance share amounts (`attendanceDistributedGold`)
- The assigned Run Raid Lead (`run.raidLeadId`) receives the dedicated cut as settlement-level money — **not** via a fabricated attendance/roster/signup row
- If that Raid Lead is also a payout-eligible attendance participant, they **also** receive their ordinary attendance share
- All-zero attendance with KEEP is allowed: the dedicated cut receives the entire pot

Conservation: `attendanceDistributedGold + dedicatedRaidLeadPayout === totalGold`

Settlement units: `totalSettlementUnits = attendanceUnits + 100`

### SHARE

- `dedicatedRaidLeadPayout = 0`
- `raidLeadCutShareUnits = 0`
- Pot is allocated only across attendance share units
- Raid Lead receives only an ordinary attendance share if otherwise eligible
- All-zero attendance with SHARE rejects with `PAYOUT_NO_ELIGIBLE_SHARES`

Conservation: `attendanceDistributedGold === totalGold`

### Raid Lead recipient identity

`run.raidLeadId` is the KEEP cut recipient. Raid Lead reassignment is only allowed in `DRAFT` / `OPEN` / `ROSTERING`, so after `COMPLETED` (and after settlement finalization) the Run Raid Lead identity cannot change. Finalization already snapshots `raidLeadName` for display. No extra recipient user-id column is required.

## Default Attendance Share Mapping

Created server-side when preparing a DRAFT:

| Attendance | shareUnits |
| --- | --- |
| PRESENT | 100 |
| LATE | 100 |
| LEFT_EARLY | 100 |
| NO_SHOW | 0 |
| EXCUSED | 0 |
| STANDBY | 0 |

`UNMARKED` on a completed run rejects settlement preparation.

Manager attendance notes never affect gold.

## Share Units

Integer weights:

- 100 = full share
- 50 = half share
- 200 = double share
- 0 = no payout

Valid range: `0`–`10000`.

While DRAFT, an authorized manager may change `shareUnits` (optional adjustment reason, max 200 characters, manager-only). `amountGold` is never client-authored.

## Calculation / Remainder

`calculateSettlementPool({ totalGold, raidLeadCutMode, entries })`:

1. `attendanceUnits = sum(shareUnits > 0)`
2. `raidLeadCutShareUnits = KEEP ? 100 : 0`
3. `totalSettlementUnits = attendanceUnits + raidLeadCutShareUnits` (must be > 0)
4. Run deterministic `allocateGold` over attendance entries plus the KEEP synthetic key when present
5. Remainder gold is given one unit at a time in **allocation-key lexicographic order** (so `__raid_lead_cut__` participates in the same remainder pass)

Each eligible entry gets `floor(totalGold * shareUnits / totalSettlementUnits)` using integer arithmetic.

Zero-share attendance rows are kept with `amountGold = 0` so the settlement explains every operational participant.

Same-user multiple eligible attendance rows are **not** deduped — each row keeps its own share. The dedicated KEEP cut is exactly one settlement-level amount.

## Booster / Lootbuddy

No automatic formula difference in v1. Both use the same attendance default mapping. `ParticipationType` is stored and shown. `LOOT_ONLY` / `PLAYING` do not change gold. Characterless Lootbuddy attendance continues to settle through the same path.

## Backup

Signup `isBackup` does not determine payout. `STANDBY` defaults to 0. A backup marked `PRESENT` defaults to 100. A manager may assign `shareUnits > 0` to standby during DRAFT.

## Finalization

Recalculates from database state (including cut mode), snapshots run/participant display fields, then stores `FINALIZED` with `finalizedAt` / `finalizedById`.

The current DRAFT `totalGold` becomes the frozen final pot — no copy into a second field.

After finalize: `totalGold`, cut mode, dedicated Raid Lead payout, shares, recipients, amounts, and snapshots are immutable.

## Paid

Settlement-level bookkeeping marker only (`paidAt` / `paidById`). No gold is transferred. ADMIN only. No unpay action.

## Historical Snapshots

At finalize the settlement stores run title, raid name, difficulty, raid lead name, cut mode, and each entry's user/character display fields, participation type, attendance status, backup flag, share units, and amount.

Later user/character renames must not rewrite a finalized settlement.

## Canonical Run Detail

Payout lives on `/runs/[runId]` as a fifth tab: Overview, Signups, Roster, Attendance, Payout.

There is no `/manage/runs/[runId]/payout` implementation.

## MVCS

```text
View → Controller → Service → Repository → Model
```

- `PayoutService` owns prepare, draft edits, calculation, finalize, mark paid, and DTO shaping
- Settlement math (KEEP/SHARE auto-calc share model) lives in `payout-calculation` / service — not in React or controllers
- `prepareSettlement` / `updateDraftFinancials` take `{ totalGold, raidLeadCutMode }` only
- `PayoutRepository` owns persistence
- Controllers authenticate, validate with Zod, call the service, map domain errors, revalidate `/runs/[runId]`
- `RunService.completeRun` does not compute payouts

No Prisma in views or controllers. No payout math in React.

## Security

- Recipients come from attendance (plus settlement-level KEEP cut for the Run Raid Lead), not the client
- `amountGold`, `preparedById`, `finalizedById`, `paidById`, and status transitions are server-derived
- USER payloads omit the manager list, other people's amounts, adjustment reasons, and mutation capabilities
- Hidden buttons are not authorization

## Deferred

- Dawn paste/import / API / credentials
- My Runs / manage-list settlement history redesign
- post-complete attendance corrections
- corrections/revisions
- wallets
- Available Gold
- Pending/Escrow
- payment automation
- Collector
- Advertiser
- per-entry payment state
- Discord
- Blizzard
- Warcraft Logs
