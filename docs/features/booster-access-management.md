# Booster access management

## Purpose

Let an ADMIN grant, approve, reject, or revoke booster eligibility after Discord review. Eligibility is **account-level**: a newly created or imported character becomes booster-eligible only when an `APPROVED` `BoosterAccess` row already exists for the matching **user + class + role + difficulty**.

Self-service `requestAccess` is disabled (`BOOSTER_ACCESS_SELF_REQUEST_DISABLED`). Character pages show a Discord ticket CTA when `DISCORD_BOOSTER_TICKET_URL` is set.

Characters do **not** own BoosterAccess. They only consume matching account qualifications.

## Why BoosterAccess is separate from user role

Account roles (`USER`, `RAID_LEAD`, `ADMIN`) are platform permissions.

Run participation (`BOOSTER`, `LOOTBUDDY`) is per-run.

`BoosterAccess` is granular boosting qualification. A USER can hold approved access without becoming RAID_LEAD. There is no global `isBooster` flag.

A later `BOOSTER_ACCESS_MANAGER` permission may replace the current ADMIN-only review gate. This feature does not introduce a general RBAC framework.

## Granularity

Eligibility is unique on `(userId, wowClass, role, difficulty)`.

- Class is chosen by ADMIN grant (validated against the class catalog) or inherited from historical request context; clients cannot invent unsupported classes.
- Role must be valid for that class in `src/lib/wow-specializations.ts`. `primaryRole` is not the only grantable role.
- Each difficulty is independent. Heroic does not imply Normal or Mythic.

`characterId` may record historical request context. It is **not** part of uniqueness, approval ownership, or signup lookup. Two Shamans on the same account share Shaman + Healer + Heroic eligibility.

## Discord application + ADMIN grant

Entry point for applicants: Discord ticket URL from character details (`discordTicketUrl` / `DISCORD_BOOSTER_TICKET_URL`). The character access panel is read-only (`canRequest` / `canSubmitRequests` false, `selfRequestDisabled` true).

ADMIN grants qualifications directly with `grantAccess({ userId, wowClass, role, difficulty, notes? })` from `/manage/booster-access` (and related manage surfaces). Grant creates APPROVED rows, approves historical PENDING rows, or reopens REJECTED/REVOKED through PENDING → APPROVED.

Current onboarding:

```text
User → Discord ticket → staff review → ADMIN grant
```

ADMIN does **not** automatically receive BoosterAccess. Admins may explicitly grant to USER, RAID_LEAD, ADMIN, or themselves using the same account-level model.

## Qualifications vs Legacy Requests

`/manage/booster-access` is ADMIN-only and has two views:

### Qualifications (default)

Current account-level authorization history. Columns are user-centric:

User · Class · Role · Difficulty · Status · Context · Times · Actions

Statuses shown here: `APPROVED`, `REJECTED`, `REVOKED` (never the primary PENDING queue).

Item level and specialization are **not** part of BoosterAccess and are not shown as qualification identity.

### Legacy Requests · N

Unresolved historical `PENDING` rows from the former in-app self-service workflow only.

N counts only unresolved PENDING. Approve / Reject resolve them into qualifications/history without deleting the row.

Historical `characterId` may appear as secondary context (“Requested via Synblast-Antonidas”). It means request origin only — the Character does not own the qualification.

Empty legacy queue copy:

> No legacy requests awaiting review.

There is no “Create request” action. Normal users no longer submit in-app requests.

## Admin review flow

RAID_LEAD keeps `/manage` for runs but is redirected away from this page.

Historical pending rows can still be approved or rejected on Legacy Requests. Approved qualifications can be revoked on Qualifications. Optional reject/revoke reasons are stored in `notes` and shown to the owner. Reasons are omitted from global activity messages.

Approval is account-level and does not require a requesting Character to still be active.

## State lifecycle

One row is reused:

```text
NONE → PENDING → APPROVED → REVOKED → PENDING
                ↘ REJECTED → PENDING
```

Pending and approved combinations cannot be duplicated. Rejected or revoked combinations may be reopened by ADMIN grant (via PENDING → APPROVED).

## Authorization

| Actor | Self-request | View own | Grant / approve / reject / revoke |
| --- | --- | --- | --- |
| USER | no (disabled) | yes | no |
| RAID_LEAD | no (disabled) | yes; roster tools still read access | no |
| ADMIN | no (disabled) | yes | yes |

Hidden navigation is not authorization. Mutations go through `requireAdmin` and `assertCanReviewBoosterAccess`.

## Revocation semantics

Revoke immediately stops **new** matching booster signups.

Existing signup rows are not withdrawn or deleted. Historical roster entries remain. Publish/republish still revalidates `BoosterAccessService.isApprovedFor`, so a selected booster whose access was revoked becomes a `BOOSTER_ACCESS_INVALID` blocker.

## Interaction with signups

Only `APPROVED` grants booster eligibility. `PENDING`, `REJECTED`, and `REVOKED` do not.

Lookup is `userId + class + role + run difficulty` against account-level rows. CharacterId is never the ownership key.

Lootbuddy (`LOOT_ONLY` and `PLAYING`) does not require BoosterAccess.

## Interaction with rosters

Roster publication already re-reads current account-level access. This feature does not duplicate that logic.

## Character active state

Deactivate does not revoke account-level access. Reactivate does not auto-approve. Inactive characters cannot signup, but sibling matching Characters still use the same approval. Self-service requests are disabled for all characters.

## Blizzard independence

Battle.net may prove character ownership, class, and item level. It does not create, approve, revoke, or character-scope BoosterAccess. Approval stays BoostingHub-owned.

## Warcraft Logs independence

WCL may later inform reviewers. Approval remains manual.

## MVCS

- Model: `BoosterAccess`, `BoosterAccessStatus` including `REJECTED`
- View: character access panel (read-only + Discord CTA), grant dialog, `/manage/booster-access`
- Controller: `booster-access.actions.ts`, `managementController.getBoosterAccessPage`
- Service: `boosterAccessService`, `booster-access-state.ts`
- Repository: `boosterAccessRepository`; Character/Roster loaders attach account-level rows by class

## Security

- Reviewer / granter is session-derived ADMIN
- Self-service `requestAccess` always fails after ownership check
- Clients cannot submit `APPROVED` or a reviewer id
- Unique `(userId, wowClass, role, difficulty)` plus service checks stop duplicate approved rows
- Raw unique-constraint errors map to domain messages
- Activity events do not include sensitive Discord ticket contents beyond optional grant notes

## Deferred

- Warcraft Logs evidence
- Blizzard ownership proof
- Notifications
- Fine-grained `BOOSTER_ACCESS_MANAGER` permission
- Immutable audit-history tables
