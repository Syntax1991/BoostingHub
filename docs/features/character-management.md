# Character management

## Purpose

Let an authenticated user create and manage their own World of Warcraft characters without requiring seed data.

Add Character resolves Class and Item Level from Blizzard's public Character Profile — the owner supplies Region/Realm/Name and chooses a specialization only. Optional Battle.net account integration (OAuth-backed, ownership-verified) enriches the **same** Character rows (import, link, item-level refresh). It does not introduce a second character model. See [blizzard-integration.md](blizzard-integration.md).

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

When linked, Blizzard identity is additionally scoped as `(region, blizzardRealmId, blizzardCharacterId)`.

## Class / specialization / role

`WowClass` is an enum. The UI offers only catalog classes.

Specialization is a catalog string per class (for example Restoration Shaman, Protection Warrior). The server rejects combinations that are not in `src/lib/wow-specializations.ts`.

`primaryRole` is **derived** from specialization (`TANK` / `HEALER` / `DPS`). It is the character's default identity, not the only role they may ever perform.

`BoosterAccess` remains the approved run-participation capability and may grant additional roles later. A Restoration Shaman stays primary HEALER even if a future approval allows DPS boosting.

On Battle.net import, Blizzard active specialization is a **prefill only**. After create, specialization stays BoostingHub-owned; Refresh does not overwrite it.

### Class edit policy

Class is **immutable after creation**.

Changing class while BoosterAccess and historical signups still point at the old class would corrupt eligibility history. Operators create a new character instead of editing class. Linked Refresh refuses if Blizzard reports a different class.

## Active lifecycle

New characters start `isActive = true`.

**Deactivate** sets `isActive = false`. It does not delete the row.

**Reactivate** sets `isActive = true`. It does not grant BoosterAccess, clear lockouts, or rewrite signups.

Inactive characters are excluded from **new** BOOSTER and LOOTBUDDY signup eligibility. Historical My Runs and roster rows stay visible.

Deactivating a character that already has future PENDING/SELECTED signups does **not** auto-withdraw those rows. That needs an explicit later lifecycle policy.

## Why no delete

Characters may be referenced by RunSignup, roster entries, BoosterAccess, and CharacterRaidLockout. Deleting them would damage historical integrity. Deactivation is the supported lifecycle.

## Booster access

Character list/detail show **matching account** BoosterAccess for that Character's class (derived display). Approvals are owned by the User account (`userId + class + role + difficulty`), not by the Character row.

Owners may open a request from a Character page; the Character supplies class/role context only. ADMIN review lives in [booster-access-management.md](booster-access-management.md).

A newly created or imported character is **not** booster-eligible merely because it exists or is linked to Battle.net. It immediately reuses any existing matching account approval.

## Lockouts

Stored `CharacterRaidLockout` rows are read-only here. Operators cannot fabricate lockouts. Live Blizzard lockout sync is deferred.

## Blizzard authority vs BoostingHub ownership

Two distinct Blizzard reads exist, and only one proves account ownership:

| Read | Used by | Proves ownership? |
| --- | --- | --- |
| Public Character Profile (`profile/wow/character/...`, client-credentials) | Add Character lookup, best-effort enrichment | No — only that the character exists |
| Account Profile (`profile/user/wow`, user OAuth) | Battle.net import/link | Yes |

For every Character, regardless of which path created or touched it: **Blizzard is authoritative for Class and equipped Item Level**. The owner never enters either value. Item level is `null` ("Unknown") when Blizzard has not supplied one — never a manual fallback, never `0`. Specialization is always BoostingHub-owned; Blizzard's active specialization is only a prefill suggestion.

Add Character (Region/Realm/Name → Blizzard lookup → owner picks specialization) does not require a Battle.net connection and does not mark the Character as Blizzard-linked (`blizzardCharacterId` stays unset) — a public lookup is not proof of ownership. If the owner later connects and imports the real Battle.net account, a matching Character is offered as `link` rather than duplicated.

Blizzard-linked characters (via Battle.net import/link) additionally support Refresh, which pulls the latest `equipped_item_level` and may apply a safe rename. A refresh that reads a valid profile but gets no item level back retains the character's last known value rather than clearing it or failing the whole refresh. `lastSyncedAt` is set when a profile sync succeeds. Realm transfer is not applied automatically. Refresh is available only when Battle.net is configured, the matching regional connection exists, and the Character is linked.

Full connect/import/link/security policy: [blizzard-integration.md](blizzard-integration.md).

## MVCS

- Model: `Character` plus `WowClass` / `WowRegion` / `CharacterRole`; Blizzard fields on the same row
- View: `/characters`, `/characters/[characterId]`, add/edit dialog, lifecycle buttons, Battle.net panels, Refresh
- Controller: `characterController`, `character.actions.ts`, `blizzard.actions.ts`
- Service: `characterService` (ownership, identity, spec/role, lifecycle), `characterBlizzardService` (import/link/refresh)
- Repository: `characterRepository`

## Security

- Current user is session-derived
- Ownership is enforced in the service
- Duplicate identity is enforced in the service and the unique constraint
- Class/spec/role rules are enforced in the service
- Class and item level can never be client-supplied: `createCharacterSchema` / `updateCharacterSchema` have no such fields, and the server re-resolves both from Blizzard before persisting
- Clients cannot forge BoosterAccess or lockouts through these actions
- Battle.net OAuth tokens are never persisted; see [blizzard-integration.md](blizzard-integration.md)

## Deferred

- Blizzard lockout sync and automatic realm-transfer handling
- Warcraft Logs
- Automatic withdrawal of future signups on deactivate
- Admin global character editing
