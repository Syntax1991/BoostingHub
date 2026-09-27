# Booster access management

## Purpose

Let an ADMIN grant, approve, reject, or revoke **Booster Qualification** after Discord review.

Current eligibility answers only:

> Is this BoostingHub User an approved booster?

Canonical identity:

```text
User  (one account-level qualification)
```

**Booster qualification is account-level and is not scoped by raid difficulty.** An approved booster may sign up as a booster for Normal, Heroic and Mythic Runs alike. This is a deliberate V1 product decision: BoostingHub does not manage "which difficulty is this booster allowed to boost?". Difficulty-specific booster qualification may be introduced later if it is operationally required.

**Run difficulty remains relevant** to Runs, raid contents, lockouts, weekly availability, signup display, rosters, Discord run posts, history and payouts. It simply is no longer part of the booster-approval question.

Qualification does **not** depend on Character, WoW Class, specialization, Character Role, Item Level, Account Role, or Raid Difficulty.

Self-service `requestAccess` is disabled (`BOOSTER_ACCESS_SELF_REQUEST_DISABLED`). Character pages show an **Apply via Discord** CTA (an external Discord destination; BoostingHub runs no ticket system) when `DISCORD_BOOSTER_TICKET_URL` is set.

## Two persistence models

### BoosterQualification (current, authoritative)

- Unique on `userId` — at most one row per User, no difficulty column
- Statuses: `APPROVED` | `REVOKED` (no `PENDING`); no row = never granted
- Grant / revoke / re-grant (reactivates the same row) are ADMIN-only
- Eligibility check: `boosterQualificationService.isApprovedBooster(qualification)`

### Legacy BoosterAccess (historical request history)

- Preserved rows: User + Class + Role + Difficulty (+ optional Character context)
- Statuses: `PENDING` | `APPROVED` | `REJECTED` | `REVOKED`
- The difficulty on a legacy row records what was requested at the time; it is kept for history and **never read for eligibility**
- `characterId` is request origin only (“Requested via Synblast-Antonidas”)

## Why qualification is separate from account role

Account roles (`USER`, `RAID_LEAD`, `ADMIN`, `OWNER`) are platform permissions; OWNER has every Admin permission, including Booster Access review.

Run participation (`BOOSTER`, `LOOTBUDDY`) is per-run.

`BoosterQualification` is account-level boosting eligibility. ADMIN does **not** automatically receive a qualification. A later `BOOSTER_ACCESS_MANAGER` permission may replace the current ADMIN-only review gate.

## Discord application + ADMIN grant

Current onboarding:

```text
User → Apply via Discord → staff review → ADMIN grant (User)
```

Grant UI fields: User, Notes (optional). No Difficulty / Character / Class / Role / Item Level / Spec. Users who are already approved boosters are not offered in the grant picker — revoke them from the list instead.

A User may receive access with **zero Characters**. Later Characters consume the account qualification.

ADMIN may grant to USER, RAID_LEAD, ADMIN, or themselves.

## Qualifications vs Legacy Requests

`/manage/booster-access` is ADMIN-only and has two views:

### Qualifications (default)

One current account-level state per User.

Columns: User · Booster (Approved / Revoked) · Granted by · Times · Actions (Revoke when approved)

Filters: User search, Status (`ALL` | `APPROVED` | `REVOKED`). There is no difficulty filter for qualifications.

### Legacy Requests · N

Unresolved historical `PENDING` in-app applications only.

May still show Class / Role / Requested difficulty / Character context because that is historical application data, and may be filtered by requested difficulty and role.

Helper meaning:

> These applications used the previous character/class/difficulty workflow. Approving one approves the user as a booster for every difficulty.

Approving a legacy PENDING row:

1. Marks that row and every other PENDING row of the same User `APPROVED` (account approval covers all of them); their recorded difficulty is not rewritten
2. Ensures the User's one account-level `BoosterQualification` is `APPROVED`

Rejecting one PENDING row does not create or revoke a qualification. Already reviewed (`REJECTED` / `REVOKED`) legacy rows are never rewritten by a later approval.

Empty legacy queue:

> No legacy requests awaiting review.

## Conceptual split

| Concern | Question |
| --- | --- |
| Qualification | Is this User an approved booster? |
| Character eligibility | May this Character be used in this Run? |
| Roster composition | Do we want this Character/role on the roster? |

Signup and roster revalidation read the signup User's **BoosterQualification** status only — never the Run difficulty. Character ownership, active state, valid role-for-class, weekly availability, cross-Run reservation, lockouts (informational), run/signup state and composition rules remain separate and unchanged. A non-approved (never granted or `REVOKED`) User is rejected with `NO_BOOSTER_ACCESS` / `BOOSTER_ACCESS_REQUIRED` on every difficulty; there is no difficulty-specific rejection.

## Surfaces

- Profile, `/characters`, Character detail, `/manage/characters/[id]`: one compact **Booster · Approved / Revoked / Not approved** state — no difficulty chips.
- `/manage/users`: Booster access column shows Approved / Revoked / None; filter Approved / Not approved.
- `/manage/users/[id]`: **Booster access** card with one state, Grant (when not approved) or Revoke (when approved).

## Management hub

Booster Access card metrics:

- Legacy pending — unresolved historical PENDING rows
- Approved qualifications — count of approved boosters (one per User)

## Migration / backfill

`20260910T1208_booster_qualification_difficulty` created the User + Difficulty table from approved legacy rows.

`20260927T1206_account_level_booster_qualification` collapses it to one row per User before adding the `(userId)` unique constraint and dropping the `difficulty` column:

- A User with **any** `APPROVED` row keeps one `APPROVED` row (the most recently granted one). No approved booster loses access because their approval named a difficulty.
- A User with only `REVOKED` rows keeps one `REVOKED` row (most recently revoked) — still not approved.
- Users with no rows stay without a qualification.
- Legacy `booster_access` history is not touched.

## Out of scope here

Discord bot automation, mass signup, Strikes, Deducts, difficulty-specific booster qualification.
