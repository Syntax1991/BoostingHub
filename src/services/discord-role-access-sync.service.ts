import { discordGuildMemberClient } from "@/integrations/discord/discord-guild-member.client";
import { getDiscordRoleAccessSyncConfig } from "@/lib/discord-config";
import { userRepository } from "@/repositories/user.repository";
import { applyDiscordMemberName } from "@/services/discord-member-name-sync.service";

export type DiscordRoleAccessSyncInput = { userId: string };

/**
 * Authoritative Discord → Discord-derived access sync.
 *
 * Updates only User.discordRaidBooster / User.discordLootbuddy from an
 * authoritative guild member response. Never touches manual isBooster /
 * isLootbuddy. Transient Discord failures preserve last-known Discord grants.
 *
 * Semantics:
 * - member roles include Raid Booster → discordRaidBooster = true
 * - otherwise (authoritative) → discordRaidBooster = false
 * - same for Lootbuddy, independently
 * - HTTP 404 (not in guild) → both Discord grants false
 * - transport / non-404 errors → throw (caller preserves prior state)
 *
 * The same member read also refreshes the displayed player name
 * (discord-member-name-sync) — no extra Discord request.
 */
export async function syncDiscordRoleAccessOrThrow(
  input: DiscordRoleAccessSyncInput,
): Promise<void> {
  const config = getDiscordRoleAccessSyncConfig();
  if (!config) {
    return;
  }

  const user = await userRepository.findById(input.userId);
  if (!user?.discordUserId) {
    return;
  }

  const member = await discordGuildMemberClient.getMember(user.discordUserId, config);
  await syncRoleAccessFromMember(input.userId, member?.roleIds ?? null, config);
  await applyDiscordMemberName(input.userId, member);
}

async function syncRoleAccessFromMember(
  userId: string,
  roleIds: string[] | null,
  config: NonNullable<ReturnType<typeof getDiscordRoleAccessSyncConfig>>,
): Promise<void> {
  if (roleIds === null) {
    // Authoritative absence from guild — clear Discord-derived grants only.
    await userRepository.setDiscordRoleAccess(userId, {
      discordRaidBooster: false,
      discordLootbuddy: false,
    });
    return;
  }

  const discordRaidBooster = roleIds.includes(config.raidBoosterRoleId);
  const discordLootbuddy = roleIds.includes(config.lootbuddyRoleId);

  const current = await userRepository.findBoostingRoles(userId);
  if (!current) {
    return;
  }
  if (
    current.discordRaidBooster === discordRaidBooster &&
    current.discordLootbuddy === discordLootbuddy
  ) {
    return;
  }

  await userRepository.setDiscordRoleAccess(userId, {
    discordRaidBooster,
    discordLootbuddy,
  });
}

/**
 * Safe Better Auth hook wrapper: Discord or database failures must never turn
 * a successful OAuth sign-in into an authentication outage. On failure, last
 * authoritative Discord grants are preserved.
 */
export async function syncDiscordRoleAccess(
  input: DiscordRoleAccessSyncInput,
): Promise<void> {
  try {
    await syncDiscordRoleAccessOrThrow(input);
  } catch (error) {
    console.error("[discord-role-access-sync] login-time Discord role access sync failed:", error);
  }
}

/** @deprecated Prefer syncDiscordRoleAccess. */
export const syncDiscordBoosterRole = syncDiscordRoleAccess;
/** @deprecated Prefer syncDiscordRoleAccessOrThrow. */
export const syncDiscordBoosterRoleOrThrow = syncDiscordRoleAccessOrThrow;
