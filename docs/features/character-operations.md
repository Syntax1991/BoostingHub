# Character Operations (`/manage/characters`)

Admin-level area (ADMIN and OWNER — `hasAdminAccess`; USER and RAID_LEAD are denied on pages, actions and services) for inspecting every Character centrally and running Blizzard syncs, instead of navigating through individual user profiles. It reuses the sync telemetry, health model and locks from [blizzard-integration.md § Sync telemetry](blizzard-integration.md#sync-telemetry); there is no second sync implementation.

## List

- **Summary** (active Characters only — retired never count as problems): Total (with retired count), Healthy, Stale, Sync errors, Never synced, Blizzard linked, No connection. Each problem card links to the matching filter. The summary is computed from the same derived rows as the table.
- **Table:** Character (class icon/colour, item level, link to the detail page), Owner (link to `/manage/users/[id]`), Class, Region / Realm, Status (Active / Retired), Last success (relative, exact time on hover), Sync health, Blizzard/API (linkage + readable error category and failure count on errors), Lockouts, Actions.
- **Lockouts:** one line per current raid/content (catalog order, e.g. *The Venomous Abyss*, *Tide*) with `N x/N · HC x/N · M x/N`. A raid without verified current-reset rows shows **Unknown**; an explicit `0/N` is a verified zero. Old resets are never shown.
- **Filters** (URL parameters, combinable): character/realm text, owner (name, Discord username or id), class, region, status (All / Active / Retired), Blizzard (Linked / Not linked / No connection), sync health. A health filter matches active linked Characters only.
- **Sorting** (stable, ties by name): Character, Owner, Last success (most recent first, never-synced last), Sync health (problems first: Error → Stale → Never synced → Healthy → No connection → Not linked → Retired).
- **Query shape:** one Character query (owner + only current-reset rows of the current raids) plus one Battle.net connection query — independent of the number of Characters. No pagination at the current scale (~90 Characters).

## States

| Linkage | Meaning |
| --- | --- |
| Linked | Blizzard ids present and the owner has a Battle.net connection for the Character's region |
| Not linked | No Blizzard ids (manual Character) — never synced |
| **No connection** | Blizzard ids present but the owner has **no** Battle.net connection for that region — silently excluded from the scheduled sync, so it is highlighted |

Sync health exists only for active, linked Characters: **Error** (the latest failure is newer than the latest success) › **Never synced** › **Stale** (last success older than `BLIZZARD_SYNC_STALE_MINUTES` + 30 min) › **Healthy**. Retired Characters show **Retired**.

Error categories are shown as readable copy only: Profile unavailable, Character identity conflict, Character name conflict, Blizzard rate limited, Blizzard API unavailable, Blizzard authentication/configuration error, Internal sync error. Raw upstream messages are never stored or shown.

## Detail (`/manage/characters/[id]`)

Read-only operations view: identity (realm, region, class, specialization, role, item level, active/retired), owner, Blizzard linkage and connection (and Blizzard ids), sync telemetry (last attempt, last success, health, last error time, category, consecutive failures), the per-raid × difficulty lockout matrix (verified vs Unknown), current Weekly Availability, and a read-only Booster Access summary. No Character editing.

## Actions

Eligibility for every sync action: the Character is **active** (retired → disabled with the reason; the server refuses with `CHARACTER_SYNC_NOT_ELIGIBLE`). Linked Characters whose **owner** (resolved server-side — never the acting admin) has a Battle.net connection for the region sync VERIFIED; manual / unconnected ones sync PUBLIC from the public Blizzard API (item level + lockouts, badge **Public API**) — see [blizzard-integration.md](blizzard-integration.md).

- **Delete** (detail page) — confirmed hard delete of any Character, with the owner-delete guard (refused while an unfinished Run has a non-withdrawn signup on it). The Platform Owner's Characters are protected from ADMINs. See [character-management.md](character-management.md#delete).

- **Sync now** — the normal 60-second cooldown (measured from the last attempt) applies.
- **Force refresh** — confirmation required; bypasses only the 60-second cooldown. Identity/class/realm checks, rate-limit handling, telemetry and the per-Character lock stay in force. Still available while the bulk cooldown is active.
- **Force refresh all** — confirmation shows the eligible count (re-resolved server-side when it runs; no client id list). It:
  - runs synchronously with **concurrency 4** and a **~120 s work budget** (unstarted Characters are reported as skipped);
  - stops starting work after the first Blizzard **429** (the rest are skipped as rate limited);
  - skips Characters that are already syncing (per-Character advisory lock) — one failure never aborts the batch;
  - holds the **same whole-job advisory lock as the scheduled sync** (`837462, 1`): while the scheduler (or another bulk run) is running it is refused with "Character synchronization is already in progress.";
  - has a **10-minute global cooldown** that starts when a run is accepted. The durable marker is the latest `ActivityEvent` of type `CHARACTER_BULK_FORCE_REFRESH_STARTED` (checked and written while holding the job lock);
  - returns eligible / attempted / succeeded / failed / skipped with the failed and skipped Characters and their safe reason.

Activity events: `ADMIN_CHARACTER_SYNC`, `ADMIN_CHARACTER_FORCE_REFRESH`, `ADMIN_CHARACTER_DELETED` (actor = admin, `targetCharacterId=`, outcome category), `CHARACTER_BULK_FORCE_REFRESH_STARTED` and `…_COMPLETED` (counts).

If the eligible population ever grows far beyond what fits the budget (Apache `Timeout 300`), move bulk refresh to the existing one-shot systemd job pattern rather than adding a queue.
