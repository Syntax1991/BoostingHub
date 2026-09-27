# Discord Raidbooster Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically grant the existing Booster capability at Discord sign-in when the member holds role `1527022823103791104`, without removing manual role management.

**Architecture:** A focused Discord guild-member client reads role IDs with bot authentication. A safe login-time service reloads the persisted User, grants only `User.isBooster`, and converts missing configuration, missing membership, and upstream failures into no-ops so authentication remains available.

**Tech Stack:** TypeScript, Better Auth database hooks, Discord HTTP API v10, Prisma ORM, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-27-discord-raidbooster-access-design.md`

## Global Constraints

- Keep ADMIN / OWNER manual Booster grant and revoke behavior unchanged.
- Never auto-revoke Booster access.
- Never block sign-in on Discord lookup or persistence failure.
- Use `DISCORD_BOOSTER_ROLE_ID=1527022823103791104` in production configuration; do not hardcode it in application logic.
- Do not change schema, migrations, Lootbuddy, account roles, signup, roster, or deployment units.

## Review Focus

- Discord role present: grants Booster while preserving account role and Lootbuddy.
- Discord role absent or member missing: leaves both manual grant and manual revoke states unchanged.
- Discord API timeout/error/malformed response: sign-in completes and no capability changes.
- Missing configuration or missing persisted Discord identity: makes no network call and no write.
- Manual revoke followed by a login while the Discord role remains: re-grants Booster as approved.

---

### Task 1: Discord member-role lookup

**Files:**
- Create: `src/integrations/discord/discord-guild-member.client.ts`
- Create: `src/integrations/discord/discord-guild-member.client.test.ts`
- Modify: `src/lib/discord-config.ts`

**Interfaces:**
- Consumes: server-only `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_BOOSTER_ROLE_ID`.
- Produces: `getDiscordBoosterRoleSyncConfig()` and `discordGuildMemberClient.listRoleIds(discordUserId, config)`.

- [ ] **Step 1: Write failing client/config tests** for complete configuration, missing configuration, bot authorization, member role parsing, 404, non-2xx, malformed JSON, and network failure.
- [ ] **Step 2: Run the focused test and verify it fails** because the new interfaces do not exist.
- [ ] **Step 3: Implement the minimal config reader and Discord API v10 client** with an abort timeout and no secret logging.
- [ ] **Step 4: Run the focused test and verify it passes.**
- [ ] **Step 5: Commit** the client, config, and tests.

### Task 2: Additive login-time Booster grant

**Files:**
- Create: `src/services/discord-booster-role-sync.service.ts`
- Create: `src/services/discord-booster-role-sync.service.test.ts`
- Modify: `src/auth/auth.ts`

**Interfaces:**
- Consumes: Task 1 config/client, `userRepository.findById`, `findBoostingRoles`, and `setBoostingRole`.
- Produces: `syncDiscordBoosterRole(input)` safe wrapper used by Better Auth's session-create hook.

- [ ] **Step 1: Write failing service tests** covering the five Review Focus cases plus first/returning login hook integration.
- [ ] **Step 2: Run the focused test and verify it fails** because the service and hook behavior do not exist.
- [ ] **Step 3: Implement the additive safe wrapper and wire it after the existing development bootstrap.**
- [ ] **Step 4: Run both new test files and verify they pass.**
- [ ] **Step 5: Commit** the service, hook, and tests.

### Task 3: Configuration and operator documentation

**Files:**
- Modify: `.env.example`
- Modify: `deploy/production/env-status.py`
- Modify: `deploy/production/env-status.test.sh`
- Modify: `docs/authentication.md`
- Modify: `docs/features/boosting-roles.md`
- Modify: `docs/deployment-production.md`

**Interfaces:**
- Consumes: Tasks 1-2 environment contract and approved additive semantics.
- Produces: discoverable local/production configuration and deployment verification.

- [ ] **Step 1: Extend the environment-status fixture/assertion** so the role ID is listed as a public Discord snowflake.
- [ ] **Step 2: Run the offline environment-status test and verify it fails** before the checker recognizes the new key.
- [ ] **Step 3: Document and expose `DISCORD_BOOSTER_ROLE_ID`, login-time additive behavior, and the no-auto-revoke rule.**
- [ ] **Step 4: Run the environment-status test and focused application tests.**
- [ ] **Step 5: Commit** documentation and operator configuration.
