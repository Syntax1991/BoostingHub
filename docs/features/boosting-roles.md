# Boosting Roles

## Purpose

Let an ADMIN (or the OWNER) grant and revoke a User's **Boosting Roles** after Discord review.

## Account role vs Boosting Roles

Two independent concepts live on the User:

| Concept | Values | Controls |
| --- | --- | --- |
| **Account role** (`User.accountRole`) | `USER` · `RAID_LEAD` · `ADMIN` · `OWNER` | Platform authorization — what a User may manage |
| **Boosting Roles** (`User.isBooster`, `User.isLootbuddy`) | Booster · Lootbuddy (each on/off) | Operational participation |

A User may hold zero, one or both Boosting Roles, independently of the account role and of each other — `USER + Booster`, `USER + Lootbuddy`, `ADMIN + Booster`, `OWNER + Booster + Lootbuddy` are all valid. Booster and Lootbuddy are **never** account roles, and they are **never** stored on a Character. ADMIN / OWNER do not receive a Boosting Role automatically.

Run participation (`RunSignup.participationType` = `BOOSTER` / `LOOTBUDDY`) is still chosen per signup; the Boosting Roles are account-level capabilities.

## Booster

`User.isBooster = true` means the User is approved to sign up and be rostered as a Booster.

**The Booster role is not scoped by raid difficulty.** An approved Booster may boost Normal, Heroic and Mythic Runs alike. **Run difficulty remains relevant** everywhere else — Runs, raid contents, lockouts, weekly availability, signup display, rosters, Discord run posts, history and payouts — it is simply not part of the Booster question.

The single check is `isApprovedBooster({ isBooster })` in `src/services/boosting-role.service.ts`. It does not depend on Character, WoW Class, specialization, Character Role, Item Level, account role, or Raid Difficulty.

| Concern | Question |
| --- | --- |
| Booster role | Is this User an approved Booster? |
| Character eligibility | May this Character be used in this Run? |
| Roster composition | Do we want this Character/role on the roster? |

Signup options and roster revalidation read the signup owner's `isBooster` only (hydrated onto Character / roster rows as `ownerIsBooster`). Character ownership, active state, valid role-for-class, weekly availability, cross-Run reservation, lockouts (informational), run/signup state and composition rules are separate and unchanged. A non-Booster is rejected with `NO_BOOSTER_ACCESS` (options) / `BOOSTER_ACCESS_REQUIRED` (signup) on every difficulty; there is no difficulty-specific rejection. Revoking the role takes effect immediately: the owner's roster rows show "Owner no longer has the Booster role." and block publish until resolved; existing signups and history stay.

## Lootbuddy

`User.isLootbuddy = true` marks the User as a recognised Lootbuddy. Today it is a **management and display capability only**:

- Lootbuddy signups (characterless `RunSignup` rows with class / mode / verification) are open to every User and are **not** gated by `isLootbuddy` — there was no Lootbuddy eligibility gate before, and none was invented.
- Lootbuddy payout (`0` default Cuts) is unchanged.
- Existing Users start with `isLootbuddy = false`; there was no authoritative source to derive it from.

## Managing the roles

Only ADMIN / OWNER (`canManageBoostingRoles`) may change Boosting Roles, and only through the explicit operation `boostingRoleService.setRole(admin, { userId, role: "BOOSTER" | "LOOTBUDDY", enabled, reason? })` (server action `setBoostingRoleAction`). The raw booleans are never accepted by a generic User update. Setting a role to the state it already has is a no-op (no write, no audit event).

Surfaces:

- **`/manage/users/[id]`** — primary place: a **Boosting roles** card with a Booster row and a Lootbuddy row, each Enabled/Disabled with Grant / Revoke (optional reason). No difficulty selector.
- **`/manage/boosting-roles`** — overview of every User with inline Booster / Lootbuddy controls, search, and tabs All users · Boosters · Lootbuddies · Neither. A second tab, **Legacy Requests**, holds historical PENDING requests (below). The old `/manage/booster-access` URL redirects here.
- **`/manage/users`** — Boosting roles column (badges for enabled roles only) and a Boosting role filter (Booster / Lootbuddy / Neither).
- **Management hub** — Boosting Roles card: Boosters, Lootbuddies, Legacy pending.

Audit: every change writes an `ActivityEvent` under the acting admin — `BOOSTER_GRANTED`, `BOOSTER_REVOKED`, `LOOTBUDDY_GRANTED`, `LOOTBUDDY_REVOKED` — with a `targetUserId=<id>` marker so it also appears in the target's audit trail on `/manage/users/[id]`. No difficulty is recorded.

Onboarding:

```text
User → Apply via Discord → staff review → ADMIN grants the Booster role
```

Self-service in-app requests stay disabled (`BOOSTER_ACCESS_SELF_REQUEST_DISABLED`). User-facing pages show an **Apply via Discord** CTA when `DISCORD_BOOSTER_TICKET_URL` is set. A User may receive the Booster role with zero Characters.

## User-facing display

- **Profile** — a **Boosting roles** card showing only the enabled roles (e.g. `Booster` `Lootbuddy`), or "No boosting role yet".
- **`/characters`** — one **Your boosting roles** line for the account (not repeated per Character), with the Discord CTA when not a Booster.
- **Character detail** — a compact **Booster signups** note: the Booster role belongs to the account and covers every difficulty.
- **`/manage/characters/[id]`** — the owner's Boosting Roles, read-only.

Never shown: `Booster · Normal / Heroic / Mythic` — the Booster role has no difficulty.

## HISTORICAL REQUEST vs CURRENT CAPABILITY

| | Model | Meaning |
| --- | --- | --- |
| Historical request | `BoosterAccess` | What was requested at the time (User + Class + Role + Difficulty, optional Character context), `PENDING` / `APPROVED` / `REJECTED` / `REVOKED` |
| Current capability | `User.isBooster` | Whether the User is an approved Booster **now** |

`BoosterAccess` rows are preserved as history and are **never read for eligibility**; nothing in current eligibility depends on them.

**Legacy Requests · N** (`/manage/boosting-roles?view=legacy`) lists unresolved historical `PENDING` rows, filterable by requested difficulty and role:

- **Approve** marks that row and every other PENDING row of the same User `APPROVED` (their recorded difficulty is kept) and grants the account-level Booster role (a no-op if the User already has it).
- **Reject** marks the row `REJECTED`; it never changes Boosting Roles. Reviewed rows are never rewritten by a later approval.

## Migration

`20260927T1408_boosting_roles_on_user` upgrades directly from the production schema, where `BoosterQualification` was one row per (User, Difficulty):

1. adds `user.isBooster` / `user.isLootbuddy` (`NOT NULL DEFAULT false`);
2. sets `isBooster = true` for every User with **any** `APPROVED` qualification row, whatever its difficulty (Normal, Heroic, Mythic, several, or approved + revoked). Users with only `REVOKED` rows, or none, stay `false` — no approved booster loses access;
3. drops `booster_qualification`.

`isLootbuddy` stays `false` for everyone. `booster_access` is not touched. The migration is covered by `src/prisma/boosting-roles-migration.test.ts`.

## Out of scope here

Discord bot automation, mass signup, Strikes, Deducts, Lootbuddy eligibility or payout rules, difficulty-specific booster permissions.
