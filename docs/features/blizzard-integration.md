# Battle.net integration

## Purpose

Optionally connect a BoostingHub account to Battle.net so the owner can import or link World of Warcraft characters and refresh item level from Blizzard profile data.

Discord remains login. Battle.net is a secondary game-account connection, not a second identity provider for the app session.

## Discord vs Battle.net

| Concern | Discord | Battle.net |
| --- | --- | --- |
| App login / session | Yes (Better Auth) | No |
| Account role / status | Yes | No |
| Regional WoW account link | No | Yes (`userId` + `EU` \| `US`) |
| Owned-character enumeration | No | Yes (`GET /profile/user/wow`) |
| BoosterAccess | Unrelated | Unrelated |

A user may connect EU, US, both, or neither. Manual character CRUD still works without any Battle.net connection.

## Regional connection

`BattleNetConnection` is unique on `(userId, region)`.

Why regional: Blizzard OAuth and profile namespaces are region-scoped. One BattleTag can cover both regions as separate connections; disconnecting EU must not remove the US link.

The connection stores Battle.net account id, optional BattleTag, granted scope, `connectedAt`, and `lastSuccessfulSyncAt`. It does **not** store OAuth tokens.

## Ephemeral user OAuth token policy

User authorization-code tokens are exchanged in the callback stack frame, used to:

1. Read Battle.net user info
2. Enumerate owned characters for that region

Then they are dropped. They are never written to `BattleNetConnection`, `BattleNetImportSession`, cookies, or activity payloads.

Character profile status and summary after connect use **client-credentials** tokens (app-level, cached in memory only). That avoids persisting user refresh tokens while still allowing Refresh on linked characters.

## Import session

After a successful OAuth callback, BoostingHub creates a `BattleNetImportSession`:

- Owned-character snapshot as JSON (ids, names, realms, class, level)
- ~15 minute TTL
- No OAuth tokens
- Client may only select characters present in that snapshot

Why a session: the owned list must be authoritative for import/link so the UI cannot invent Blizzard character ids. When it expires, the user reconnects to refresh the list.

## Owned character enumeration

During the user OAuth callback only:

```text
GET /profile/user/wow  (regional host + profile namespace)
```

That response is the source of owned candidates for the import session. Later Refresh does not re-enumerate the account; it loads one linked character profile via client credentials.

## Scoped Blizzard identity

A linked Character stores:

- `blizzardCharacterId`
- `blizzardRealmId`
- `region` (already on the Character)

Scoped uniqueness is `(region, blizzardRealmId, blizzardCharacterId)`. Multiple unlinked (NULL) Characters remain allowed.

Why not a single global GUID alone: Blizzard character id is realm-scoped in practice and can change meaning across transfers. Region + realm id + character id is the stable link BoostingHub enforces.

## Import and link flows

Entry: `/characters` when Blizzard env vars are configured.

1. Owner chooses region and starts connect → `GET /api/integrations/battlenet/connect?region=EU|US`
2. Battle.net OAuth completes → `GET /api/integrations/battlenet/callback`
3. Connection upserted; import session opened; redirect back to `/characters` with session id
4. Service resolves each owned row to a candidate status:
   - `import` — create a new Character
   - `link` — attach Blizzard ids to an existing same-owner name/realm/region/class match
   - `already_linked` — already on this account
   - `conflict` — owned by another account, class mismatch, or already linked elsewhere

Import creates the Character with Blizzard ids. Link only stamps Blizzard identity (and may update item level when the profile is available). Mixed import/link selections submit in one server action; the service resolves classification server-side from the import session.

Character selection happens in a **modal** on `/characters`. The page itself only shows compact regional Battle.net connection cards (Connect / Reconnect / Import / Disconnect / **Refresh all** when connected). Import opens the dialog when a live import session exists for that region; otherwise Import starts OAuth reconnect to refresh ownership.

The import modal supports presentation-only **Item Level** sorting (header toggle: descending first, then ascending). Unknown item levels sort last in both directions.

**Refresh all** refreshes only the current user's active Blizzard-linked characters in that region, with bounded concurrency (~4), per-character cooldown skips, and partial-success semantics. It updates item level / safe rename / lastSyncedAt and, when current-raid encounters map successfully, verified current-reset `CharacterRaidLockout` rows. Aggregate messaging distinguishes profiles refreshed, lockouts verified, and lockouts unavailable. It never updates specialization, primaryRole, or BoosterAccess.

