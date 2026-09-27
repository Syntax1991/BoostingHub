import { discordGuildMemberClient } from "@/integrations/discord/discord-guild-member.client";
import { getDiscordBoosterRoleSyncConfig } from "@/lib/discord-config";
import { userRepository } from "@/repositories/user.repository";

export type DiscordBoosterRoleSyncInput = { userId: string };

/**
 * Additive core sync. A Discord role may grant Booster, but role absence never
 * revokes a manual grant. Throws only so the safe login wrapper can report one
 * bounded error while keeping authentication available.
 */
export async function syncDiscordBoosterRoleOrThrow(
  input: DiscordBoosterRoleSyncInput,
): Promise<void> {
  const config = getDiscordBoosterRoleSyncConfig();
  if (!config) {
    return;
  }

  // Re-read the already-persisted User. Never trust identity fields supplied
  // by a hook caller.
  const user = await userRepository.findById(input.userId);
  if (!user?.discordUserId) {
    return;
  }

  const roleIds = await discordGuildMemberClient.listRoleIds(user.discordUserId, config);
  if (!roleIds?.includes(config.boosterRoleId)) {
    return;
  }

  const current = await userRepository.findBoostingRoles(input.userId);
  if (!current || current.isBooster) {
    return;
  }

  await userRepository.setBoostingRole(input.userId, "BOOSTER", true);
}

/**
 * Safe Better Auth hook wrapper: Discord or database failures must never turn
 * a successful OAuth sign-in into an authentication outage.
 */
export async function syncDiscordBoosterRole(
  input: DiscordBoosterRoleSyncInput,
): Promise<void> {
  try {
    await syncDiscordBoosterRoleOrThrow(input);
  } catch (error) {
    console.error("[discord-booster-role-sync] login-time Booster sync failed:", error);
  }
}
