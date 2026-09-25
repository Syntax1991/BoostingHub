# User management

## Purpose

Give ADMIN operators a management hub for browsing accounts, inspecting characters and booster qualifications, and assigning platform account roles (`USER`, `RAID_LEAD`, `ADMIN`). Role changes are server-owned and audited.

This feature does **not** turn BOOSTER into an account role. Booster eligibility is `BoosterQualification` (User + Difficulty).

## Management Hub

`/manage` is the operations overview for RAID_LEAD and ADMIN.

- RAID_LEAD sees run metrics and the Runs entry point.
- ADMIN additionally sees Booster Access and Users cards with compact counts.

Metrics are prepared by `managementHubService`. Views render cards only; they do not query Prisma.

## Navigation

`getManagementNavItems(accountRole)` drives the manage sub-nav in the app shell:

| Role | Modules |
| --- | --- |
| USER | none (no Manage entry) |
| RAID_LEAD | Overview, Runs |
| ADMIN | Overview, Runs, Booster Access, Users |

Hidden links are not authorization. Controllers still call `requireManagerOrRedirect`, `requireAdmin`, and service asserts.

`isManagementNavActive` treats `/manage` as exact-match only so `/manage/users` does not highlight Overview.

## Account Roles

Platform permissions on `User.accountRole`:

| Role | Meaning |
| --- | --- |
| `USER` | Standard operator: characters, signups, own profile |
| `RAID_LEAD` | Create/manage assigned runs; manage hub for runs |
| `ADMIN` | All raid-lead powers plus booster access review, grants, and user administration |
| `OWNER` | The protected Platform Owner: every Admin permission, and nobody can change it through role management |

Hierarchy: `OWNER` > `ADMIN` > `RAID_LEAD` > `USER` — each level inherits everything below it. Authority is always checked through `hasOwnerAccess` / `hasAdminAccess` / `hasRaidLeadAccess` (`src/auth/authorization.ts`), never with a literal role comparison, so an OWNER can use every Admin feature (users, Booster Access, Templates, every Run, Raid Lead eligibility).

`BOOSTER` and `LOOTBUDDY` are run participation types, never account roles.

## Platform Owner

There is at most one OWNER. It exists so that no ordinary Admin can take the platform away from its owner.

- **Protected.** No one — no ADMIN and not the OWNER — can change an OWNER through the generic role flow (`OWNER_ROLE_PROTECTED`). This is enforced server-side, on the locked row inside the write transaction, not by hiding controls.
- **Not assignable.** The generic role flow never assigns OWNER (`OWNER_ASSIGNMENT_REQUIRES_BOOTSTRAP`), even when a crafted request submits `nextRole=OWNER`. The **Change role** dialog only offers `MANAGEABLE_ACCOUNT_ROLES` (`USER`, `RAID_LEAD`, `ADMIN`); an OWNER's user detail shows **Platform Owner · Protected** instead of the button.
- **Singleton in the database.** A partial unique index `user_single_owner` on `user("accountRole") WHERE "accountRole" = 'OWNER'` makes a second OWNER row impossible, including under concurrent bootstraps.
- **Session freshness.** Like every role, OWNER authority comes from the per-request database reload — there is no session-only override.
- **Account status.** BoostingHub has no action that disables accounts (the only status write is the development account bootstrap, which sets `ACTIVE`), so there is no disable path to protect. The dev bootstrap keeps an OWNER as OWNER.

### Bootstrap (one time, operator only)

The schema migration makes nobody OWNER — existing ADMINs stay ADMIN. The first OWNER is set explicitly, with the target named by its exact User UUID (look it up on `/manage/users/<id>`):

```bash
npm run owner:bootstrap -- --user-id <uuid>
```

On production run it as the app user from the release directory (`cd /var/www/boostinghub && sudo -u boostinghub npm run owner:bootstrap -- --user-id <uuid>`). In one transaction it requires that the User exists, is `ACTIVE` and is `ADMIN`, and that no OWNER exists yet; then it sets `OWNER` and writes an `ActivityEvent` `PLATFORM_OWNER_BOOTSTRAPPED` (`targetUserId`, name, previous role, new role). Any later run fails with `OWNER_ALREADY_EXISTS` — also for the same user — and changes nothing. There is no web UI for it, and a manual SQL update is not a supported procedure.

**Ownership transfer is intentionally out of scope.** A future, dedicated transfer workflow can be built separately; until then ownership cannot move through any normal flow.

## User Listing

Route: `/manage/users` (ADMIN only).

Lists accounts with role, Discord identity hints, character counts, and difficulty-qualification tallies. Filters/sorts are applied in `userRepository.listAdminUsers` via `userManagementService.listUsers`.

## User Detail

Route: `/manage/users/[userId]`.

Shows identity, account role/status, characters, difficulty qualifications (with direct Grant access), disciplinary Strike history (Add/Revoke), and recent audit events relevant to that user (including `ACCOUNT_ROLE_CHANGED` events authored by another admin that mention `targetUserId=`).

