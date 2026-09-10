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

`BOOSTER` and `LOOTBUDDY` are run participation types, never account roles.

## User Listing

Route: `/manage/users` (ADMIN only).

Lists accounts with role, Discord identity hints, character counts, and difficulty-qualification tallies. Filters/sorts are applied in `userRepository.listAdminUsers` via `userManagementService.listUsers`.

## User Detail

Route: `/manage/users/[userId]`.

Shows identity, account role/status, characters, difficulty qualifications (with direct Grant access), disciplinary Strike history (Add/Revoke), and recent audit events relevant to that user (including `ACCOUNT_ROLE_CHANGED` events authored by another admin that mention `targetUserId=`).

Strikes are a separate concept from account role, qualifications, and audit — see [strikes-and-deducts.md](strikes-and-deducts.md).

## Role Administration

ADMIN changes roles through `userManagementService.changeAccountRole`.

Supported transitions include USER → RAID_LEAD, RAID_LEAD → ADMIN, and ADMIN → USER (when another admin remains). Same-role assignments throw `ROLE_ALREADY_ASSIGNED`. Unknown values throw `INVALID_ACCOUNT_ROLE`.

Clients cannot invent roles outside `ACCOUNT_ROLES`.

## Last Admin

Demoting an ADMIN when `countAdmins() <= 1` throws `LAST_ADMIN_REQUIRED`. The platform must keep at least one Admin account. The service re-checks immediately before persist to reduce concurrent demotion races.

## Active Run Safety

Demoting an account that currently has raid-lead access (`RAID_LEAD` or `ADMIN`) to a role without it (`USER`) is blocked while that user is `raidLeadId` on any non-terminal run (`DRAFT`, `OPEN`, `ROSTERING`, `PUBLISHED`, `IN_PROGRESS`).

Error: `ROLE_CHANGE_BLOCKED_BY_ACTIVE_RUNS`.

`COMPLETED` and `CANCELLED` runs do not block.

## Discord Booster Applications

Self-service creation of PENDING legacy `BoosterAccess` is disabled. Character pages show a Discord ticket CTA when `DISCORD_BOOSTER_TICKET_URL` is set. Review happens in Discord; BoostingHub remains the authoritative qualification store.

See [booster-access-management.md](booster-access-management.md).

## BoosterQualification vs Account Role

| Concern | Store | Who mutates |
| --- | --- | --- |
| Platform permission | `User.accountRole` | ADMIN via user management |
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
| ADMIN | yes | yes | yes |

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
