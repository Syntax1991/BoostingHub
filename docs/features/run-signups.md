# Run signups

## Purpose

Let a signed-in user persist **Booster** and/or **Lootbuddy** participation for a specific run. Participation type belongs to the signup row, not the account. A User may hold Booster and any number of Lootbuddy entries on the **same** Run simultaneously. Web and Discord are both clients of the same domain — see [discord-bot.md](discord-bot.md).

## Signup window lifecycle

Authoritative helper: `isSignupWindowOpen(status, signupsOpen)` (`SIGNUP_WINDOW_STATUSES` in `run-state.ts`).

| Run status | Signup registration |
| --- | --- |
| `DRAFT` | Closed |
| `OPEN` | Available when `signupsOpen = true` |
| `ROSTERING` | Available when `signupsOpen = true` |
| `PUBLISHED` | Available when `signupsOpen = true` |
| `IN_PROGRESS` | Closed |
| `COMPLETED` | Closed |
| `CANCELLED` | Closed |

Publishing a roster does **not** close signup registration. Late signups remain `PENDING` until the Raid Lead explicitly updates the roster. The Raid Lead may still manually close/reopen signups on `OPEN` / `ROSTERING` / `PUBLISHED`. **Start Run** is the lifecycle freeze point and atomically sets `signupsOpen = false`.

## Participation identity

Where multiplicity matters, identity is `RunSignup.id` — not `userId`, not class, not class+mode, and not `characterId`.

## Booster offers (Character-backed)

Each BOOSTER `RunSignup` row is one offered Character. Unique key `(runId, userId, characterId, participationType)` allows several BOOSTER Characters per User+Run.

`signupService.setCharacterOffers(actor, { runId, offers })` is **BOOSTER-only**:

- **Set semantics, not additive.** The `offers` array is the complete desired BOOSTER set. Omitting a currently-offered Character withdraws it; a `WITHDRAWN` row matching a re-offered Character is reactivated in place rather than duplicated.
- **Never touches Lootbuddy rows.** Updating Booster offers must not withdraw Lootbuddies.
- **All-or-nothing.** If any offered Character fails eligibility, or any removal is protected, the whole call is rejected.
- **Role is a per-Character User choice, bounded by class — not fixed to specialization.** See "Booster signup role" below.

Removal protection: a `PENDING` offer may always be withdrawn while lifecycle rules allow editing. An offer currently selected on the **Roster tab's draft** cannot be silently withdrawn (`SIGNUP_OFFER_ROSTER_SELECTED`). A `SELECTED` offer after `PUBLISHED` follows the existing self-withdraw lock.

`signupService.cancelBoosterSignup(actor, { runId })` withdraws the User's entire active BOOSTER set — never Lootbuddies.

### Quick Signup (Booster-only accelerator)

`signupService.quickSignupBoosters(actor, { runId })` adds every **currently eligible** Booster Character that has a non-null specialization `defaultRole`, using `offeredRoles: [defaultRole]`.

**Product rule:** Quick Signup offers all of your eligible Booster characters. Saved characters and characters used in non-conflicting runs are included. Characters marked unavailable or reserved for a conflicting run are skipped.

- **Additive.** Existing active Booster offers (and their `offeredRoles`) are preserved unchanged — including draft-selected and published `SELECTED` rows. Quick Signup never withdraws and never overwrites roles.
- **Same eligibility authority** as the Signup dialog (`evaluateBoosterOptions` via `withSignupEligibilityContext` / reservation collision). Raid lockouts / saved progress remain informational only (`contentSaves`) — a saved Character is still added when otherwise eligible. A mere `PENDING` offer on another Run does **not** reserve the Character.
- **Conflicting reservation only.** A Character is skipped for scheduling when it is draft-selected or `SELECTED` on another upcoming Run whose start is **strictly less than** 2 hours from this Run (`CROSS_RUN_RESERVATION_MIN_GAP_MS`). Exactly 2 hours apart is allowed.
- **Weekly unavailable / inactive.** Deliberate Character weekly unavailability and inactive Characters are hard skips (same as manual eligibility).
- **No role guessing.** Characters with `defaultRole: null` (missing/unrecognized specialization) are skipped by Quick Signup only; the User can still add them manually and choose a role.
- **Server-side merge.** The current active Booster offer set is loaded at execution time — the client does not supply a complete desired set — so a stale client cannot wipe existing offers. Idempotent: a second click with no state change adds 0. Race safety: `validateOfferedCharacters` then `applyOfferPlan`'s transactional `queryReservationConflicts` re-check before create/reactivate.
- **Result breakdown.** `added`, `alreadySigned`, `skippedNoDefaultRole`, `skippedUnavailable`, `skippedReservationConflict`, `skippedInactive`, plus additive `skippedIneligible`.
- **Never touches Lootbuddies.**
- Works for Normal / Heroic / Mythic and for Saved / Unsaved / VIP / Community alike (`MYTHIC + SAVED` remains invalid at Run level).

