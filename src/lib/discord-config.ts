import type { DiscordBoosterRoleSyncConfig } from "@/integrations/discord/discord-guild-member.client";

/**
 * Central Discord destination links. Public URLs only — never secrets.
 * Booster applications are reviewed in Discord; BoostingHub remains the
 * authoritative store of Boosting Roles (User.isBooster / User.isLootbuddy).
 */
export function getDiscordBoosterTicketUrl(): string | null {
  const value = process.env.DISCORD_BOOSTER_TICKET_URL?.trim();
  return value && value.length > 0 ? value : null;
}

/** Server-only configuration for additive Discord-role Booster grants. */
export function getDiscordBoosterRoleSyncConfig(): DiscordBoosterRoleSyncConfig | null {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  const boosterRoleId = process.env.DISCORD_BOOSTER_ROLE_ID?.trim();
  if (!botToken || !guildId || !boosterRoleId) {
    return null;
  }
  return { botToken, guildId, boosterRoleId };
}
