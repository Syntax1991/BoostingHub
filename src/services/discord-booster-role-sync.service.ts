/**
 * Compatibility re-exports. Prefer `@/services/discord-role-access-sync.service`.
 */
export {
  syncDiscordRoleAccess as syncDiscordBoosterRole,
  syncDiscordRoleAccessOrThrow as syncDiscordBoosterRoleOrThrow,
  syncDiscordRoleAccess,
  syncDiscordRoleAccessOrThrow,
} from "@/services/discord-role-access-sync.service";
