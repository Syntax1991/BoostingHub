# Run signups

## Purpose

Let a signed-in user persist a **booster** or **lootbuddy** signup for a specific run. Participation type belongs to the signup, not the account.

## User flow

1. Add at least one character on `/characters` if the account has none.
2. Open `/runs` or `/runs/[runId]`.
3. Choose **Sign up** on an open run.
4. Pick Booster or Lootbuddy.
5. Submit. The row is stored as `PENDING`.
6. Review or withdraw (when allowed) on `/my-runs` or the Run detail Signups tab.

## Participation types

- `BOOSTER` — needs approved `BoosterQualification` for **this** run difficulty (User + Difficulty), plus character/lockout rules.
- `LOOTBUDDY` — needs an owned, active, lockout-free character. Does **not** require BoosterQualification.

The same user may be BOOSTER on one run and LOOTBUDDY on another.

## Booster signup

Required: run, user (server session), character, role, `isBackup`, status `PENDING`.

Eligibility (server, re-checked on submit):

1. Character belongs to the current user
2. Character is active
3. Approved BoosterQualification matches the User + **this** run difficulty (class/role are character validation, not qualification dimensions)
4. Selected role is valid for the character's class
5. No progress lockout for character + raid + difficulty + reset
6. Run signup window is open (`OPEN` or `ROSTERING` **and** `signupsOpen`)
7. No active duplicate for run + user + character + BOOSTER

`DRAFT` runs are not listed on `/runs` and are not signable. Opening a draft is a Run Management action. See [run-management.md](run-management.md).

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

- View: `/runs` dialog, `/runs/[runId]` Signups tab, `/my-runs` groups, dashboard upcoming signups
- Controller: `src/controllers/signup.actions.ts`
- Service: `signupService` + `signup-eligibility.ts` + `signup-state.ts`
- Delegates: `BoosterAccessService`, `LockoutService`, `isSignupWindowOpen`

Requesting and reviewing access: [booster-access-management.md](booster-access-management.md).

## Deferred
- Repository: `signup.repository.ts`
- Model: `RunSignup`

## Deferred

Still deferred: wallets, escrow, extra organizational cuts. Completed-run settlement: see [run-payouts.md](run-payouts.md).