Missing or stale (wrong `resetIdentifier` / non-current raid) CharacterRaidLockout rows display as **Unknown** on `/characters` (not "Clear"). A difficulty mode present with zero current-reset kills displays as **0/N**. A tracked difficulty absent from the Blizzard response displays as **?** (unknown), never invented 0/N.

Disconnect clears the regional connection and import sessions. It does **not** delete Characters, signups, lockouts, or history.

## Specialization and item level

Specialization from Blizzard is an **import-time prefill**. The import modal always lets the owner choose (or confirm) a specialization from the BoostingHub class/spec catalog before Continue. After create/link, specialization and `primaryRole` stay BoostingHub-owned. Refresh does not rewrite specialization.

Battle.net import/link requires character **level ≥ 90** (`MIN_IMPORT_CHARACTER_LEVEL`). Lower-level owned characters remain visible in the import modal as `level_too_low` / “Requires level 90”, but are not selectable. Manual Add Character is unchanged by this rule.

Item level uses Blizzard `equipped_item_level` when the public profile is available (authoritative; client overrides are ignored). When the profile is unavailable, a validated manual item level is required and `lastSyncedAt` stays unset. Refresh updates **item level** (and may apply a safe rename — see below). It does not auto-change class, realm, or specialization.

## Privacy / profile unavailable

Some characters appear in the account list but have private or invalid public profiles.

The owned-character candidate list on `/characters` is DB-only (import-session snapshot + local match status). Live public-profile enrichment runs only at import, link, or refresh — never while rendering the page — so a large account cannot stall the app shell.

Import/link still proceeds with best-effort enrichment. Missing profile data means default/null suggestions rather than blocking the owned list. Refresh that cannot read a valid profile or equipped item level fails with a clear domain error instead of inventing values.

## Rename and realm transfer

On Refresh:

- **Rename (same realm identity):** allowed when the new name does not collide with another of the owner's Characters on that realm/region. `normalizedName` stays in lockstep.
- **Realm transfer:** if Blizzard returns a different `blizzardRealmId` (or character id), Refresh refuses. Automatic transfer handling is not supported; operators resolve identity manually.

Class mismatch against the stored Character is also refused so eligibility history stays coherent.

## BoosterAccess independence

Linking or importing a character does not create, approve, or revoke `BoosterAccess`. Eligibility remains an explicit BoostingHub workflow. See [booster-access-management.md](booster-access-management.md).

## Lockout derivation (Character Raid Encounters)

Blizzard does **not** expose a direct SavedInstances-style lockout endpoint. BoostingHub derives **current-reset raid boss kill progress** from:

`GET /profile/wow/character/{realmSlug}/{characterName}/encounters/raids`

using the regional `profile-{region}` namespace and server-side client-credentials auth.

### Current vs historical raid references

`src/lib/wow-raid-catalog.ts` holds stable BoostingHub raid UUIDs that must not be overwritten when seasons change:

| Raid | Role | Journal instance id |
| --- | --- | --- |
| Manaforge Omega | Historical (existing Runs keep this id) | `1302` |
| The Venomous Abyss | **Current** lockout target (`currentForLockouts: true`) | `1320` |

Lockout refresh uses the explicit `currentForLockouts` flag — not array order, newest DB row, or boss count (both raids have 8 bosses). Matching prefers Blizzard journal instance + encounter ids; localized names (e.g. de_DE “Der Giftige Abgrund”) are presentation only. Tidebound Grotto (single-boss lair, instance `1317`) is not merged into Venomous Abyss lockouts.

Run creation lists raids with `availableForRuns: true` via `raidRepository.ensureReferenceRaids` (both historical Manaforge and current Venomous). Historical Manaforge Runs are never rewritten to Venomous.

### Semantics

- For each **verified** difficulty (`NORMAL` / `HEROIC` / `MYTHIC`): killed this reset iff `last_kill_timestamp` is in `[resetStart, resetEnd)`.
- Do **not** treat historical `completed_count > 0` alone as current lockout.
- Regional weekly reset windows (`src/lib/wow-weekly-reset.ts`): EU Wednesday 04:00 UTC; US Tuesday 15:00 UTC. Identifiers use `resetIdentifierFor(resetStart)`.
- Difficulties map centrally in `src/lib/blizzard/raid-difficulty.ts` (LFR / Story ignored).

