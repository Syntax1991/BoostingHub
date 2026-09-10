# Strikes and Deducts

## Purpose

Two related but independent MVP concepts:

- **Strike** — a disciplinary history record against a `User`.
- **Deduct** — a financial reduction against one `RunPayoutEntry`'s gross `amountGold`.

A Strike never automatically creates a Deduct. A Deduct never requires a Strike. Every Strike and every Deduct is an explicit staff action — nothing here is created automatically from an Attendance status change, a Run outcome, or a BoosterQualification change.

## Strike

### Model

`Strike`: `userId` (subject, required), `runId` (nullable), `attendanceId` (nullable), `reason` (required), `notes` (optional, staff-only), `status` (`ACTIVE` \| `REVOKED`), `createdById`, `revokedAt` / `revokedById` / `revokedReason`, timestamps.

Subject is always `User`, never `Character` — a Strike survives account role changes, Character deactivation, and BoosterQualification changes. No severity. No expiry (`expiresAt` is explicitly not implemented; "active" means `status === ACTIVE`, permanently, until an ADMIN revokes it). No hard delete — revocation is the only correction path and keeps the row.

### Run / Attendance relation

`runId` is optional: most Strikes reference the Run an incident happened on, but ADMIN may also record a general disciplinary note with no Run context.

`attendanceId` is optional. When supplied, the server derives both `userId` and `runId` from the Attendance row itself — client-supplied `userId`/`runId` are never trusted once an `attendanceId` is present. This is the path used by the Attendance tab's **Add strike** action.

### Authorization

| Action | ADMIN | RAID_LEAD | USER |
| --- | --- | --- | --- |
| Create (no `runId`) | yes | no (`STRIKE_RUN_REQUIRED`) | no |
| Create (with `runId`) | yes, any Run | only a Run they manage (`canManageRun`), and only for a User with signup history on it (`STRIKE_USER_NOT_ASSOCIATED` otherwise) | no |
| Revoke | yes | no (`STRIKE_REVOKE_FORBIDDEN`, even for a Strike they created) | no |
| Read own history | n/a | n/a | yes (no internal `notes`) |
| Read another User's history | yes | only via `listForRun` on a Run they manage | no |

### UI

- `/manage/users/[userId]`: **Strikes** card (between Booster qualifications and Audit) — full detail, Add strike (general, ADMIN), Revoke (ADMIN-only, reason required).
- `/profile`: read-only Strikes card — own history, no internal notes.
- Run Attendance tab (`/runs/[runId]`, manager view): **Add strike** per row, deriving `attendanceId` — never auto-created from marking a status.

No dedicated `/manage/strikes` page exists.

## Deduct

### Model

`Deduct`: `payoutEntryId` (required, **not** unique — multiple Deducts may exist per entry), `amountGold` (positive whole gold), `reason` (required), `notes` (optional, staff-only), `strikeId` (nullable, optional link), `status` (`ACTIVE` \| `REVOKED`), `createdById`, `revokedAt` / `revokedById` / `revokedReason`, timestamps.

No `userId` or `settlementId` denormalized onto `Deduct` — both are reachable through `payoutEntryId → RunPayoutEntry → user` / `settlementId`, and duplicating them would risk drifting out of sync. No hard delete.

### Amount and cap

Fixed whole gold only (no percentages, no decimals). The sum of a payout entry's **ACTIVE** Deducts can never exceed that entry's gross `amountGold` — a Deduct that would push the total over is rejected (`DEDUCT_EXCEEDS_GROSS`), never silently clamped. There is no wallet/debt system: an over-deduction is refused, not carried anywhere.

### Lifecycle

Mirrors `RunSettlement` mutability exactly — no separate Deduct-specific state machine:

| Settlement status | Create | Revoke |
| --- | --- | --- |
| `DRAFT` | allowed | allowed (reason required) |
| `FINALIZED` | rejected (`DEDUCT_SETTLEMENT_LOCKED`) | rejected |
| `PAID` | rejected | rejected |

