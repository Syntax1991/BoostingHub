# Booster access management

## Purpose

Let an ADMIN grant, approve, reject, or revoke **Booster Qualification** after Discord review.

Current eligibility answers only:

> Is this BoostingHub User approved to boost on this difficulty?

Canonical identity:

```text
User + Raid Difficulty
```

Examples: `Simon + HEROIC`, `Aelira + MYTHIC`.

It does **not** depend on Character, WoW Class, specialization, Character Role, Item Level, or Account Role.

Self-service `requestAccess` is disabled (`BOOSTER_ACCESS_SELF_REQUEST_DISABLED`). Character pages show a Discord ticket CTA when `DISCORD_BOOSTER_TICKET_URL` is set.

## Two persistence models

### BoosterQualification (current, authoritative)

- Unique on `(userId, difficulty)`
- Statuses: `APPROVED` | `REVOKED` (no `PENDING`)
- Exact-match difficulties: MYTHIC does not imply HEROIC or NORMAL
- Grant / revoke / re-grant (reactivate same row) are ADMIN-only

### Legacy BoosterAccess (historical request history)

- Preserved rows: User + Class + Role + Difficulty (+ optional Character context)
- Statuses: `PENDING` | `APPROVED` | `REJECTED` | `REVOKED`
- Not the runtime eligibility source after migration
- `characterId` is request origin only (“Requested via Synblast-Antonidas”)

## Why qualification is separate from account role

Account roles (`USER`, `RAID_LEAD`, `ADMIN`) are platform permissions.

Run participation (`BOOSTER`, `LOOTBUDDY`) is per-run.

`BoosterQualification` is difficulty-level boosting eligibility. ADMIN does **not** automatically receive qualifications. A later `BOOSTER_ACCESS_MANAGER` permission may replace the current ADMIN-only review gate.

## Discord application + ADMIN grant

Current onboarding:

```text
User → Discord ticket → staff review → ADMIN grant (User + Difficulty)
```

Grant UI fields: User, Difficulty, Notes (optional). No Character / Class / Role / Item Level / Spec.

A User may receive access with **zero Characters**. Later Characters consume the account qualification.

ADMIN may grant to USER, RAID_LEAD, ADMIN, or themselves.

## Qualifications vs Legacy Requests

`/manage/booster-access` is ADMIN-only and has two views:

### Qualifications (default)

Current User + Difficulty authorization.

Columns: User · Difficulty · Status · Granted / Reviewed · Notes · Actions

Filters: User search, Difficulty, Status (`ALL` | `APPROVED` | `REVOKED`).

### Legacy Requests · N

Unresolved historical `PENDING` in-app applications only.

May still show Class / Role / Character context because that is historical application data.

Helper meaning:

> These applications used the previous character/class workflow. Approving one grants account-wide access for that difficulty.

Approving a legacy PENDING row:

1. Marks that row (and same-user + same-difficulty PENDING siblings) `APPROVED`
2. Ensures one current `BoosterQualification` for that User + Difficulty

Rejecting one PENDING row does not create or revoke a qualification.

Empty legacy queue:

> No legacy requests awaiting review.

## Conceptual split

| Concern | Question |
| --- | --- |
| Qualification | May this User boost Heroic? |
| Character eligibility | May this Character be used in this Run? |
| Roster composition | Do we want this Character/role on the roster? |

Signup and roster revalidation read **BoosterQualification** for the signup User + Run Difficulty. Character ownership, active state, valid role-for-class, lockouts, and composition rules remain separate.

## Management hub

Booster Access card metrics:

- Legacy pending — unresolved historical PENDING rows
- Approved qualifications — count of active User + Difficulty APPROVED rows

## Migration / backfill

Forward migration creates `booster_qualification` and backfills one APPROVED qualification per unique `(userId, difficulty)` that has at least one APPROVED legacy `BoosterAccess` row. Grant metadata prefers the most recently approved/reviewed legacy row. Covered PENDING siblings for that difficulty are resolved to APPROVED without deleting history.

## Out of scope here

Discord bot automation, mass signup, Strikes, Deducts.