### Clear vs Unknown (per difficulty)

| Situation | Display |
| --- | --- |
| Current raid found + difficulty mode present + zero current-reset kills | **0/N** (verified clear for that difficulty) |
| Current raid found + difficulty mode absent | **?** for that difficulty (not 0/N) |
| API failure, missing current raid mapping, no supported modes | **Unknown** overall — never invent Clear |
| Persisted row with wrong `resetIdentifier` or non-current raid | Ignored for current display |

Profile success and lockout verification are independent: itemLevel may update while lockouts stay unverified. Encounters data may lag until Blizzard publishes (often after logout). `CharacterRaidLockout.updatedAt` is last successful lockout verification time.

### Mythic limitation

Mythic progress is boss-kill progress in the current reset only. This API does **not** expose Mythic saved-instance IDs or lock-extension state.

### Persistence and refresh

Verified difficulty aggregates upsert into existing `CharacterRaidLockout`. Missing modes for the current raid+reset are deleted so they remain Unknown. Same-reset rows for non-current catalog raids are cleared on successful sync. No parallel BlizzardLockout domain.

Signup / roster eligibility is **unchanged**. No Warcraft Logs, Raider.IO, or addon required.

## Security

- Connect and callback require an authenticated BoostingHub session
- OAuth `state` nonce is bound to an HttpOnly cookie that also carries `userId`, `region`, and expiry; callback rejects mismatches and clears the cookie
- User OAuth tokens never leave the callback/service stack as persisted data
- Import/link selections must match the live import session snapshot
- Character ownership is enforced in services for link and refresh
- Tokens and secrets are not returned to the client or activity feed
- Refresh is rate-limited (~60s cooldown per character)

## Routes

| Route | Role |
| --- | --- |
| `GET /api/integrations/battlenet/connect?region=EU\|US` | Start regional OAuth; set state cookie; redirect to Battle.net |
| `GET /api/integrations/battlenet/callback` | Validate state, exchange code, upsert connection, open import session, clear cookie |

Server actions under `blizzard.actions.ts` handle disconnect, import, link, refresh, and loading import candidates.

Redirect URI must match the develop.battle.net client exactly (see env vars).

## Environment variables

Optional. Empty values keep the Characters UI on manual CRUD only; seed and Discord login work without them.

| Variable | Purpose |
| --- | --- |
| `BLIZZARD_CLIENT_ID` | Battle.net API client id |
| `BLIZZARD_CLIENT_SECRET` | Battle.net API client secret |
| `BLIZZARD_REDIRECT_URI` | e.g. `http://localhost:3000/api/integrations/battlenet/callback` |

## MVCS map

| Layer | Location |
| --- | --- |
| Model | `BattleNetConnection`, `BattleNetImportSession`, Character Blizzard fields |
| View | `/characters` Battle.net connection cards + import modal, character detail Refresh |
| Controller | `src/app/api/integrations/battlenet/connect/route.ts`, `callback/route.ts`, `blizzard.actions.ts`, `app.controller` character page panel |
| Service | `battleNetService`, `characterBlizzardService` |
| Integration | `src/integrations/blizzard/blizzard-api-client.ts` (external HTTP boundary) |
| Lib | `src/lib/blizzard/*`, `src/lib/wow-weekly-reset.ts`, `src/lib/lockout-display.ts`, `src/lib/wow-raid-catalog.ts` |
| Repository | `battleNetConnectionRepository`, `battleNetImportSessionRepository`, `characterRepository`, `lockoutRepository` Blizzard helpers |
| Validators | `src/validators/blizzard.ts` |

Views do not call Blizzard or Prisma. Controllers authenticate, validate, and delegate.

## Deferred

- Automatic realm-transfer handling
- Boss-level persisted lockout rows / signup eligibility redesign
- Persisted user OAuth tokens or long-lived user refresh (intentionally rejected)
- Warcraft Logs
- Using Battle.net as app login
- Admin tools to reassign Blizzard identity across accounts