Strikes are a separate concept from account role, qualifications, and audit — see [user-strikes.md](user-strikes.md).

## Role Administration

ADMIN changes roles through `userManagementService.changeAccountRole`.

Supported transitions include USER → RAID_LEAD, RAID_LEAD → ADMIN, and ADMIN → RAID_LEAD / USER (when another Admin-level account remains). An ADMIN may still change another ADMIN; only the OWNER is protected (see Platform Owner). Same-role assignments throw `ROLE_ALREADY_ASSIGNED`. Unknown values throw `INVALID_ACCOUNT_ROLE`.

Clients cannot invent roles outside `ACCOUNT_ROLES`, and OWNER is never accepted as a target role.

## Last Admin

The platform must keep at least one **active Admin-level account** — an ADMIN or the OWNER. Removing the last one throws `LAST_ADMIN_REQUIRED`:

- with an active OWNER, the last literal ADMIN may be demoted;
- before an OWNER is bootstrapped, the last active ADMIN stays protected;
- a DISABLED Admin does not count.

The check runs inside the write transaction (`userRepository.changeAccountRoleAtomic`): when a change removes Admin-level authority, every Admin-level row plus the target is row-locked first, then the remaining active Admin-level accounts are counted. Two concurrent demotions therefore serialize — they can never both pass and leave the platform without an Admin.

## Active Run Safety

Demoting an account that currently has raid-lead access (`RAID_LEAD` or `ADMIN`) to a role without it (`USER`) is blocked while that user is `raidLeadId` on any non-terminal run (`DRAFT`, `OPEN`, `ROSTERING`, `PUBLISHED`, `IN_PROGRESS`).

Error: `ROLE_CHANGE_BLOCKED_BY_ACTIVE_RUNS`.

`COMPLETED` and `CANCELLED` runs do not block.

## Discord Booster Applications

Self-service creation of PENDING legacy `BoosterAccess` is disabled. Character pages show an **Apply via Discord** CTA when `DISCORD_BOOSTER_TICKET_URL` is set. Review happens in Discord; BoostingHub remains the authoritative qualification store.

See [booster-access-management.md](booster-access-management.md).

## BoosterQualification vs Account Role

| Concern | Store | Who mutates |
| --- | --- | --- |
| Platform permission | `User.accountRole` | ADMIN / OWNER via user management; OWNER only via the owner bootstrap |
| Boost qualification | `BoosterQualification` (user + difficulty) | ADMIN via grant/revoke (and legacy approve bridge) |

A USER may hold Heroic/Mythic qualifications without becoming RAID_LEAD. Role changes do not create or revoke qualifications.

## ADMIN Direct Grant

After Discord review, ADMIN grants with `boosterQualificationService.grant({ userId, difficulty, notes? })`.

`/manage/booster-access` defaults to **Qualifications** (User + Difficulty). **Legacy Requests · N** lists only unresolved historical PENDING Class/Role applications. Approving a legacy row grants the matching difficulty qualification and resolves same-difficulty PENDING siblings.

- Creates APPROVED when no qualification exists
- Reactivates REVOKED on the same unique row
- Duplicate APPROVED → already-approved error
- Character / Class / Role are not grant fields
- Does not require Character, specialization, or item level
- May target USER, RAID_LEAD, ADMIN, or the acting ADMIN (no automatic ADMIN bypass)

RAID_LEAD cannot grant.

## Session Role Freshness

Trusted controllers load the session user with `userRepository.findAuthenticatedById`. That read returns current `User.accountRole` from the database on each request. Role changes therefore apply without session cookie invalidation or forced re-login.

## Audit

Successful role changes create an `ActivityEvent`:

- `type`: `ACCOUNT_ROLE_CHANGED`
- `userId`: acting admin
- `message`: includes previous/next role labels and `targetUserId=<id>`

User detail surfaces those events for the target account.

## Authorization

| Actor | List / detail users | Change account role | Manage nav users link |
| --- | --- | --- | --- |
| USER | no | no | no |
| RAID_LEAD | no | no | no |
| ADMIN | yes | yes, except the OWNER and except assigning OWNER | yes |
| OWNER | yes | yes, except itself and except assigning OWNER | yes |

Service gate: `assertCanManageUsers` → `USER_MANAGEMENT_FORBIDDEN`.

Controller: `requireAdmin` on role-change actions. Pages use admin redirects.

## MVCS

- Model: `User.accountRole`, `ActivityEvent`
- View: manage hub cards, `/manage/users`, user detail, change-role dialog
- Controller: `user-management.actions.ts`, app/management controllers for page data
- Service: `userManagementService`, `managementHubService`
- Repository: `userRepository` (list/detail/count/update role/non-terminal runs), `activityRepository`

## Security

- Role mutations require ADMIN session; target role validated server-side
- Last-admin and active-run guards run in the service before persist
- OAuth / clients cannot set `accountRole` (`input: false` on the auth user model)
- Audit messages identify actor and target without exposing secrets
- Navigation hiding is presentation only; every mutation re-checks authorization
