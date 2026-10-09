/**
 * Compatibility: former additive isBooster sync tests replaced by
 * discord-role-access-sync.service.test.ts (independent Discord grants).
 */
import { describe, expect, it } from "vitest";
import {
  syncDiscordBoosterRole,
  syncDiscordRoleAccess,
} from "@/services/discord-booster-role-sync.service";

describe("discord-booster-role-sync compatibility re-exports", () => {
  it("aliases syncDiscordBoosterRole to syncDiscordRoleAccess", () => {
    expect(syncDiscordBoosterRole).toBe(syncDiscordRoleAccess);
  });
});
