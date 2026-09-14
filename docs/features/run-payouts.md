# Run payouts

## Purpose

Financial settlement of a **completed** Run:

`COMPLETED` → Draft Settlement → calculate participant payouts → Finalize → Mark Paid

Payout eligibility comes from completed `RunAttendance`. This is not a wallet, escrow, or payment provider.

`RunSettlement.totalGold` is the **gross pot** — the single settlement pot field. There is no estimated/final dual model and **no Dawn API**, cookie, or credential integration. The Raid Lead enters the current gross pot manually (for example from Dawn).

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
| View draft split / community buckets | Manager DTO | Manager DTO | No |
| View own finalized line (Cut + payout) | n/a | n/a | Yes |

`canManageRun` remains the ownership check. Mark Paid additionally requires `ADMIN`.

Participants see **only** their own Cut and payout. They do **not** see community bucket breakdown (booster / advertiser / Dawn).

## Gold Unit

Whole World of Warcraft gold, stored as a signed integer.

- `totalGold` from 1 to 2,000,000,000 — the only pot field (**gross pot**)
- no silver, copper, or floating-point money
- display helper: `151000` → `151,000g`

### Pot semantics (`totalGold`)

| Status | Meaning |
| --- | --- |
| `DRAFT` | Mutable **gross pot**. Editing it recalculates the settlement preview immediately. |
| `FINALIZED` / `PAID` | The same field is frozen and is now the final authoritative gross pot. |

No separate `estimatedPot` / `finalPot` columns. Intermediate Dawn values before finalize are not versioned — edit the existing DRAFT `totalGold`.

## Community split (Dawn raid policy)

Gross pot is split into community buckets using frozen basis-point policy on the settlement (`boosterCutBps`, `raidLeadCutBps`, `advertiserCutBps`). Dawn is the **residual** (not a separate floor).

Current policy:

| Bucket | BPS | Percent | Notes |
| --- | --- | --- | --- |
| Booster | 6250 | 62.5% | Base booster pool (`boosterBaseGold`) |
| Raid Lead | 300 | 3% | KEEP vs SHARE decides destination |
| Advertiser | 3000 | 30% | Community advertiser cut (not distributed to attendance) |
| Dawn | 450 | 4.5% | Residual: `10000 − 6250 − 300 − 3000` |

Named buckets use `floor`; Dawn receives whatever remains so:

`boosterBaseGold + raidLeadCutGold + advertiserCutGold + dawnCutGold === totalGold`

**Important:** `totalGold` is **gross**. It is not “already the booster pot.” Booster Cut is always 62.5% of gross.

Policy rates are snapshotted on the settlement at prepare time so later rate changes do not rewrite historical drafts mid-edit without an explicit prepare.

## Raid Lead Cut (KEEP / SHARE)

Settlement-time financial decision on `RunSettlement` (not Run creation config):

| Field | Meaning |
| --- | --- |
| `raidLeadCutMode` | `KEEP` or `SHARE` (default `SHARE` for backwards compatibility) |

There is **no** manual `raidLeadCutGold` input and **no** synthetic “extra full share” / `raidLeadCutShareUnits` model. The 3% Raid Lead cut is computed from the gross pot; KEEP vs SHARE only chooses where that gold goes.

### KEEP

- `dedicatedRaidLeadPayout = raidLeadCutGold` (3% of gross)
- `raidLeadSharedGold = 0`
- `distributableBoosterPool = boosterBaseGold` (62.5% only)
- The assigned Run Raid Lead (`run.raidLeadId`) receives the dedicated cut as settlement-level money — **not** via a fabricated attendance/roster/signup row
- If that Raid Lead is also a payout-eligible attendance participant, they **also** receive their ordinary attendance share from the booster pool
- UI may show: ordinary attendance + dedicated RL cut = total

### SHARE

- `dedicatedRaidLeadPayout = 0`
- `raidLeadSharedGold = raidLeadCutGold`
- `distributableBoosterPool = boosterBaseGold + raidLeadCutGold` (62.5% + 3%)
- Raid Lead receives only an ordinary attendance share if otherwise eligible
- All-zero attendance with a positive distributable pool rejects with `PAYOUT_NO_ELIGIBLE_SHARES`

### Distributable pool conservation

Only the **distributable booster pool** is allocated by attendance `shareUnits`:

`attendanceDistributedGold === distributableBoosterPool`

Manager-facing allocated total:

`totalAllocatedGold = attendanceDistributedGold + dedicatedRaidLeadPayout`

Advertiser and Dawn gold are tracked on the settlement summary but are **not** paid out through attendance rows.

### Raid Lead recipient identity

`run.raidLeadId` is the KEEP cut recipient. Raid Lead reassignment is only allowed in `DRAFT` / `OPEN` / `ROSTERING`, so after `COMPLETED` (and after settlement finalization) the Run Raid Lead identity cannot change. Finalization already snapshots `raidLeadName` for display. No extra recipient user-id column is required.

## Default Attendance Cut mapping

