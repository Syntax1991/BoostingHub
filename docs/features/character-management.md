# Character management

## Purpose

Let an authenticated user create and manage their own World of Warcraft characters without seed data or Battle.net.

Manual CRUD is the current source of truth. A later `feature/blizzard-integration` branch should enrich the **same** Character rows, not introduce a second model.

## Ownership

A Character belongs to exactly one User.

All mutations take the owner from the authenticated session. Submitted `userId` is ignored.

Users cannot view details, edit, deactivate, or reactivate another account's characters. ADMIN does not bypass this self-service ownership in this feature.

Hidden UI is not authorization. Controllers call `CharacterService`, which loads the row and asserts `character.userId === session.user.id`.

## Character identity

Logical identity is owner-scoped:

- region
- realm
- character name

Display values keep the spelling the operator entered (after trim / realm whitespace collapse).

Duplicate detection uses canonical tokens:

- `normalizedName`
- `normalizedRealm`

Normalization is Unicode NFKC, trim, collapse internal whitespace, then case-fold with `en-US`. It is **not** accent-stripping: `Éowyn` and `Eowyn` stay different.

The database enforces uniqueness on:

`(userId, region, normalizedRealm, normalizedName)`

The same name may exist on another realm, another region, or another user's account.

Conflicts map to `CHARACTER_ALREADY_EXISTS`, not a raw unique-constraint error.

## Class / specialization / role

`WowClass` is an enum. The UI offers only catalog classes.

Specialization is a catalog string per class (for example Restoration Shaman, Protection Warrior). The server rejects combinations that are not in `src/lib/wow-specializations.ts`.

`primaryRole` is **derived** from specialization (`TANK` / `HEALER` / `DPS`). It is the character's default identity, not the only role they may ever perform.

`BoosterAccess` remains the approved run-participation capability and may grant additional roles later. A Restoration Shaman stays primary HEALER even if a future approval allows DPS boosting.

### Class edit policy

Class is **immutable after creation**.

Changing class while BoosterAccess and historical signups still point at the old class would corrupt eligibility history. Until Blizzard sync can correct class from game data, operators create a new character instead of editing class.

## Active lifecycle

New characters start `isActive = true`.

**Deactivate** sets `isActive = false`. It does not delete the row.

**Reactivate** sets `isActive = true`. It does not grant BoosterAccess, clear lockouts, or rewrite signups.

Inactive characters are excluded from **new** BOOSTER and LOOTBUDDY signup eligibility. Historical My Runs and roster rows stay visible.

Deactivating a character that already has future PENDING/SELECTED signups does **not** auto-withdraw those rows. That needs an explicit later lifecycle policy.

## Why no delete

Characters may be referenced by RunSignup, roster entries, BoosterAccess, and CharacterRaidLockout. Deleting them would damage historical integrity. Deactivation is the supported lifecycle.

## Booster access

Character details show existing BoosterAccess rows as read-only.

This feature does not implement self-approval, request workflows, or raid-lead editors.

A newly created character is **not** booster-eligible merely because it exists.

## Lockouts

Stored `CharacterRaidLockout` rows are read-only here. Operators cannot fabricate lockouts. Live Blizzard lockout sync is deferred.

## Manual data

Name, realm, region, specialization, and item level are operator-maintained. Item level is not presented as Blizzard-verified. `lastSyncedAt` is shown only when a real sync timestamp exists.

Refresh stays disabled: "Blizzard sync will be available in a later integration."

## Future Blizzard sync

The same Character record already has:

- `blizzardCharacterId`
- `lastSyncedAt`
- name / realm / region / class / specialization / item level

Sync should update those fields and keep `normalizedName` / `normalizedRealm` in lockstep with display identity.

## MVCS

- Model: `Character` plus `WowClass` / `WowRegion` / `CharacterRole`
- View: `/characters`, `/characters/[characterId]`, add/edit dialog, lifecycle buttons
- Controller: `characterController`, `character.actions.ts`
- Service: `characterService` (ownership, identity, spec/role, lifecycle)
- Repository: `characterRepository`

## Security

- Current user is session-derived
- Ownership is enforced in the service
- Duplicate identity is enforced in the service and the unique constraint
- Class/spec/role rules are enforced in the service
- Clients cannot forge BoosterAccess or lockouts through these actions

## Deferred

- Battle.net / Blizzard character import
- Warcraft Logs
- Booster Access approval management
- Automatic withdrawal of future signups on deactivate
- Admin global character editing
