# Epic: Lead Ops Confidence

**Decision (2026-10-09):** Next epic is **Lead Ops Confidence**, not Booster Web Parity.

Rationale: recent investment already landed Community Schedule, roster automation, and attendance correction. The highest remaining ops leverage is fewer Raid Lead failure modes at Start and fewer clicks from Schedule → live Run. Booster Web Parity (Discord channel deep-link, `/runs` timezone) stays a follow-up track after this epic — see [P0 polish](#follow-up-booster-web-parity--p0-polish) below.

**Out of scope for this epic:** payout/settlement, customer marketplace, Discord full roster builder, hard lockout blockers.

---

## Status (2026-10-10)

| Ticket | Status |
| --- | --- |
| LOC-1 | **Mostly shipped** (#200, #203, #208, #222): materialization applies the Run Setup product/contents, slot raid lead, and Schedule composition overrides; hourly + immediate auto-create exist. Remaining: optional per-setup "open signups on create". |
| LOC-2 | **Shipped on the Schedule** (#210, `ScheduleOccurrenceStaffing`). Remaining: planned-vs-staffed metric on the Manage Runs list. |
| LOC-3 | **Next.** `run-preflight.service.ts` already covers status, published roster, unpublished changes, selected entries, raid lead, signups, Discord channel/signup post. Missing: composition gaps, lockout attention, schedule conflicts, stale Blizzard sync. |
| LOC-4 | Shipped with this roadmap. |

---

## Tickets

### LOC-1 — Schedule → Run materializer defaults

**Goal:** One-click (or near one-click) conversion from a Community Schedule slot / Run Setup into a usable draft or open Run with predictable staffing targets.

**Acceptance**

- Materializing a slot applies the Run Setup’s product / content preset, difficulty, loot type, and composition defaults without re-entering Shared Defaults.
- Default raid lead is taken from the setup or an explicit slot lead when present; otherwise the materializing admin’s lead rules stay unchanged.
- Optional: create with `signupsOpen` / open-run path configurable per setup (document default).
- Existing mass-create / create-many validation (`isLootTypeAllowedForDifficulty`, planned boss counts) still applies.
- RAID_LEAD read-only schedule behaviour unchanged; mutations remain admin-gated.

**Touch**

- `src/services/community-schedule-materialization.service.ts`
- `src/services/product-planning.service.ts`
- `src/services/community-schedule.service.ts`
- Manage schedule UI actions

**Tests:** materialization service tests for preset + lead + composition; no partial Run on validation failure.

---

### LOC-2 — Understaffed vs schedule plan signal

**Goal:** Leads see whether a materialized / open Run is understaffed relative to the Community Schedule plan (desired tanks/healers/DPS or setup composition).

**Acceptance**

- Schedule overlay or Run manage list shows planned vs current signup/selected counts for the linked occurrence when a link exists.
- Soft signal only (warning), not a hard block on Open / Start / Publish.
- Works for Community runs created from schedule; non-linked Runs show no plan signal.

**Touch**

- Schedule overlay / staffing helpers (`src/lib/run-staffing` or equivalent)
- `src/components/manage/manage-community-schedule-view.tsx` / occurrence actions
- Optionally manage runs list quick metrics

**Tests:** unit tests for planned-vs-actual projection; UI smoke via existing manage schedule tests if present.

---

### LOC-3 — Start Run preflight (“Ready to start?”)

**Goal:** Single authoritative preflight checklist before Start, extending `runPreflightService`.

**Acceptance**

- Preflight reports at least: unpublished roster changes, composition gaps, lockout attention / selection risk, schedule conflicts for selected characters, stale Blizzard sync on selected characters, Discord channel / signup-post health when a channel is expected.
- Start dialog surfaces blockers vs warnings distinctly; existing hard Start rules (`ROSTER_UNPUBLISHED_CHANGES`, published roster required, etc.) remain server-authoritative.
- Soft warnings never alone block Start unless a hard domain rule already does.
- Payload shaped in the service (MVCS); view only renders.

**Touch**

- `src/services/run-preflight.service.ts`
- `src/services/roster-selection-risk.ts` / composition helpers
- Start Run dialog / run manager actions
- `src/services/dashboard-attention.ts` if handoff cards should deep-link into the same checklist

**Tests:** expand `run-preflight.service.test.ts` for each signal category; Start still rejects unpublished roster.

---

### LOC-4 — Doc / guide cleanup (Paid lifecycle + deferred drift)

**Goal:** Docs match production after payout removal and shipped features.

**Acceptance**

- Raid Lead guides (DE/EN) lifecycle ends at **Completed** (no `→ Paid`).
- README “Not implemented” list no longer claims Discord bot, WCL, notifications, lockout sync, or attendance corrections are missing when they ship.
- Feature docs that still defer attendance correction / Blizzard / WCL / Discord as unimplemented are updated to remaining true deferrals only.

**Touch**

- `docs/guides/raidlead.md`, `docs/guides/raidlead.en.md`
- `README.md`
- `docs/features/run-lifecycle-attendance.md`, `run-detail.md`, `run-management.md`, related deferred sections as needed

**Note:** This ticket is implemented alongside this roadmap commit.

---

## Follow-up: Booster Web Parity + P0 polish

Not part of Lead Ops Confidence; track separately when booster pain outweighs lead ops:

| ID | Item |
| --- | --- |
| BWP-2 | Discord run-channel deep-link on Run Overview / detail |
| BWP-3 | Pass user timezone into `/runs` list (match My Runs / Dashboard) |
| P0-A | Analytics date-range UI for existing `from`/`to` query params |
| P1-R | Booster Reliability Summary (attendance + consumables/gear + strikes + WCL), RL-facing, no money |

Dropped: **BWP-1** (web run-level Cancel Signup). `/my-runs` Withdraw already covers it per signup; the only difference to Discord `withdrawFromRun` is withdrawing several signups of one Run in one click.

---

## Suggested branch / PR slicing

1. `docs/roadmap` + LOC-4 (docs-only PR)
2. `feature/loc-materializer-defaults` (LOC-1)
3. `feature/loc-schedule-staffing-signal` (LOC-2) — can parallelize after LOC-1 lands if it depends on occurrence↔run links
4. `feature/loc-start-preflight` (LOC-3)
