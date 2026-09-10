# Run payouts

## Purpose

Financial settlement of a **completed** Run:

`COMPLETED` → Draft Settlement → calculate participant payouts → Finalize → Mark Paid

Payout eligibility comes from completed `RunAttendance`. This is not a wallet, escrow, or payment provider.

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

- `totalGold` from 1 to 2,000,000,000
- no silver, copper, or floating-point money
- display helper: `151000` → `151,000g`

The manager-entered total is a **manual bookkeeping amount** for this run. It is not a wallet balance and is not verified against an external source.

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

`totalUnits = sum(shareUnits > 0)`. Must be greater than zero.

Each eligible entry gets `floor(totalGold * shareUnits / totalUnits)` using integer arithmetic.

Remaining gold is given one unit at a time in **`attendanceId` lexicographic order**.

Invariant: `sum(amountGold) === totalGold`.

Zero-share attendance rows are kept with `amountGold = 0` so the settlement explains every operational participant.

## Booster / Lootbuddy

No automatic formula difference in v1. Both use the same attendance default mapping. `ParticipationType` is stored and shown. `LOOT_ONLY` / `PLAYING` do not change gold.

## Backup

Signup `isBackup` does not determine payout. `STANDBY` defaults to 0. A backup marked `PRESENT` defaults to 100. A manager may assign `shareUnits > 0` to standby during DRAFT.

## Finalization

Recalculates from database state, snapshots run/participant display fields, then stores `FINALIZED` with `finalizedAt` / `finalizedById`.

After finalize: total, shares, recipients, amounts, and snapshots are immutable.

## Paid

Settlement-level bookkeeping marker only (`paidAt` / `paidById`). No gold is transferred. ADMIN only. No unpay action.

## Historical Snapshots

At finalize the settlement stores run title, raid name, difficulty, raid lead name, and each entry's user/character display fields, participation type, attendance status, backup flag, share units, and amount.

Later user/character renames must not rewrite a finalized settlement.

## Canonical Run Detail

Payout lives on `/runs/[runId]` as a fifth tab: Overview, Signups, Roster, Attendance, Payout.

There is no `/manage/runs/[runId]/payout` implementation.

## MVCS

```text
View → Controller → Service → Repository → Model
```

- `PayoutService` owns prepare, draft edits, calculation, finalize, mark paid, and DTO shaping
- `PayoutRepository` owns persistence
- Controllers authenticate, validate with Zod, call the service, map domain errors, revalidate `/runs/[runId]`
- `RunService.completeRun` does not compute payouts

No Prisma in views or controllers. No payout math in React.

## Security

- Recipients come from attendance, not the client
- `amountGold`, `preparedById`, `finalizedById`, `paidById`, and status transitions are server-derived
- USER payloads omit the manager list, other people's amounts, adjustment reasons, and mutation capabilities
- Hidden buttons are not authorization

## Deducts

A payout entry's gross `amountGold` (and the exact-sum invariant above) is never altered by Deducts. `payoutService.getPayoutView` additionally derives, read-side only, `deductTotal`/`netAmountGold` per entry and `grossTotal`/`deductTotal`/`netTotal`/`retainedTotal` at the settlement level, batching `deductRepository.listByPayoutEntryIds(...)` once per settlement. Deducted gold is retained/unallocated, never redistributed to other participants. Deducts are mutable only while the settlement is `DRAFT`. See [strikes-and-deducts.md](strikes-and-deducts.md).

## Deferred

- corrections/revisions
- wallets
- Available Gold
- Pending/Escrow
- payment automation
- Raid Lead extra cut
- Collector
- Advertiser
- per-entry payment state
- Discord
- Blizzard
- Warcraft Logs
