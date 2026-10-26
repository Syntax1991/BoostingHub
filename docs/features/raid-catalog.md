# Raid Catalog — Blizzard import / sync

`/manage/raid-catalog` (legacy `/manage/content` redirects here) — ADMIN / OWNER only.

Raids and their bosses are **imported from the Blizzard Adventure Journal**. Admins no
longer type raid names, boss lists or Blizzard encounter ids. Products (run presets)
stay BoostingHub data and are edited by hand.

## Audit (2026-10-23, main `73b53d2`)

### Data model

| Table | Field | Owner | Before this change |
| --- | --- | --- | --- |
| `Raid` | `name` | Blizzard | typed by hand in *New raid* |
| `Raid` | `blizzardInstanceId` | Blizzard | optional advanced field, else detected by **name** match against the journal index |
| `Raid` | `season` | BoostingHub | typed / picked by hand |
| `Raid` | `sortOrder`, `trackLockouts`, `isActive` (*Available for new Runs*) | BoostingHub | by hand |
| `Raid` | `wclZoneId`, `wclRankingEncounterId` | Warcraft Logs | detected by name (soft fill), *Retry detection* overwrites |
| `RaidBoss` | `name`, `sortOrder` | Blizzard | typed / reordered by hand, one encounter at a time |
| `RaidBoss` | `blizzardEncounterIds` (JSON array) | Blizzard | typed by hand, else name-matched against the journal |
| `RaidBoss` | `wclEncounterIds` (JSON array) | Warcraft Logs | detected by name (soft fill) |
| `Product`, `ProductRaidContent` | name, flags, ordered contents, FIXED / VARIABLE boss counts | BoostingHub | by hand (unchanged) |
| `RunTemplateRaidContent`, `RunRaidContent` | `raidId`, `plannedBossCount` | BoostingHub | written by Run Setup / Run flows only |

Boss count is never stored: it is `RaidBoss` rows per raid (`RaidCatalog.bossTotal`).
Boss **order** is display only — planned counts (`plannedBossCount`, product 5/8) are
numbers, not "the first N bosses", and lockouts store boss UUIDs (`killedBossIds`).

**Redundant manual entry today:** raid name, boss names, boss order, boss count (by
adding rows), Blizzard instance id, Blizzard encounter ids — all of it is in the
journal. The name-based discovery (`blizzard-raid-metadata.service.ts`) only works
after an admin has typed names that exactly match Blizzard's.

### Blizzard identities (verified live, EU, 2026-10-23)

- **Instance endpoint:** `GET /data/wow/journal-instance/{id}?namespace=static-{region}` returns
  `name`, `category.type`, `expansion`, `modes`, `order_index` and the ordered
  `encounters[] {id, name}` (`blizzardApiClient.getJournalInstance`).
- **Canonical instance identity = journal instance id.** The character encounters response
  (`/profile/wow/character/{realm}/{name}/encounters/raids`) carries, per instance,
  `instance: { key: { href: ".../data/wow/journal-instance/1320?..." }, name, id: 1320 }`
  — it *links to the journal instance*; the ids are the same identity (sample: eredar/zeti:
  1314, 1307, 1308, 1305, 1317, 1320, 1324 — all equal to the journal ids). Production
  lockouts are already derived through `Raid.blizzardInstanceId` = journal id (1320, 1324).
  One field is correct; there is no second id to store.
- **Boss identity = journal encounter id.** Encounters in the profile response link to
  `/data/wow/journal-encounter/{id}` with the same `id` (2888, 2896, …).
  `deriveCurrentResetLockouts` matches `encounter.id` against `RaidBoss.blizzardEncounterIds`.
- **Lockout identity** = character + raid (via instance id) + difficulty + weekly reset
  (`CharacterRaidLockout` unique key); bosses via encounter id → `RaidBoss.id`.
- Category alone does not mean "real raid": the Midnight **world bosses** are journal instance
  1312, `category: RAID`, `modes: [NORMAL]`.

### Seasons

Blizzard has **no authoritative raid-season membership API**. `mythic-keystone/season` covers
dungeons only. The journal tier "Current Season" (`journal-expansion/505`) lists *every*
Midnight raid — Season 1 and Season 2 plus the world-boss instance — identical to the
"Midnight" tier (516). Seasons are therefore small, version-controlled definitions in
`src/lib/raid-seasons.ts` (key, name, `current`, `journalInstanceIds`). No season CRUD UI.

### WCL

