# Run signups

## Purpose

Let a signed-in user persist a **booster** or **lootbuddy** signup for a specific run, offering one or more Characters. Participation type belongs to the signup, not the account. Web and Discord are both clients of the same domain — see [discord-bot.md](discord-bot.md).

## Character offers (multi-character signup)

Each `RunSignup` row is one offered Character — the schema needed no redesign to support this: the existing unique key `(runId, userId, characterId, participationType)` already allows a User to hold several rows for the same Run. `signupService.setCharacterOffers(actor, { runId, participationType, offers, lootbuddyMode?, lootbuddyVerification? })` is the single entry point for the whole desired offer-set, used by both the Web signup dialog and the Discord Signup/Lootbuddy buttons:

- **Set semantics, not additive.** The `offers` array is the complete desired set. Omitting a currently-offered Character withdraws it; a `WITHDRAWN` row matching a re-offered Character is reactivated in place rather than duplicated.
- **One active participation type per User + Run.** Switching from BOOSTER to LOOTBUDDY (or back) withdraws every active offer of the other type as part of the same atomic call.
- **All-or-nothing.** If any offered Character fails eligibility, or any removal is currently protected (see below), the whole call is rejected and nothing changes.
- **Role is a per-Character User choice, bounded by class — not fixed to specialization.** A Character's specialization only determines the *default* role a client should preselect for a fresh offer (`roleForSpecialization`); the User may offer it as any role its class can actually perform (`rolesForClass` / `isRoleValidForClass`). Every BOOSTER offer must carry an explicit `role` — the server never guesses one and never trusts one that the class can't perform (`INVALID_CHARACTER_ROLE`). See "Booster signup role" below.

Removal protection: a `PENDING` offer may always be withdrawn while lifecycle rules allow editing. An offer currently selected on the **Roster tab's draft** cannot be silently withdrawn (`SIGNUP_OFFER_ROSTER_SELECTED` — the raid lead must change the roster selection first). A `SELECTED` offer after `PUBLISHED` follows the existing self-withdraw lock (see Withdrawal below).

`signupService.cancelActiveOffers(actor, { runId })` withdraws the User's entire current active offer-set atomically — the domain behind a Discord "Cancel Signup" button — subject to the same protection rules.

## User flow (Web)

1. Add at least one character on `/characters` if the account has none.
2. Open `/runs` or `/runs/[runId]`.
3. Choose **Sign up** on an open run.
4. Pick Booster or Lootbuddy, then check every Character to offer (or **Select all eligible**). For Booster, checking a Character for the first time seeds its role dropdown with the specialization-derived default (never a guess, never the class's first role in enum order) — the User can change it to any role the class can perform before submitting.
5. Submit once. `setCharacterOffers` reconciles the whole set; rows are `PENDING`.
6. Review or edit on `/my-runs` or the Run detail Signups tab — reopening the dialog preselects the current active offer-set, including each Character's **persisted** role (which wins over the specialization default — the User's prior choice for this Run is never silently reverted).

## Booster signup role

A Character's specialization (`roleForSpecialization`) determines only the **default** role offered in the Web dialog and the Discord character-select label — never a restriction. The actual allowed set is everything the Character's *class* can perform (`rolesForClass` / `isRoleValidForClass`, in `src/lib/wow-specializations.ts`): e.g. a Mistweaver Monk defaults to Healer but may be offered as Tank or DPS; a Restoration Shaman defaults to Healer but may only be offered as Healer or DPS (Shaman cannot Tank). `RunSignup.role` is the only place the chosen role lives — offering a Character as a different role never mutates `Character.specialization` or `Character.primaryRole`.

The server requires an explicit `role` on every BOOSTER offer and validates it with `isRoleValidForClass`, rejecting anything the class genuinely cannot perform (`INVALID_CHARACTER_ROLE`) — it never re-derives or silently corrects a role from specialization. If a Character's specialization is missing or unrecognized, it stays eligible (never blocked for this reason alone) with no default role — the User must choose explicitly.

## Participation types

- `BOOSTER` — needs approved `BoosterQualification` for **this** run difficulty (User + Difficulty), plus character/lockout rules.
- `LOOTBUDDY` — needs an owned, active, lockout-free character. Does **not** require BoosterQualification.

The same user may be BOOSTER on one run and LOOTBUDDY on another.

## Booster signup

Required: run, user (server session), character, role, `isBackup`, status `PENDING`.

Eligibility (server, re-checked on submit):

1. Character belongs to the current user
2. Character is active
3. Approved BoosterQualification matches the User + **this** run difficulty (class/role are character validation, not qualification dimensions — an approved User may offer an eligible Character in any role its class can perform)
4. Offered role is valid for the character's class (`isRoleValidForClass`) — not restricted to the specialization-derived default
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

Role is stored on the booster row but is not a separate uniqueness dimension: one character can offer one BOOSTER signup per run. Different characters for the same user/run are allowed — that's exactly how one User's multiple offers are represented. The database key permits a BOOSTER row and a LOOTBUDDY row for the same character to coexist, but `setCharacterOffers` enforces the stronger **one active participation type per User + Run** rule at the service layer (see above) — a leftover row of the other type is always withdrawn, never left active, as part of any reconciliation.

Seeded run IDs use a `r` prefix (UUID-shaped, not RFC hex). Validators accept those operational IDs instead of `z.uuid()`.

## Counts

Run signup counts exclude `WITHDRAWN` rows. Selected counts are `SELECTED` only. The Discord signup embed's count is the number of **distinct Users** with an active signup, never the number of `RunSignup` rows — see [discord-bot.md](discord-bot.md).

## Architecture

- View: `/runs` dialog (multi-select), `/runs/[runId]` Signups tab (grouped by User), `/my-runs` (grouped by Run), dashboard upcoming signups
- Controller: `src/controllers/signup.actions.ts`
- Service: `signupService` (`setCharacterOffers`, `cancelActiveOffers`) + `signup-eligibility.ts` + `signup-state.ts` (`planCharacterOfferReconciliation`)
- Delegates: `BoosterAccessService`, `LockoutService`, `isSignupWindowOpen`
- Repository: `signup.repository.ts` (`applyOfferPlan` executes a reconciliation plan atomically, re-validating each row's status immediately before writing it)
- Model: `RunSignup`
- Discord: `src/discord-bot/*` calls the exact same `signupService` through `/api/bot/*` — see [discord-bot.md](discord-bot.md)

Requesting and reviewing access: [booster-access-management.md](booster-access-management.md).

## Deferred

Preferred/ranked Character among offers, wallets, escrow, extra organizational cuts. Completed-run settlement: see [run-payouts.md](run-payouts.md).