**UI placement:** Discord Signup embed only (**Quick Signup** button). Web keeps manual Booster Character selection + **Save Booster Offers**; it does not expose Quick Signup. The domain service is shared application logic.

## Lootbuddy entries (characterless)

New Lootbuddy signups do **not** require a Character under `/characters`. Required fields:

- `lootbuddyClass` (`WowClass`)
- `lootbuddyMode` (`LOOT_ONLY` → "Loot only" | `PLAYING` → "Play along")
- optional `lootbuddyVerification` (`NONE` | `ACCESS` | `TRIAL`) — metadata, not an approval workflow

`characterId` is `null` for new rows. Do not create fake Character rows.

`signupService.setLootbuddies(actor, { runId, lootbuddies })` reconciles the desired Lootbuddy set by `signupId`:

- `signupId` present → retain/update that owned row
- `signupId` absent → create a new row (always insert; never revive by natural key)
- active Lootbuddy omitted from the desired set → withdraw (subject to roster/lifecycle protection)
- **Never touches Booster rows**

Identical Class+Mode pairs are allowed as two distinct `RunSignup` ids.

### Legacy Character-backed Lootbuddy

Historical rows may have `participationType = LOOTBUDDY`, `characterId != null`, `lootbuddyClass = null`. They remain readable. Display class fallback:

```text
signup.lootbuddyClass ?? signup.character?.wowClass ?? null
```

No destructive backfill.

## Coexistence

On one Run, a User may simultaneously have:

- one Booster participation (the selected/offered Booster Character workflow), and
- zero to N Lootbuddy participations

Updating one side never clears the other. Removing one Lootbuddy does not affect Booster or other Lootbuddies. Web **Cancel Booster** (`cancelBoosterSignup`) does not remove Lootbuddies. Discord **Cancel Signup** (`cancelActiveSignups`) withdraws both Booster and Lootbuddy. Clearing all Lootbuddies does not remove Booster.

## User flow (Web)

1. Open `/runs` or `/runs/[runId]` → **Sign up**.
2. **Booster** section (optional): select Characters + roles. Requires owned active Characters and the account-level Booster role (`User.isBooster`, any run difficulty). For one-click all-eligible signup, use Discord **Quick Signup** instead.
3. **Lootbuddies** section (optional, independent): add N entries with Class + Mode. No Character selector. Zero-character Users may still sign as Lootbuddy.
4. Save each section separately (`setCharacterOffers` / `setLootbuddies`).
5. Review on `/my-runs` or the Run detail Signups tab — both participation types can appear for the same Run.

## Booster offered roles vs selected role

These are different domain facts:

| Concept | Storage | Meaning |
| --- | --- | --- |
| **Offered roles** | `RunSignupRole` (`RunSignup.offeredRoles`) | Roles the Booster volunteers this Character can play for this Run (1+) |
| **Selected role** | `RunRosterEntry.selectedRole` | The single final role the Raid Lead assigns in the roster |

A Character's specialization (`roleForSpecialization`) determines only the **default** hint in Web/Discord — never a restriction. The allowed offered set is everything the Character's *class* can perform (`rolesForClass` / `isRoleValidForClass`). Offering roles never mutates `Character.specialization` or `Character.primaryRole`.

`setCharacterOffers` takes `{ characterId, offeredRoles: CharacterRole[] }` (deterministic order TANK → HEALER → DPS, ≥1, class-validated). One Character remains one `RunSignup` row even when volunteering multiple roles.

If a signup is already draft-selected with `selectedRole = X` and the Booster removes `X` from offered roles, the offer update is **rejected** — the Raid Lead must change the roster first.

## Participation types

- `BOOSTER` — Character-backed. Needs the owner's Booster role (`User.isBooster`, not scoped by run difficulty), plus character/lockout/reservation rules.
- `LOOTBUDDY` — Class + Mode. Does **not** require a Character for new signups. Does **not** require the Booster role, and is not gated by the Lootbuddy role (`User.isLootbuddy` is management/display only).

## Booster signup eligibility

Required: run, user (server session), character, role, `isBackup`, status `PENDING`.

1. Character belongs to the current user
2. Character is active
3. The User holds the Booster role (`User.isBooster`, valid for every run difficulty)
4. Offered role is valid for the character's class
5. Progress lockouts are informational only (never a hard blocker at signup). Target reset is the Character region's regional WoW reset window containing `Run.scheduledStartAt` (`lockoutService.getResetIdentifierForRun`). Verified `0/x` is Unsaved; missing row is Unknown. `UNSAVED` and `VIP` share fresh-lockout attention presentation.
6. Run signup window is open (`OPEN` / `ROSTERING` / `PUBLISHED` **and** `signupsOpen`)
7. No active duplicate for run + user + character + BOOSTER
8. Cross-run Character reservation (BOOSTER only): a Character that is **draft-selected** or **SELECTED** on another upcoming Run blocks reuse when that Run's `scheduledStartAt` is **less than 2 hours** from the target Run's start (`Math.abs(Δt) < 2h`). Exact **2 hours or more** is allowed. Comparison is symmetric on absolute start timestamps — there is **no** Run-duration / end-time model. Same-Run self-edits are excluded. Mere PENDING offers (not draft-selected / SELECTED) do not reserve. Characterless Lootbuddies are unaffected. Raid lockouts remain informational and never hard-block.

