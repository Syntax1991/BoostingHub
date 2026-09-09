# Run signups

## Purpose

Let a signed-in user persist a **booster** or **lootbuddy** signup for a specific run. Participation type belongs to the signup, not the account.

## User flow

1. Add at least one character on `/characters` if the account has none.
2. Open `/runs`.
3. Choose **Sign up** on an open run.
4. Pick Booster or Lootbuddy.
5. Submit. The row is stored as `PENDING`.
6. Review or withdraw (when allowed) on `/my-runs`.

## Participation types

- `BOOSTER` — needs approved `BoosterAccess` for class + role + run difficulty, plus no conflicting lockout.
- `LOOTBUDDY` — needs an owned, active, lockout-free character. Does **not** require BoosterAccess.

The same user may be BOOSTER on one run and LOOTBUDDY on another.

## Booster signup

Required: run, user (server session), character, role, `isBackup`, status `PENDING`.

Eligibility (server, re-checked on submit):

1. Character belongs to the current user
2. Character is active
3. Approved BoosterAccess matches class, role, and **this** difficulty
4. No progress lockout for character + raid + difficulty + reset
5. Run signup window is open (`OPEN` or `ROSTERING` **and** `signupsOpen`)
6. No active duplicate for run + user + character + BOOSTER

Backup is `isBackup`, not a signup status.

Multiple characters may be offered for one run. Exact duplicates are rejected. A `WITHDRAWN` row for the same combination is revived instead of inserting a second record.

## Lootbuddy signup

Required: character, `lootbuddyMode` (`LOOT_ONLY` | `PLAYING`), `lootbuddyVerification` (`NONE` | `ACCESS` | `TRIAL`).

- Lockouts still apply: loot is character-specific.
- `PLAYING` does **not** add a hidden BoosterAccess check in Phase 2. Roster review can tighten this later.
- Access/Trial is metadata, not an authorization system.

## Signup lifecycle

Independent of run status.

| Status | Meaning |
| --- | --- |
| `PENDING` | Player offer, waiting for roster |
| `SELECTED` | Roster outcome (not player-chosen) |
| `NOT_SELECTED` | Roster outcome, kept as history |
| `WITHDRAWN` | Player left the offer; row remains |

## Withdrawal

Computed by `canSelfWithdrawSignup` in `signup-state.ts`. The view only renders the button when the service says `canWithdraw`.

- Own `PENDING` signup: withdrawable while the run is not completed/cancelled
- Own `SELECTED` signup: withdrawable only **before** `PUBLISHED` / `IN_PROGRESS` / `COMPLETED`
- `NOT_SELECTED` and `WITHDRAWN`: not self-withdrawable
- Another user's signup: `NOT_AUTHORIZED`

## Duplicate rules

Unique key: `(runId, userId, characterId, participationType)`.

Role is stored on the booster row but is not a separate uniqueness dimension: one character can offer one BOOSTER signup per run. Different characters for the same user/run are allowed. The same character as BOOSTER and LOOTBUDDY is allowed.

Seeded run IDs use a `r` prefix (UUID-shaped, not RFC hex). Validators accept those operational IDs instead of `z.uuid()`.

## Counts

Run signup counts exclude `WITHDRAWN` rows. Selected counts are `SELECTED` only.

## Architecture

- View: `/runs` dialog, `/my-runs` groups, dashboard upcoming signups
- Controller: `src/controllers/signup.actions.ts`
- Service: `signupService` + `signup-eligibility.ts` + `signup-state.ts`
- Delegates: `BoosterAccessService`, `LockoutService`, `isSignupWindowOpen`

Requesting and reviewing access: [booster-access-management.md](booster-access-management.md).

## Deferred
- Repository: `signup.repository.ts`
- Model: `RunSignup`

## Deferred

Roster selection and publication: see [roster-management.md](roster-management.md). Still deferred: attendance, payouts.
