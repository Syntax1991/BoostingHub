# Roster management

## Purpose

Let a **raid lead** or **admin** build a persistent draft roster for a run, validate it, and publish it. Publication writes final `RunSignup` statuses and moves the run to `PUBLISHED`.

This is internal operations tooling. It is not raid-group assignment, payouts, or attendance marking. Attendance after Start is documented in [run-lifecycle-attendance.md](run-lifecycle-attendance.md).

Canonical Run URL: `/runs/[runId]`. See [run-detail.md](run-detail.md). Run create/open/cancel: [run-management.md](run-management.md).

## Roles

| Account role | Roster access |
| --- | --- |
| `USER` | None. `/manage` redirects. Service mutations throw `RUN_NOT_MANAGEABLE`. |
| `RAID_LEAD` | Only runs where `user.id === run.raidLeadId`. |
| `ADMIN` | Every run. |

Account roles are not booster/lootbuddy identities. `BOOSTER` and `LOOTBUDDY` remain signup participation types.

## Run ownership

`canManageRun` / `assertCanManageRun` in `src/auth/authorization.ts` are the single ownership check.

- Being listed as `raidLeadId` does not grant a `USER` roster tools.
- A raid lead cannot roster another lead's run.
- Views do not re-implement this rule; they render data the service already authorized.

## Draft roster

Draft selection is **not** `RunSignup.status`. Card clicks must not immediately become public `SELECTED`.

The Roster Builder stages draft selection **locally**, including each BOOSTER's `selectedRole`. Clicking signup cards toggles the staged set without a server round-trip. **Save Roster** persists the full staged selections (`{ signupId, selectedRole }[]`) in one mutation (`saveDraftSelection` / `saveRosterDraftAction`), bumps `version` once, then refreshes. Composition, Class Buffs, and Validation continue to reflect the **saved** draft until that Save. Publish stays disabled while the staged set is dirty.

Each run has at most one `RunRoster` row:

- `state` is `DRAFT` until the first successful publish, then `PUBLISHED` even while a replacement draft is edited
- `version` increments on draft writes and on publish (stale clients get `ROSTER_ALREADY_CHANGED`)
- `publishedAt` / `publishedById` are set on successful publish

`RunRosterEntry` stores **currently draft-selected** signups (`selected = true`) plus the Raid Lead's final `selectedRole` for BOOSTER rows (null for LOOTBUDDY). Absence of a row means not draft-selected. Composition, Final Setup, Attendance display, and Discord picked counts use `selectedRole` — never the volunteered `offeredRoles`.

Chosen over a JSON blob or a `rosterDraftSelected` column because:

- drafts survive reload
- later group assignment can hang off the same roster row
- publication metadata is relational
- signup status stays the live published roster

Opening `/runs/[runId]` as a manager may create an empty `RunRoster` (`ensure`). A USER view does **not** call `ensure`. That does **not** change `RunStatus`. The first **saved** non-empty draft selection on an `OPEN` run transitions `OPEN → ROSTERING` without closing signups (`signupsOpen` stays independent). Local card clicks alone never change Run status.

## Roster entries

Draft rows point at `RunSignup`. The live roster after publish is still those signup rows:

| Signup status | Meaning |
| --- | --- |
| `PENDING` | Offer exists; no current published decision for this row |
| `SELECTED` | Part of the published roster |
| `NOT_SELECTED` | Considered and not on the published roster |
| `WITHDRAWN` | Player left before lock; never selected; never resurrected |

`isBackup` is still player intent, not a status. Backups may be draft-selected.

## One user rule (Booster-specific)

**At most one selected BOOSTER participation per user per run.**

Selecting a second BOOSTER signup for the same user **replaces** the previous BOOSTER draft row. Silent double booster slots are forbidden. The service enforces this; the database cannot, because the path is `RunRosterEntry → RunSignup.userId`.

The same User **may** hold one selected BOOSTER **plus** any number of selected LOOTBUDDY rows. Lootbuddy selections are never collapsed by `userId`.

If one BOOSTER character is `SELECTED`, the user's other active BOOSTER offers on that run become `NOT_SELECTED` on publish. Lootbuddy rows are decided independently per `RunSignup.id`.

