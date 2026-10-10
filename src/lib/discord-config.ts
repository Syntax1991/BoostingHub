import type { DiscordRoleAccessSyncConfig } from "@/integrations/discord/discord-guild-member.client";

/**
 * Central Discord destination links. Public URLs only — never secrets.
 * Manual Boosting Roles remain on User.isBooster / User.isLootbuddy;
 * Discord-derived grants are independent (User.discordRaidBooster /
 * User.discordLootbuddy).
 */
export function getDiscordBoosterTicketUrl(): string | null {
  const value = process.env.DISCORD_BOOSTER_TICKET_URL?.trim();
  return value && value.length > 0 ? value : null;
}

/**
 * Server-only configuration for Discord-derived Raid Booster / Lootbuddy
 * access grants. Role IDs authorize; names are never used for access.
 *
 * Env names:
 * - DISCORD_BOOSTER_ROLE_ID — Raid Booster role (existing production key)
 * - DISCORD_LOOTBUDDY_ROLE_ID — Lootbuddy role
 */
export function getDiscordRoleAccessSyncConfig(): DiscordRoleAccessSyncConfig | null {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  const raidBoosterRoleId = process.env.DISCORD_BOOSTER_ROLE_ID?.trim();
  const lootbuddyRoleId = process.env.DISCORD_LOOTBUDDY_ROLE_ID?.trim();
  if (!botToken || !guildId || !raidBoosterRoleId || !lootbuddyRoleId) {
    return null;
  }
  return { botToken, guildId, raidBoosterRoleId, lootbuddyRoleId };
}

/** @deprecated Prefer getDiscordRoleAccessSyncConfig — kept for transitional imports. */
export function getDiscordBoosterRoleSyncConfig(): DiscordRoleAccessSyncConfig | null {
  return getDiscordRoleAccessSyncConfig();
}

/** The community guild (DISCORD_GUILD_ID) — public id, used for channel deep links. */
export function getDiscordGuildId(): string | null {
  const value = process.env.DISCORD_GUILD_ID?.trim();
  return value && value.length > 0 ? value : null;
}

/** Management role ping for Community Schedule Share copy (not auto-posted). */
export function getDiscordManagementScheduleRoleId(): string | null {
  const value = process.env.DISCORD_MANAGEMENT_SCHEDULE_ROLE_ID?.trim();
  return value && value.length > 0 ? value : null;
}

/** Whether Discord role-access sync is fully configured (both role IDs present). */
export function isDiscordRoleAccessConfigured(): boolean {
  return getDiscordRoleAccessSyncConfig() !== null;
}