### Gross / Deduct / Net accounting

`RunPayoutEntry.amountGold` (gross) and `allocateGold()`'s exact-sum invariant (`sum(amountGold) === settlement.totalGold`) are **completely unchanged** by this feature. Deduct data is read-side only:

- `deductTotal` = sum of that entry's **ACTIVE** Deducts.
- `netAmountGold` = `grossAmountGold - deductTotal` (never negative in practice, because over-deduction is rejected at write time).
- Settlement summary adds `grossTotal` (= `totalGold`), `deductTotal`, `netTotal`, `retainedTotal` (= `deductTotal`).

None of `netAmountGold`/`netTotal`/`retainedTotal` are persisted — they are derived in `payoutService.getPayoutView` from a single batched `deductRepository.listByPayoutEntryIds(...)` call per settlement (never one query per entry).

**Deducted gold is retained/unallocated — it is never redistributed to other participants.** Everyone else's gross allocation is unaffected by another participant's Deduct.

### Optional Strike link

`Deduct.strikeId` is optional and independent — a Strike may exist with no Deduct, a Deduct may exist with no Strike, and one Strike may (in principle) be referenced by more than one Deduct over time. When supplied, the server validates the Strike belongs to the same User as the payout entry, and — if the Strike itself has a `runId` — that it matches the settlement's Run; either mismatch is `DEDUCT_INVALID_STRIKE_LINK`. Revoking a Strike never revokes its linked Deduct, and revoking a Deduct never revokes its linked Strike — the two lifecycles are independent.

### Authorization

| Action | ADMIN | RAID_LEAD | USER |
| --- | --- | --- | --- |
| Create / revoke | any DRAFT settlement | only a Run they manage, DRAFT only | no |
| View own finalized/paid net line + own active Deduct reasons | n/a | n/a | yes |
| View Deduct detail (notes, creator) | yes | only Runs they manage | no |

### UI

Run Payout tab (`/runs/[runId]`, manager view): settlement summary gains Gross/Deducts/Net/Retained; each participant row gains Gross/Deducts/Net columns and a **Manage deducts** action (add while DRAFT, list all active/revoked with metadata, inline revoke with required reason). Once FINALIZED/PAID the dialog is read-only. USER's own finalized/paid line shows Gross/Deducts/Net and each active Deduct's reason; internal notes and other Users' Deducts are never included in that payload.

No dedicated Deduct route exists — everything lives on the existing canonical Run Payout tab.

## Activity / Audit

`STRIKE_ADDED`, `STRIKE_REVOKED`, `DEDUCT_ADDED`, `DEDUCT_REVOKED` follow the existing `ActivityEvent` convention: `userId` is the acting staff member, and the free-text `message` embeds target/run/amount identifiers (e.g. `targetUserId=…`, `deductId=…`), matching how `ACCOUNT_ROLE_CHANGED` and the Payout events already work.

## MVCS

- Model: `Strike`, `Deduct`
- View: Strikes card (`/manage/users/[userId]`, `/profile`), Attendance tab Add-strike action, Payout tab Gross/Deducts/Net + Manage-deducts dialog
- Controller: `strike.actions.ts`, `deduct.actions.ts`
- Service: `strike.service.ts`, `payout-deduct.service.ts` (kept separate from `payout.service.ts`, which stays authoritative for settlement lifecycle and the gross allocation itself)
- Repository: `strike.repository.ts`, `deduct.repository.ts` (batched `listByPayoutEntryIds`, never one query per entry)

## Deferred

Strike expiry/decay, severity levels, appeals workflow, automatic sanctions (including any automatic Strike-from-Attendance or BoosterQualification-revoke-from-Strike-count), percentage Deducts, wallet/debt/cross-run carry-over, a dedicated `/manage/strikes` review page, Discord synchronization, automated bot enforcement.
