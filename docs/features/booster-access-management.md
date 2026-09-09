# Booster access management

## Purpose

Let a character owner request booster eligibility and let an ADMIN approve, reject, or revoke it. A newly created character is not booster-eligible until an `APPROVED` `BoosterAccess` row exists for the matching class, role, and difficulty.

## Why BoosterAccess is separate from user role

Account roles (`USER`, `RAID_LEAD`, `ADMIN`) are platform permissions.

Run participation (`BOOSTER`, `LOOTBUDDY`) is per-run.

`BoosterAccess` is granular boosting qualification. A USER can hold approved access without becoming RAID_LEAD. There is no global `isBooster` flag.

A later `BOOSTER_ACCESS_MANAGER` permission may replace the current ADMIN-only review gate. This feature does not introduce a general RBAC framework.

## Granularity

Eligibility is unique on `(userId, wowClass, role, difficulty)`.

- Class comes from the requesting Character, never from the client.
- Role must be valid for that class in `src/lib/wow-specializations.ts`. `primaryRole` is not the only requestable role.
- Each difficulty is independent. Heroic does not imply Normal or Mythic.

`characterId` records which character opened or last reopened the request. It is not part of uniqueness, so two Shamans on the same account share Shaman + Healer + Heroic eligibility.

## User request flow

Entry point: `/characters/[characterId]`.

The owner of an **active** character may request access for a valid role and difficulty. Inactive characters keep existing rows visible but cannot submit new requests.

## Admin review flow

`/manage/booster-access` is ADMIN-only. RAID_LEAD keeps `/manage` for runs but is redirected away from this queue.

Pending rows can be approved or rejected. Approved rows can be revoked. Optional reject/revoke reasons are stored in `notes` and shown to the owner. Reasons are omitted from global activity messages.

## State lifecycle

One row is reused:

```text
NONE → PENDING → APPROVED → REVOKED → PENDING
                ↘ REJECTED → PENDING
```

Pending and approved combinations cannot be duplicated. Rejected or revoked combinations may be requested again (status returns to PENDING).

## Authorization

| Actor | Request own | View own | Approve / reject / revoke |
| --- | --- | --- | --- |
| USER | yes | yes | no |
| RAID_LEAD | yes (own characters) | yes; roster tools still read access | no |
| ADMIN | yes | yes | yes |

Hidden navigation is not authorization. Mutations go through `requireUser` / `requireAdmin` and `assertCanReviewBoosterAccess`.

## Revocation semantics

Revoke immediately stops **new** matching booster signups.

Existing signup rows are not withdrawn or deleted. Historical roster entries remain. Publish/republish still revalidates `BoosterAccessService.isApprovedFor`, so a selected booster whose access was revoked becomes a `BOOSTER_ACCESS_INVALID` blocker.

## Interaction with signups

Only `APPROVED` grants booster eligibility. `PENDING`, `REJECTED`, and `REVOKED` do not.

Lootbuddy (`LOOT_ONLY` and `PLAYING`) does not require BoosterAccess.

## Interaction with rosters

Roster publication already re-reads current access. This feature does not duplicate that logic.

## Character active state

Deactivate does not revoke access. Reactivate does not auto-approve. Inactive characters cannot request or be approved until they are active again.

## Blizzard independence

Battle.net may later prove character identity. It does not grant BoosterAccess. Approval stays BoostingHub-owned.

## Warcraft Logs independence

WCL may later inform reviewers. Approval remains manual.

## MVCS

- Model: `BoosterAccess`, `BoosterAccessStatus` including `REJECTED`
- View: character access panel, request dialog, `/manage/booster-access`
- Controller: `booster-access.actions.ts`, `managementController.getBoosterAccessPage`
- Service: `boosterAccessService`, `booster-access-state.ts`
- Repository: `boosterAccessRepository`

## Security

- Request owner and reviewer are session-derived
- Class is read from the Character row
- Clients cannot submit `APPROVED` or a reviewer id
- Unique `(userId, wowClass, role, difficulty)` plus service checks stop duplicate pending/approved rows
- Raw unique-constraint errors map to domain messages
- Activity events do not include review notes

## Deferred

- Warcraft Logs evidence
- Blizzard ownership proof
- Notifications
- Fine-grained `BOOSTER_ACCESS_MANAGER` permission
- Immutable audit-history tables