Created server-side when preparing a DRAFT. Internal storage is still integer `shareUnits` (100 = 1.00 Cut). Display uses `formatPayoutCut`.

| Attendance | shareUnits | Cut label |
| --- | --- | --- |
| PRESENT | 100 | 1.00 Cut |
| LATE | 100 | 1.00 Cut |
| LEFT_EARLY | 100 | 1.00 Cut |
| NO_SHOW | 0 | 0 Cuts |
| EXCUSED | 0 | 0 Cuts |
| STANDBY | 0 | 0 Cuts |

`UNMARKED` on a completed run rejects settlement preparation.

Manager attendance notes never affect gold.

## Booster / Lootbuddy

| Participation | Default Cut | Override |
| --- | --- | --- |
| BOOSTER | From attendance mapping above | Manager may edit in DRAFT |
| LOOTBUDDY | **0 Cuts** regardless of attendance | Manager may manually override in DRAFT |

`ParticipationType` is stored and shown. Characterless Lootbuddy attendance continues to settle through the same path.

## Share units (Cut)

Integer weights:

- 100 = 1.00 Cut (full)
- 50 = 0.50 Cut
- 200 = 2.00 Cuts
- 0 = 0 Cuts (no payout)

Valid range: `0`–`10000`.

While DRAFT, an authorized manager may change `shareUnits` (optional adjustment reason, max 200 characters, manager-only). `amountGold` is never client-authored.

## Calculation / Remainder

`calculateSettlementPool({ totalGold, raidLeadCutMode, entries, policy? })`:

1. Split gross pot into booster / raid lead / advertiser / Dawn residual (`splitGrossPot`)
2. Resolve KEEP vs SHARE → `dedicatedRaidLeadPayout`, `raidLeadSharedGold`, `distributableBoosterPool`
3. `attendanceUnits = sum(shareUnits > 0)`
4. Run deterministic `allocateGold` over attendance entries against **only** `distributableBoosterPool`
5. Remainder gold is given one unit at a time in **allocation-key lexicographic order**

Each eligible entry gets `floor(pool * shareUnits / totalUnits)` using integer arithmetic.

Zero-share attendance rows are kept with `amountGold = 0` so the settlement explains every operational participant.

Same-user multiple eligible attendance rows are **not** deduped — each row keeps its own share. The dedicated KEEP cut is exactly one settlement-level amount.

## Backup

Signup `isBackup` does not determine payout. `STANDBY` defaults to 0. A backup marked `PRESENT` defaults to 100 for boosters (lootbuddies still default to 0). A manager may assign `shareUnits > 0` during DRAFT.

## Finalization

Recalculates from database state (including cut mode and frozen policy BPS), snapshots run/participant display fields, then stores `FINALIZED` with `finalizedAt` / `finalizedById`.

The current DRAFT `totalGold` becomes the frozen final gross pot — no copy into a second field.

After finalize: `totalGold`, cut mode, policy BPS, dedicated Raid Lead payout, shares, recipients, amounts, and snapshots are immutable.

## Paid

Settlement-level bookkeeping marker only (`paidAt` / `paidById`). No gold is transferred. ADMIN only. No unpay action.

## Historical Snapshots

At finalize the settlement stores run title, raid name, difficulty, raid lead name, cut mode, policy BPS, and each entry's user/character display fields, participation type, attendance status, backup flag, share units, and amount.

Later user/character renames must not rewrite a finalized settlement.

## Canonical Run Detail

Payout lives on `/runs/[runId]` as a fifth tab: Overview, Signups, Roster, Attendance, Payout.

There is no `/manage/runs/[runId]/payout` implementation.

Manager UI highlights:

- Total Pot (gross)
- Booster Cut 62.5% and base booster pool (more prominent than Raid Lead cut)
- Raid Lead Cut 3% · KEEP/SHARE
- Advertiser 30%, Dawn residual, Distributable Booster Pool
- Participant table: Character, Type, Attendance, Cut, Payout, Reason

## MVCS

```text
View → Controller → Service → Repository → Model
```

- `PayoutService` owns prepare, draft edits, calculation, finalize, mark paid, and DTO shaping
- Settlement math (gross split + KEEP/SHARE + booster-pool allocation) lives in `payout-calculation` / service — not in React or controllers
- `prepareSettlement` / `updateDraftFinancials` take `{ totalGold, raidLeadCutMode }` only
- `PayoutRepository` owns persistence
- Controllers authenticate, validate with Zod, call the service, map domain errors, revalidate `/runs/[runId]`
- `RunService.completeRun` does not compute payouts

No Prisma in views or controllers. No payout math in React.

## Security

- Recipients come from attendance (plus settlement-level KEEP cut for the Run Raid Lead), not the client
- `amountGold`, `preparedById`, `finalizedById`, `paidById`, and status transitions are server-derived
- USER payloads omit the manager list, community bucket breakdown, other people's amounts, adjustment reasons, and mutation capabilities
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
- advertiser payout automation
- per-entry payment state
- Discord
- Blizzard
- Warcraft Logs