### Run commitment vs schedule conflict

These are separate derived projections:

| Concept | Question | Blocks selection / publish? |
| --- | --- | --- |
| **Run commitment** | Is this Character already draft-selected or published SELECTED on another upcoming BoostingHub Run? | **No** — informational only (`RESERVED` / `COMMITTED`). Roster UI: **Draft roster** (danger) / **Published roster** (warning). |
| **Schedule conflict** | Does another reserving Run violate the 2-hour start gap (or weekly unavailability)? | **Yes** — existing blocker semantics (strong danger alert in Roster Builder) |

A Character may be committed elsewhere with **no** schedule conflict (e.g. other Run ≥ 2h away). Roster Builder still shows the commitment so Raid Leads see context without inventing a broader blocker.

Commitment authority reuses the same reserving predicate as reservation (draft-selected **or** `SELECTED`). `COMPLETED` / `CANCELLED` Runs do not hold commitments. While a published Run has a replacement draft being edited, the live `SELECTED` row remains `COMMITTED` until a successful republish.

## Lootbuddy signup eligibility

Required: `lootbuddyClass`, `lootbuddyMode`. Character optional (legacy only).

- No `/characters` requirement for new entries
- Signup window must be open when creating/reactivating entries
- Protected roster-selected / published-locked rows cannot be illegally withdrawn (atomic reject)

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

Prefer clear actions: **Cancel Booster Signup**, **Remove/Edit Lootbuddies** via `setLootbuddies`. Per-row withdraw remains available where lifecycle allows.

### Picked players withdraw with a reason

A **picked** signup (`SELECTED` on the published roster, or in the saved roster draft — see `isPickedSignup`) can withdraw only with a **reason** (3–300 chars), and only until the Run starts (`OPEN` / `ROSTERING` / `PUBLISHED`). After Start Run the Raid Lead replaces no-shows instead.

- Web: the signup's **Withdraw** button asks for the reason (`canWithdrawWithReason` → `withdrawPickedSignupAction`). A plain withdraw of a picked row answers `WITHDRAW_REASON_REQUIRED` and the button switches to the reason form. All other withdrawal paths (offer edit, Cancel Booster, Lootbuddy edit) still refuse picked rows.
- Discord: **Cancel Signup** opens a reason modal for a picked User (see [discord-bot.md](discord-bot.md)).
- Effect (one transaction, `withdrawPickedSignupAtomic`): signup → `WITHDRAWN` with `withdrawReason` stored, its roster entry removed (slot free), roster version bumped (Discord signup/roster posts refresh), and a `ROSTER_WITHDRAWN` notification to the Run's Raid Lead with the reason and a link to the Roster tab (web + Discord DM; master DM toggle and Quiet Hours apply). The player gets no "removed" DM.
- Re-offering the same Character later clears the old `withdrawReason`.

## Duplicate rules

Unique key: `(runId, userId, characterId, participationType)`.

PostgreSQL treats `NULL` `characterId` values as distinct for uniqueness, so multiple characterless LOOTBUDDY rows for the same User+Run are allowed.

Role is stored on the booster row but is not a uniqueness dimension.

## Counts

Run signup counts exclude `WITHDRAWN` rows. Selected counts are `SELECTED` only. The Discord signup embed's count is the number of **distinct Users** with an active signup, never the number of `RunSignup` rows — see [discord-bot.md](discord-bot.md).

## Architecture

- View: `/runs` dialog (independent Booster + Lootbuddy sections; manual Booster offers), `/runs/[runId]` Signups tab, `/my-runs`
- Controller: `src/controllers/signup.actions.ts` (`setCharacterOffersAction`, `setLootbuddiesAction`, …)
- Service: `signupService` (`setCharacterOffers`, `quickSignupBoosters`, `setLootbuddies`, `cancelBoosterSignup`) + `signup-eligibility.ts` + `signup-state.ts` (`planCharacterOfferReconciliation`, `planLootbuddyReconciliation`)
- Repository: `signup.repository.ts` (`applyOfferPlan`, `applyLootbuddyPlan`)
- Model: `RunSignup` (`lootbuddyClass` optional; `characterId` nullable)
- Discord: `src/discord-bot/*` via `/api/bot/*` — see [discord-bot.md](discord-bot.md). **Quick Signup** is Discord-only UI (`POST /api/bot/runs/:runId/signup/quick` → `quickSignupBoosters`); resulting rows are normal Booster offers.

Granting and revoking the Booster role: [boosting-roles.md](boosting-roles.md).

## Deferred

Preferred/ranked Character among offers, wallets, escrow, extra organizational cuts, User-level time-window collision for characterless Lootbuddy. Completed-run settlement: see [run-payouts.md](run-payouts.md).