## Roster lifecycle and lock point

- **Publish Roster** communicates the currently planned lineup. It does **not** freeze it.
- **`PUBLISHED`** stays editable until Start (UI: "Published · Editable until Start"): select or drop signups, change assigned roles, **Add Booster**, edit External Boosters, and **Edit Run** — the Run stays `PUBLISHED`.
- A published roster has **unpublished changes** (`roster-publish-state.ts` `hasUnpublishedRosterChanges`) when the saved draft differs from the live published roster (membership or assigned role) **or** a roster-relevant Run setting changed since it was last acknowledged (`RunRoster.runChangedSinceAck`, see [run-management.md](run-management.md#signup-history-does-not-freeze-the-run)). The primary action is then **Update Roster**. A freshly published roster, or a seeded draft identical to it, is clean.
- **Start Run** (`PUBLISHED → IN_PROGRESS`) is the authoritative freeze. Start is refused while there are unpublished changes ("Roster has unpublished changes. Update the roster before starting the Run.") so a replacement or a changed Run setting is never silently left unacknowledged. From `IN_PROGRESS` on the roster editor is read-only and every roster mutation (draft, roles, Add Booster, External Boosters, publish, repost) is rejected server-side.
- **Attendance Replace** (Attendance tab, `IN_PROGRESS` only) is the separate post-start operational substitution — it records a no-show and a replacement, it is not roster editing. See [run-lifecycle-attendance.md](run-lifecycle-attendance.md).

**Concurrency.** Every roster-writing transaction locks the `RunRoster` row first, re-reads its version and re-checks inside the transaction that the Run has not started. Start takes the same lock before it reads the published roster, so a concurrent Save / Update Roster / Publish Roster / Add Booster / Run edit either commits first (and is included, or makes Start refuse with unpublished changes) or waits and then fails because the Run is `IN_PROGRESS`.

## Add Booster (registered players)

**Add Booster** adds a **registered** player who did not sign up — typically a last-minute replacement. It is offered in the Run header (next to **External Boosters** / **Edit Run**) and in the Roster tab's Boosters card, to managers only, while the roster is editable (`OPEN` / `ROSTERING` / `PUBLISHED`). Flow: search a player (server-side, `ACTIVE` accounts, name or Discord username, max 10 results, only id / name / Discord username exposed) → choose one of their Characters → role → **Add to Roster**.

- The player is rostered as a normal **BOOSTER `RunSignup`** — never a `RunExternalBooster` — so My Runs, commitments, reservations, notifications, Discord, Final Setup, attendance and payout treat them like any pick.
- Same safeguards as a self-signup plus roster selection, no Raid Lead bypass, always against the **current** Run (difficulty, schedule, content): Character owned and active, Booster Access for the Run difficulty, a role the class can play, weekly availability, cross-Run reservation / schedule conflicts, one selected Booster per User (adding a second Character replaces the first slot), roster version. Only the signup window is not required. Lockouts stay informational.
- An existing active offer for that Character is reused (the assigned role is added to its offered roles if missing); otherwise a normal `PENDING` offer is created. A `WITHDRAWN` offer is never revived — the player has to sign up again.
- Atomic: the signup (reuse / role extension / creation) and the draft slot are written in one transaction with the Save Roster race checks and notifications (`rosterRepository.addManagedBoosterAtomic`). On any failure (version race, reservation race, withdrawal) nothing is left behind.
- Works directly on a legacy published roster whose draft was never seeded (`needsPublishSeed`): the same transaction first seeds the draft from the live published lineup (A, B, C keep their published roles) and then adds the new player (D). No separate "Edit Published Roster" step is needed and no published member is dropped.
- On a published roster the addition is a saved draft change, so the roster shows unpublished changes; **Update Roster** accepts it and edits the current Discord roster post.
- Disabled while the builder has unsaved local edits ("Save your current roster changes before adding a booster.") — it is a server mutation and must not overwrite an unsaved draft.
- Logged as Activity `ROSTER_PLAYER_ADDED`.
- Scope: registered **Boosters** only. Players without an account are added as **External Boosters** (header dialog, below); Lootbuddies are added via their own signup or as External lootbuddies.

## External boosters

Boosters who are **not registered** on the website (e.g. in-house helpers) are added by hand via the **External Boosters** button in the Run header (left of **Edit Run**, managers only, while the roster is editable: `OPEN` / `ROSTERING` / `PUBLISHED`). The dialog takes a name (usually their Discord name, a leading `@` is stripped), a WoW class and a **type**: **Booster** (plus a role the class can play) or **Lootbuddy** (class only, no role). Stored in `RunExternalBooster` (per `RunRoster`, `participationType` + nullable `role`).

- The dialog saves the full set on its own (`rosterService.saveExternalBoosters`, optimistic on the roster version) and bumps the roster version once; the page reloads, so unsaved Roster builder edits are lost. Save Roster from the builder leaves them untouched (`saveDraftSelection` without `externalBoosters`); seeding a replacement draft never touches them. After Start, use **Replace** on the Attendance tab instead.
- External boosters count toward the Tank/Healer/DPS composition, external lootbuddies toward the lootbuddy count; both count in the Class Buff Checker and never create validation blockers. External lootbuddies are listed with the lootbuddies everywhere (roster views, signup embed, Discord roster, Final Setup as `@name`). Replace after Start fills a lootbuddy slot with an external lootbuddy.
- **Live roster data, not draft data:** there is no separate published snapshot. Saving them while `PUBLISHED` changes the published roster (`getPublishedRosterView`) immediately, bumps the roster version (so the Discord roster post is edited) and is **not** an "unpublished change" — Start and the Final Setup use the current rows.
- Shown as `@name <class emoji>` (plain text, never a ping) in the signup embed's picked lists, the published Discord roster embed (DPS split melee/ranged by class), the Start Run preview and the Final Setup post.
- Not signups: no notifications/DMs, no attendance, payouts, strikes, lockouts or Raid Invites.
- Names allow letters, digits, space, `.`, `_`, `-` (max 32); `everyone`/`here` and markdown/mention syntax are rejected. Max 40 per roster.

## Composition

Targets come from the run (`desiredTankCount`, `desiredHealerCount`, `desiredDpsCount`), never hardcoded 2/4/14.

- Booster slots count by `RunRosterEntry.selectedRole` (`TANK` / `HEALER` / `DPS`)
- A multi-role Character selected once contributes to exactly one slot
- Lootbuddies (`LOOT_ONLY` and `PLAYING`) do **not** count as booster composition
- `PLAYING` has no assigned booster role, so it stays in the lootbuddy bucket

Mismatch is a **warning**, not an automatic hard block. A lead may draft 5/4 healers. Publish requires explicit acknowledgement when warnings exist. Blocking issues cannot be acknowledged away.

## Class Buff Checker

Derived composition helper on the Roster Builder (informational — never a publish blocker).

- **Source of truth:** current **draft** selection (`RunRosterEntry.selected === true`), not every signup.
- **Booster:** counts by `character.wowClass` when selected.
- **Lootbuddy (LOOT_ONLY and PLAYING):** counts by `lootbuddyClass ?? character?.wowClass` when selected (includes legacy Character-backed rows) — a loot-only Lootbuddy is still in the raid group and brings its class buff. (Discord signups always create `LOOT_ONLY` rows.)
- **External booster:** counts by its class.
- **Duplicates:** multiple Mages still cover Arcane Intellect once; provider detail retains every `signupId`.
- **Meaning:** class *availability* in the selected composition — not live aura cast / talent verification.
- **No persistence:** coverage is computed by `evaluateRaidBuffCoverage` in `roster-raid-buffs.ts`. No coverage tables or stored counts.

Tracked set (Midnight Season 2): Arcane Intellect, Power Word: Fortitude, Battle Shout, Mark of the Wild, Skyfury, Devotion Aura, Blessing of the Bronze, Chaos Brand, Mystic Touch, Hunter's Mark, plus Warlock utilities Healthstone / Soulstone / Demonic Gateway, plus Death Knight utilities Raise Ally / Death Grip. The roster UI lists **provider classes** (Mage, Priest, Hunter, Warlock, Death Knight, …), not buff spell names — one Warlock or Death Knight covers all of that class's tracked utilities as a single tile. Rogue remains untracked (no composition buff/utility in this set).

## Validation

`RosterService` + `validateRosterDraft` re-query authoritative rows. Client-supplied statuses and user IDs are ignored.

Blockers include:

- run not in `OPEN` / `ROSTERING` / `PUBLISHED` (including frozen `IN_PROGRESS` / `COMPLETED`)
- withdrawn selection
- inactive Character (BOOSTER and legacy Character-backed LOOTBUDDY only — characterless Lootbuddy is not inactive)
- booster qualification no longer approved (`BoosterQualificationService` — User + Run Difficulty; revoke is a publish blocker)
- two selected **BOOSTER** signups for one user

Raid lockouts remain informational only — never a publish blocker. Matching uses each Character's regional WoW reset containing `Run.scheduledStartAt` (not the Run date's ISO week alone). Verified `0/x` is Unsaved; no row is Unknown. `UNSAVED` and `VIP` share fresh-lockout attention presentation.
Warnings: composition under or over target.

Signup-time eligibility can rot before publish. Access and lockouts are therefore re-checked at publish.

## Run commitments (informational)

Roster Builder attaches `runCommitments: CharacterRunCommitment[]` to each BOOSTER card via a **batched** repository lookup (`listReservingCommitmentsByCharacterIds`), excluding the target Run.

| State | Meaning |
| --- | --- |
| `RESERVED` | Draft-selected on another upcoming Run; not yet published `SELECTED` |
| `COMMITTED` | Published `SELECTED` on another upcoming Run (`PUBLISHED` / `IN_PROGRESS`, etc.) |

UI: muted “Committed elsewhere” / “Reserved elsewhere” lines. Separately, existing `scheduleConflicts` keep warning styling and still gate new selection / publish.

Commitments are derived only — no persisted `safe` / `committed` flags. They disappear when the other Run completes/cancels, the draft deselects (for `RESERVED`), or a republish removes the published slot (for `COMMITTED`).

## Publication

The Roster tab shows exactly one primary path per state (`resolveRosterActions`, `src/components/manage/roster-actions.ts`):

| State | Actions | Discord |
| --- | --- | --- |
| Never published, local edits | **Save Roster** (+ Discard) | nothing — Save never posts |
| Never published, saved | **Publish Roster** — first authoritative publication | posts the first roster message (`postRevision 0 → 1`) |
| Published, local edits / saved changes / changed Run settings | **Update Roster** — ONE action: accepts the current selection as the published roster | edits the **current** roster message in place |
| Published, clean (`PUBLISHED` Run) | **Publish Roster** — explicit repost | sends a **new** roster message |

- **Update Roster** (`rosterService.updateRoster` → `rosterRepository.updatePublishedAtomic`) validates the submitted selection against the current Run, then writes it as the draft and publishes it in one transaction (same row lock / version check / pre-start check as Publish) and clears `runChangedSinceAck`. A refused Update changes nothing. There is no separate Save step on a published roster.
- **Publish Roster on a published roster** never changes membership, roles, statuses or notifications; it only requests a new Discord post. It is blocked while there are unpublished changes (Update first; `ROSTER_UNPUBLISHED_CHANGES`). The request is a compare-and-set on the expected roster `version` **and** the expected `RunRoster.postRevision` (`rosterRepository.requestRepostAtomic`): exactly one of two double-submitted requests advances `postRevision` to N + 1; the other fails with `ROSTER_ALREADY_CHANGED`. Logged as Activity `ROSTER_POSTED`.
- Previous roster messages stay in the channel as history and are no longer updated; the newest posted message becomes the current `rosterMessageId`, which later Updates edit.

The first publication, and Update Roster, run in one database transaction:
In one database transaction:

1. Draft-selected signups → `SELECTED`
2. Other non-withdrawn candidates → `NOT_SELECTED`
3. `WITHDRAWN` stays `WITHDRAWN`
4. Run `OPEN` → `ROSTERING` → `PUBLISHED`, or `ROSTERING` → `PUBLISHED`
5. Roster `state = PUBLISHED`, `version++`, `publishedAt`, `publishedById`, `runChangedSinceAck = false`; the first publication also sets `postRevision = 1` (the first post intent)
6. Activity `ROSTER_PUBLISHED` (first time) or `ROSTER_UPDATED` (republish)
7. `ROSTER_SELECTED` / `ROSTER_REMOVED` user notifications only for changes the player has not been told yet (see [user-notifications.md](user-notifications.md)). **Save Roster** already notifies (see below), so publishing a saved roster usually sends nothing new; Discord DM intent is snapshotted from preferences when the notification is created

**Save Roster notifies.** Saving the draft (`saveDraftSelection`) sends `ROSTER_SELECTED` to each selected player who was not already told they are in, and `ROSTER_REMOVED` to each player who was told they are in but is no longer selected (never to `WITHDRAWN` offers). What a player was last told is their latest `ROSTER_SELECTED`/`ROSTER_REMOVED` notification for that signup (ordered by the roster version in its `sourceKey`); signups without one fall back to their `SELECTED` status. Seeding a replacement draft from the published roster never notifies. **Character swap:** when a player's booster character is exchanged for another of their booster signups, they get one **Roster Update** DM with the new assignment (a `ROSTER_SELECTED` with a `roster-swapped:` source key, web title "Roster updated"); the old character's `ROSTER_REMOVED` is kept only as hidden bookkeeping state (`visibleInApp = false`, already read, no DM) so later saves/publishes don't announce a removal — it is not shown in the bell or on the Notifications page, doesn't count as unread and never sends a removal DM (a player holds at most one booster slot). Dropping the player with no replacement booster character is a normal, visible removal. Lootbuddy entries are still per entry: a Lootbuddy change is never treated as a character swap.

Self-withdrawal of a `SELECTED` signup on a `PUBLISHED` run remains forbidden (Phase 2 rule).

A published run may still receive **new** `PENDING` signups if `signupsOpen` and run status allow it. Those wait for a later republish.

## Republish

**Edit Published Roster** copies current `SELECTED` signups into the draft when the draft is still empty (`version === 1` and no entries). It does **not** revert signup statuses. Add Booster performs the same seed itself.

The published roster stays live until an Update succeeds. The lead may add a newly arrived `PENDING` offer, **Add Booster** for someone who never signed up, drop someone, change roles, and **Update Roster**. The Run stays `PUBLISHED`; Update Roster edits the current Discord roster post in place and only notifies players about actual changes.

`IN_PROGRESS` and `COMPLETED` runs reject draft mutation, publish, and republish. See [run-lifecycle-attendance.md](run-lifecycle-attendance.md).

## Security

- Current user comes from the session, not the client body
- `requireManagerOrRedirect` gates `/manage` and `/manage/runs`
- Canonical Run detail is `/runs/[runId]`; manager payload is omitted unless `canManageRun`
- `assertCanManageRun` gates every roster read/mutation
- Zod validates run/signup IDs and version only — not statuses or ownership
- Publish re-reads DB state and checks `version`

## MVCS

| Layer | Roster pieces |
| --- | --- |
| Model | `RunRoster`, `RunRosterEntry`, `RosterState` |
| View | `/manage/runs`, `/runs/[runId]` Roster tab, `roster-builder.tsx`. `/manage/runs/[runId]` redirects. |
| Controller | `managementController.getRosterPage`, `saveRosterDraftAction`, `prepareRosterEditAction`, `validateRosterAction`, `publishRosterAction` |
| Service | `RosterService`, `roster-composition`, `roster-validation`, plus `Run` / signup / access / lockout helpers |
| Repository | `RosterRepository` (Prisma stays here) |

## Deferred

- Raid groups 1–8, parties, markers, assignments
- Wallets / extra organizational cuts (see [run-payouts.md](run-payouts.md))
- Battle.net, Warcraft Logs, Discord bot (except roster notifications on Save Roster / publish; see [user-notifications.md](user-notifications.md))
- Customer bookings / boost market
- Per-user timezones
