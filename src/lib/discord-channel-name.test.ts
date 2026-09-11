import { describe, expect, it } from "vitest";
import { buildDiscordRunChannelName } from "@/lib/discord-channel-name";

// 2026-09-12 20:00 UTC = Saturday 22:00 Europe/Berlin (CEST, UTC+2) during DST.
const SATURDAY_2200_BERLIN = "2026-09-12T20:00:00.000Z";

const BASE = {
  scheduledStartAt: SATURDAY_2200_BERLIN,
  difficulty: "HEROIC" as const,
  lootType: "VIP" as const,
  plannedBossCount: 7,
  totalBossCount: 9,
  raidLeadName: "Titan",
};

describe("buildDiscordRunChannelName", () => {
  it("builds the weekday-HHMM-difficulty-lootType-bossCoverage-raidLead form", () => {
    expect(buildDiscordRunChannelName(BASE)).toBe("sat-2200-hc-vip-7of9-titan");
  });

  it("abbreviates all three difficulties consistently", () => {
    expect(buildDiscordRunChannelName({ ...BASE, difficulty: "NORMAL" })).toContain("-nm-");
    expect(buildDiscordRunChannelName({ ...BASE, difficulty: "HEROIC" })).toContain("-hc-");
    expect(buildDiscordRunChannelName({ ...BASE, difficulty: "MYTHIC", lootType: "UNSAVED" })).toContain("-my-");
  });

  it("lowercases all three loot types consistently, as separate segments from difficulty", () => {
    expect(buildDiscordRunChannelName({ ...BASE, lootType: "SAVED" })).toContain("-hc-saved-");
    expect(buildDiscordRunChannelName({ ...BASE, lootType: "UNSAVED" })).toContain("-hc-unsaved-");
    expect(buildDiscordRunChannelName({ ...BASE, lootType: "VIP" })).toContain("-hc-vip-");
  });

  it("never concatenates difficulty and lootType into one segment", () => {
    const name = buildDiscordRunChannelName({ ...BASE, difficulty: "MYTHIC", lootType: "UNSAVED" });
    expect(name).not.toContain("myunsaved");
    expect(name).not.toContain("my-saved");
  });

  it("renders boss coverage as plannedOftotal", () => {
    expect(buildDiscordRunChannelName({ ...BASE, plannedBossCount: 9, totalBossCount: 9 })).toContain("-9of9-");
    expect(buildDiscordRunChannelName({ ...BASE, plannedBossCount: 1, totalBossCount: 9 })).toContain("-1of9-");
  });

  it("normalizes the raid lead name: spaces, punctuation, and diacritics", () => {
    expect(
      buildDiscordRunChannelName({ ...BASE, raidLeadName: "Dr. Émile O'Connor Jr." }),
    ).toBe("sat-2200-hc-vip-7of9-dr-emile-o-connor-jr");
  });

  it("collapses duplicate separators and never leaves a leading/trailing hyphen", () => {
    expect(buildDiscordRunChannelName({ ...BASE, raidLeadName: "  --Titan--  " })).toBe(
      "sat-2200-hc-vip-7of9-titan",
    );
  });

  it("is deterministic for the same input", () => {
    expect(buildDiscordRunChannelName(BASE)).toBe(buildDiscordRunChannelName(BASE));
  });

  it("formats midnight and single-digit minutes with zero-padding", () => {
    // 2026-09-14 22:03 UTC = Tuesday 00:03 Europe/Berlin (CEST, next calendar day).
    expect(
      buildDiscordRunChannelName({
        ...BASE,
        scheduledStartAt: "2026-09-14T22:03:00.000Z",
        difficulty: "NORMAL",
        lootType: "UNSAVED",
      }),
    ).toBe("tue-0003-nm-unsaved-7of9-titan");
  });

  it("truncates to Discord's 100-character channel name limit without a dangling hyphen", () => {
    const name = buildDiscordRunChannelName({ ...BASE, raidLeadName: "A".repeat(200) });
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith("-")).toBe(false);
  });
});