`warcraft-logs-raid-metadata.service.ts` resolves zone / encounter ids by exact unique
name; it never guesses and soft discovery fills only empty fields. Blizzard and WCL ids
are different id spaces (Kith'ix: WCL `journalID` 3271 vs Blizzard 2896; WCL encounter
3513). Imports keep using soft discovery only, so manual / seeded WCL ids are never
overwritten, and a missing WCL match only shows "Needs mapping".

### Migration

**None.** `Raid.blizzardInstanceId` and `RaidBoss.blizzardEncounterIds` are exactly the
two Blizzard identities. Stale bosses are handled by reconciliation (below), not a flag;
uniqueness of the instance id is enforced by the import inside a transaction behind a
transaction-scoped advisory lock (as before, at application level).

## Import / sync behaviour

All writes are keyed by the Blizzard instance id and run in one transaction **after**
every Blizzard request has succeeded: a failed or invalid Blizzard response writes nothing
and the admin sees the reason (not found / not a raid / rate limited / unavailable).

- **Import Raid** — enter a journal instance id → *Fetch* → preview (name, boss count,
  bosses, NEW / ALREADY IMPORTED / UPDATE AVAILABLE) → *Import*. Season and lockout
  tracking default from the season definition containing the id.
- **Import Season** — pick a code season → preview of every raid → *Import*. New raids of
  the current season start with lockout tracking on; for historic seasons it is a choice.
- **Refresh from Blizzard** (raid detail) — preview, then updates only Blizzard-owned
  metadata: raid name, boss names, boss order, encounter ids.

Matching: an existing raid by instance id; otherwise one unlinked raid with the same
(normalized) name is adopted instead of duplicated. Bosses by encounter id; unlinked
bosses by unique name (or one boss ↔ one encounter).

Never written by import / refresh: season, order, lockout tracking and run availability of
existing raids, WCL ids already set, Products, `ProductRaidContent`, `RunTemplateRaidContent`,
`RunRaidContent`, Runs. New raids are not offered for new Runs until an admin enables it.

**Reconciliation.** A raid that is in use (Runs, Run Setups, Products, lockouts) or seeded
keeps its encounter set: Blizzard bosses that are new, or bosses Blizzard stopped
returning, are listed in the preview as *needs reconciliation* and are not added / deleted.
Unused raids follow Blizzard (new bosses added, missing bosses removed).

## Status per raid

- **Blizzard** — synced (instance linked) or not linked.
- **Bosses** — `N/N mapped` (bosses with a Blizzard encounter id).
- **Lockouts** — ready (tracked + instance + every boss mapped), incomplete, or not tracked.
- **Warcraft Logs** — mapped (zone + every boss) or needs mapping.

Raw ids are shown only in the expanded details.

## Page sections

`/manage/raid-catalog?tab=raids` (default; missing / unknown values fall back here) shows
the imports and the raid list; `?tab=presets` shows Run Presets (Products). The tab is a
real link, so refresh, back / forward and copied URLs keep it.

## Raid lifecycle

**Identity** is the Blizzard journal instance id. Import / refresh reuse the Raid holding
that id (one Raid per instance, serialized by an advisory lock), and the insert-only
bootstrap (`ensureReferenceRaids`) skips a fixture raid whose instance already belongs to
another Raid row. Before 2026-10-26 the bootstrap only compared fixture UUIDs: when #271
added The Unbinding of Kith'ix (`eeeeeeee-…`, instance 1324) as a fixture, production
already had the admin-created Kith'ix (`feac9fd9-…`, same instance), so a second copy was
inserted and the lockout sync wrote every Kith'ix lockout twice.

Raid → Manage offers exactly the action the server accepts in the current state:

| State | Action |
| --- | --- |
| No Run, Run Setup, Product or lockout reference, not a bootstrap fixture | **Delete** — removed with its bosses |
| Shares its Blizzard instance with a Raid that outranks it (more Run / Run Setup / Product references, then lockouts) and has no Run / Run Setup / Product reference itself | **Remove duplicate** — its lockouts move to the kept Raid (exact copies for the same Character / difficulty / reset are dropped, killed boss ids re-mapped), then it is deleted, in one transaction |
| Referenced, or a bootstrap fixture | **Archive** (`Raid.archivedAt`) |
| Archived | **Restore** |

An archived Raid stays valid for existing Runs, lockouts and Warcraft Logs (rows and
foreign keys untouched; lockout sync still follows *Lockout tracking*). It is never
offered for new planning: not available for new Runs (`availableForRuns` is false), a
Run Setup with it is unusable, a product holding it is closed to new Runs / Run Setups,
and it cannot be added to a product (a product that already holds it stays editable).
Run / Run Setup / Product references are never re-pointed or deleted by any of these actions.
