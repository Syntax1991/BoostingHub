# Run payouts

## Purpose

Financial settlement of a **completed** Run:

`COMPLETED` → Draft Settlement → calculate participant payouts → Finalize → Mark Paid

Payout eligibility comes from completed `RunAttendance`. This is not a wallet, escrow, or payment provider.

The manager-entered `totalGold` is the **authoritative final pot** for the settlement (typically taken from Dawn manually). There is no Dawn API, cookie, or credential integration in this feature.

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

- `totalGold` from 1 to 2,000,000,000 — authoritative final pot
- `raidLeadCutGold` from 0 to `totalGold - 1` (declared Raid Lead cut; may be 0)
- no silver, copper, or floating-point money
- display helper: `151000` → `151,000g`

## Raid Lead Cut (KEEP / SHARE)

Settlement-time financial decision on `RunSettlement` (not Run creation config):

| Field | Meaning |
| --- | --- |
| `raidLeadCutMode` | `KEEP` or `SHARE` (default `SHARE` for backwards compatibility) |
| `raidLeadCutGold` | Declared Raid Lead cut amount (persisted for **both** modes) |

### KEEP

- `dedicatedRaidLeadPayout = raidLeadCutGold`
- `distributablePool = totalGold - raidLeadCutGold`
- Attendance share allocation runs against `distributablePool`
- The assigned Run Raid Lead (`run.raidLeadId`) receives the dedicated cut as settlement-level money — **not** via a fabricated attendance/roster/signup row
- If that Raid Lead is also a payout-eligible attendance participant, they **also** receive their ordinary attendance share

Conservation: `sum(attendance amountGold) + dedicatedRaidLeadPayout === totalGold`

### SHARE

- `dedicatedRaidLeadPayout = 0`
- `distributablePool = totalGold`
- Declared `raidLeadCutGold` stays stored/displayed for audit transparency but is **not** deducted and **not** paid separately
- Raid Lead receives only an ordinary attendance share if otherwise eligible

Conservation: `sum(attendance amountGold) === totalGold`

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

`totalUnits = sum(shareUnits > 0)`. Must be greater than zero.

Allocation runs against the **distributable pool** (see KEEP / SHARE above), not always against `totalGold`.

Each eligible entry gets `floor(pool * shareUnits / totalUnits)` using integer arithmetic.

Remaining pool gold is given one unit at a time in **`attendanceId` lexicographic order**.

Attendance invariant: `sum(attendance amountGold) === distributablePool`.

Zero-share attendance rows are kept with `amountGold = 0` so the settlement explains every operational participant.

Same-user multiple eligible attendance rows are **not** deduped — each row keeps its own share. The dedicated KEEP cut is exactly one settlement-level amount.

## Booster / Lootbuddy

No automatic formula difference in v1. Both use the same attendance default mapping. `ParticipationType` is stored and shown. `LOOT_ONLY` / `PLAYING` do not change gold. Characterless Lootbuddy attendance continues to settle through the same path.

## Backup

Signup `isBackup` does not determine payout. `STANDBY` defaults to 0. A backup marked `PRESENT` defaults to 100. A manager may assign `shareUnits > 0` to standby during DRAFT.

## Finalization

Recalculates from database state (including cut mode / declared cut), snapshots run/participant display fields, then stores `FINALIZED` with `finalizedAt` / `finalizedById`.

After finalize: total pot, cut mode, declared cut, dedicated Raid Lead payout, shares, recipients, amounts, and snapshots are immutable.

## Paid

Settlement-level bookkeeping marker only (`paidAt` / `paidById`). No gold is transferred. ADMIN only. No unpay action.

## Historical Snapshots

At finalize the settlement stores run title, raid name, difficulty, raid lead name, cut mode, declared cut, and each entry's user/character display fields, participation type, attendance status, backup flag, share units, and amount.

Later user/character renames must not rewrite a finalized settlement.

## Canonical Run Detail

Payout lives on `/runs/[runId]` as a fifth tab: Overview, Signups, Roster, Attendance, Payout.

There is no `/manage/runs/[runId]/payout` implementation.

## MVCS

```text
View → Controller → Service → Repository → Model
```

- `PayoutService` owns prepare, draft edits, calculation, finalize, mark paid, and DTO shaping
- Settlement math (KEEP/SHARE pools) lives in `payout-calculation` / service — not in React or controllers
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
