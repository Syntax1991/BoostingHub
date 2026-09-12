# Raid Lead run templates

## Purpose

Persistent, reusable Run-creation presets so a Raid Lead does not have to re-enter the same raid/difficulty/loot type/composition every time they open [Create Runs](run-management.md#creation). A template stores planning defaults only — it is never a schedule, a status, or a second source of truth for an existing Run.

```text
RAID_LEAD (self-service, /profile/templates)
  → Create a template for themselves
  → Edit / deactivate / reactivate their own templates

ADMIN (global management, /manage/templates)
  → Create a template for any eligible Raid Lead
  → Edit / reassign owner / deactivate / reactivate any template

Create Runs (/manage/runs/create)
  → Optionally select a usable template
  → Template's raid lead becomes authoritative for every resulting Run
```

## Ownership model

Every `RunTemplate` belongs to exactly one Raid Lead via `raidLeadId` — the business owner, not merely metadata. `createdById`/`updatedById` are separate mutation-audit fields: on create both equal the actor; on update only `updatedById` changes, `createdById` never changes. This lets an ADMIN create or edit a template owned by a different Raid Lead without corrupting who is actually accountable for it.

| Field | Meaning |
| --- | --- |
| `raidLeadId` | The template's owner. Authoritative for every Run created from it. |
| `createdById` | Who created the row. Never changes after creation. |
| `updatedById` | Who last mutated the row (edit, deactivate, reactivate). Changes on every mutation. |

A template stores only: `name`, `raidId`, `difficulty`, `lootType`, `plannedBossCount`, `desiredTankCount`/`desiredHealerCount`/`desiredDpsCount`, `notes`, `isActive`. It never stores a schedule, `status`, `signupsOpen`, a derived `title`, roster state, or any Discord identifier — those belong to a concrete Run, never a preset.

## Self-service (`/profile/templates`)

RAID_LEAD and ADMIN accounts (`hasRaidLeadAccess`) may visit `/profile/templates` to see, create, edit, deactivate, and reactivate **only their own** templates. The Raid Lead selector is always hidden here — even an ADMIN acting on this page can only own the template as themselves, never assign it to someone else. A forged different `raidLeadId` in the request is rejected server-side (`RUN_RAID_LEAD_INVALID`), never silently corrected.

## Admin management (`/manage/templates`)

ADMIN-only global view across every Raid Lead's templates, with filters for Raid Lead (all / specific) and Status (active / inactive / all). An ADMIN may create a template for any eligible Raid Lead, edit any template, reassign its owner, and deactivate/reactivate any template. Reassignment is **future use only** — see [Snapshot independence](#snapshot-independence-no-runtemplateid) below; it never touches a Run already created from that template.

`USER` accounts are fully blocked from every template route and action, enforced server-side in `runTemplateService` (not just hidden navigation).

## Usability

A template's usability is a **computed** concept, never a stored flag: `computeUsability(template)` (`run-template.service.ts`) checks, from the row's live joined Raid/User state:

- `isActive`
- the owning raid lead is still `isEligibleRaidLead` (active account, `RAID_LEAD` or `ADMIN`)
- the raid is still `availableForRuns` (see [run-management.md § Historical raid availability](run-management.md#historical-raid-availability))
- the difficulty/loot-type combination is still valid (`isLootTypeAllowedForDifficulty`)
- `plannedBossCount` is still within the raid's current total boss count
- composition counts are still within bounds

A template that becomes historically invalid (its raid goes historical, its owner is disabled, etc.) is **never auto-mutated or destroyed** — the row stays exactly as it is, simply excluded from the usable-template selector on Create Runs and flagged "Needs attention" with the specific reason in both management views.

### Create/edit vs. reactivate

Creating or editing a template requires the raid to *currently* satisfy `availableForRuns: true` — you cannot create a new template targeting a raid that's already gone historical, reusing the exact same `RAID_NOT_AVAILABLE_FOR_RUNS` rule Run creation uses. An *existing* template whose raid later becomes historical is preserved untouched.

Reactivating a deactivated template re-validates every usability condition above and **fails** (`RUN_TEMPLATE_UNUSABLE`) if any of them no longer hold — reactivation never blindly flips `isActive` back on.

## Validation reuse

Template create/update reuses the exact same Run-planning validators Run creation and editing use — no parallel or slightly-different rule set:

- `assertValidRunLootType` / `isLootTypeAllowedForDifficulty` (difficulty × loot type compatibility)
- `assertValidPlannedBossCount` (1 ≤ planned ≤ raid's total boss count)
- `assertComposition` / `RUN_COMPOSITION_MIN` / `RUN_COMPOSITION_MAX` (tank/healer/DPS bounds)
- `notesValue` (trim, empty → `null`)

These were extracted from `run.service.ts` into the shared `src/services/run-state.ts` so both `run.service.ts` and `run-template.service.ts` import one definition — never two copies that could drift apart.

## Create Runs integration (`/manage/runs/create`)

A template selector sits **above Shared Defaults** on the canonical [Create Runs](run-management.md#creation) page. RAID_LEAD sees only their own usable active templates; ADMIN sees every usable active template across every Raid Lead, labeled to disambiguate the owner (e.g. "Thorne — HC Unsaved 8/8").

Applying a template copies its planning defaults (raid, difficulty, loot type, planned boss count, composition, notes) into Shared Defaults and sets the effective Raid Lead to the template's owner. Per-row `scheduledStartAt` values are never touched. This is staged, client-side form state — no Run is created yet.

**Other template-derived values remain freely editable after applying a template.** A Raid Lead may apply a preset and still tweak composition or notes before submitting — a template is a starting point, not an immutable contract. The one exception is Raid Lead identity:

### The template's raid lead is authoritative

This is the load-bearing rule of the whole feature: **when a template is used, its `raidLeadId` — never anything the browser sends — determines the Raid Lead of every resulting Run.**

- While a template is selected, the Raid Lead control is locked (shown, not editable, for ADMIN) and every per-row Raid Lead override control is hidden. Selecting a template clears any already-staged per-row `raidLeadId` overrides rather than silently keeping a now-hidden mismatch.
- Switching between templates replaces Shared Defaults and the locked owner, and clears row-level Raid Lead overrides — but preserves concrete schedules and every other deliberate row override. Rows are never deleted or recreated.
- Selecting "No template" only **detaches**: it reverts to exactly today's pre-template Unified Run Creation behavior (fully editable Raid Lead, no regression) while keeping whatever planning values were already copied in as ordinary editable Shared Defaults — apply preset, then detach.

The client-side lock is a UI convenience, not the actual authority. `runService.createManyRuns` always re-resolves the template fresh from the database at submit time via `runTemplateService.resolveTemplateForUse`:

1. The template must exist, be authorized for this actor (`RAID_LEAD` may only use a template where `raidLeadId === actor.id`; `ADMIN` may use any usable template), and currently be usable — a stale, deactivated, or since-reassigned template is rejected (`RUN_TEMPLATE_NOT_FOUND` / `NOT_AUTHORIZED` / `RUN_TEMPLATE_UNUSABLE`) before any row is prepared.
2. If `defaults.raidLeadId` or **any** row's `overrides.raidLeadId` is present and differs from the template's owner, the entire batch is rejected with `RUN_TEMPLATE_RAID_LEAD_MISMATCH` — never silently overridden to the "correct" value. An omitted `raidLeadId` (the normal case) is fine; the server derives it from the template.
3. Only after both checks pass does every row's effective Raid Lead become the template's owner, which then flows through the same `resolveRequestedRaidLeadId` authorization every non-template Run creation already uses.

Applying a template never bypasses any other Run creation rule — raid availability, composition, loot-type compatibility, planned boss count, schedule validation, title derivation, the 1–25 batch limit, and the single atomic transaction all apply exactly as they do without a template.

## Snapshot independence (no `Run.templateId`)

There is **no relation from `Run` back to `RunTemplate`, anywhere.** Applying a template only copies its then-current field values into a new Run's own concrete columns at creation time. After that:

- Editing a template never changes any Run already created from it.
- Deactivating (or reactivating) a template never changes any Run already created from it, and never affects that Run's lifecycle, editability, or manageability.
- Reassigning a template's owner (ADMIN-only) never changes the `raidLeadId` of any Run already created from it.

A Run and the template it was created from are only ever connected at the single moment of creation — after that they are fully independent rows.

## No recurrence or scheduling engine

Explicitly out of scope for this feature: weekday/time-of-day recurrence, RRULE-style repetition, cron-driven automatic Run generation, or any persistent link that would let editing a template retroactively affect future auto-created Runs. A template only ever produces Runs when a manager explicitly applies it during Create Runs — nothing runs on a schedule.

## Discord

A Run created via a template is `DRAFT` with `signupsOpen: false`, exactly like any other freshly created Run — no `RunDiscordPost`, channel, signup message, or roster message is provisioned at creation time. Discord provisioning still only happens when the Run is opened, one Run at a time, same as [run-management.md](run-management.md#result).

## MVCS

View → Controller → Service → Repository, matching every other feature in this codebase:

- `src/repositories/run-template.repository.ts` — persistence, scoped reads (`listByRaidLead`, `listAll`), and mutations only. No role authorization, no Run-planning business rules, no template-use authorization.
- `src/services/run-template.service.ts` — `runTemplateService`, owning every authorization check, domain validation, usability computation, and the `resolveTemplateForUse` entry point `run.service.ts` calls into.
- `src/controllers/app.controller.ts` (`profileController.getMyTemplatesPage`, `managementController.getManageTemplatesPage`) and `src/controllers/run-template.actions.ts` — authenticate, validate, call the Service, map errors, revalidate.
- No Prisma in views or controllers.

## Security

- Template-use authorization and the raid-lead-authority rule are enforced server-side in `runTemplateService`/`runService`, never trusted from client state.
- `createdById`/`updatedById`/`isActive` are never client-settable outside their dedicated server actions (create, deactivate, reactivate).
- USER accounts are blocked at the Service layer for every template action, not just hidden navigation.
- Domain errors (`RUN_TEMPLATE_NOT_FOUND`, `RUN_TEMPLATE_UNUSABLE`, `RUN_TEMPLATE_RAID_LEAD_MISMATCH`, `RUN_TEMPLATE_ALREADY_ACTIVE`, `RUN_TEMPLATE_ALREADY_INACTIVE`), not raw Prisma/Postgres errors.

## Deferred

- Discord Current/Next-ID category routing (separate future feature)
- Any recurrence/scheduling engine
- Cross-run Character reservation, raid-save semantics, payouts, attendance (unaffected by this feature)
