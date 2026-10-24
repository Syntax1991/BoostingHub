import { describe, expect, it } from "vitest";
import { effectiveRaidLeadChannelName } from "@/lib/discord-channel-name";
import { getRaidLeadDisplayName } from "@/lib/raid-lead-display";

describe("Raid Lead display identity", () => {
  it("nickname when set, else the account name; blank nicknames fall back", () => {
    expect(getRaidLeadDisplayName({ name: "Nyxara", discordRunChannelNickname: "Alantra" })).toBe("Alantra");
    expect(getRaidLeadDisplayName({ name: "Nyxara", discordRunChannelNickname: null })).toBe("Nyxara");
    expect(getRaidLeadDisplayName({ name: "Nyxara", discordRunChannelNickname: "   " })).toBe("Nyxara");
    expect(getRaidLeadDisplayName({ name: "Nyxara" })).toBe("Nyxara");
  });

  it("the Discord Run channel uses the same identity", () => {
    expect(effectiveRaidLeadChannelName({ raidLeadName: "Nyxara", discordRunChannelNickname: "Alantra" })).toBe("Alantra");
    expect(effectiveRaidLeadChannelName({ raidLeadName: "Nyxara", discordRunChannelNickname: null })).toBe("Nyxara");
  });
});
