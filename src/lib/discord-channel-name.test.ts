import { describe, expect, it } from "vitest";
import {
  buildClosedDiscordRunChannelName,
  buildDiscordRunChannelName,
  effectiveRaidLeadChannelName,
  slugDiscordChannelSegment,
} from "@/lib/discord-channel-name";

// 2026-09-12 20:00 UTC = Saturday 22:00 Europe/Berlin (CEST, UTC+2) during DST.
const SATURDAY_2200_BERLIN = "2026-09-12T20:00:00.000Z";

const BASE = {
  scheduledStartAt: SATURDAY_2200_BERLIN,
  difficulty: "HEROIC" as const,
  lootType: "VIP" as const,
  coverage: "7of9",
  raidLeadChannelName: "Titan",
};

describe("buildDiscordRunChannelName", () => {
  it("builds the weekday-HHMM-difficulty-lootType-coverage-raidLead form", () => {
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

  it("uses the provided coverage token verbatim (content-native)", () => {
    expect(buildDiscordRunChannelName({ ...BASE, coverage: "8of8" })).toContain("-8of8-");
    expect(buildDiscordRunChannelName({ ...BASE, coverage: "1of8" })).toContain("-1of8-");
  });

  it("normalizes the raid lead name: spaces, punctuation, and diacritics", () => {
    expect(
      buildDiscordRunChannelName({ ...BASE, raidLeadChannelName: "Dr. Emile O'Connor Jr." }),
    ).toBe("sat-2200-hc-vip-7of9-dr-emile-o-connor-jr");
    expect(slugDiscordChannelSegment("Sÿntax")).toBe("syntax");
    expect(buildDiscordRunChannelName({ ...BASE, raidLeadChannelName: "Sÿntax" })).toBe(
      "sat-2200-hc-vip-7of9-syntax",
    );
  });

  it("collapses duplicate separators and never leaves a leading/trailing hyphen", () => {
    expect(buildDiscordRunChannelName({ ...BASE, raidLeadChannelName: "  --Titan--  " })).toBe(
      "sat-2200-hc-vip-7of9-titan",
    );
  });

  it("is deterministic for the same input", () => {
    expect(buildDiscordRunChannelName(BASE)).toBe(buildDiscordRunChannelName(BASE));
  });

  it("formats midnight and single-digit minutes with zero-padding", () => {
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
    const name = buildDiscordRunChannelName({ ...BASE, raidLeadChannelName: "A".repeat(200) });
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith("-")).toBe(false);
  });

  it("encodes Season 2 Bundle coverage as Nof9 without s2b prefix", () => {
    expect(
      buildDiscordRunChannelName({
        ...BASE,
        coverage: "9of9",
      }),
    ).toBe("sat-2200-hc-vip-9of9-titan");
    expect(
      buildDiscordRunChannelName({
        ...BASE,
        coverage: "7of9",
      }),
    ).toContain("7of9");
    expect(
      buildDiscordRunChannelName({
        ...BASE,
        coverage: "9of9",
      }),
    ).not.toContain("s2b");
  });

  it("uses nickname slug for Syntax1991 → Syntax", () => {
    expect(
      buildDiscordRunChannelName({
        ...BASE,
        coverage: "9of9",
        raidLeadChannelName: effectiveRaidLeadChannelName({
          raidLeadName: "Syntax1991",
          discordRunChannelNickname: "Syntax",
        }),
      }),
    ).toBe("sat-2200-hc-vip-9of9-syntax");
  });

  it("falls back to User.name when nickname is null", () => {
    expect(
      buildDiscordRunChannelName({
        ...BASE,
        coverage: "9of9",
        raidLeadChannelName: effectiveRaidLeadChannelName({
          raidLeadName: "Syntax1991",
          discordRunChannelNickname: null,
        }),
      }),
    ).toBe("sat-2200-hc-vip-9of9-syntax1991");
  });

  it("effective Raid Lead name: nickname wins, else raw name (also used by the Final Setup footer)", () => {
    expect(effectiveRaidLeadChannelName({ raidLeadName: "Simon", discordRunChannelNickname: "Syntax" })).toBe("Syntax");
    expect(effectiveRaidLeadChannelName({ raidLeadName: "Kiri", discordRunChannelNickname: null })).toBe("Kiri");
    expect(effectiveRaidLeadChannelName({ raidLeadName: "Kiri", discordRunChannelNickname: "   " })).toBe("Kiri");
    // Human-readable, not slugged: the Final Setup message shows it as-is.
    expect(effectiveRaidLeadChannelName({ raidLeadName: "Simon", discordRunChannelNickname: "Syn Tax" })).toBe("Syn Tax");
  });

  it("slugifies spaces and underscores in nickname", () => {
    expect(slugDiscordChannelSegment("Syntax 91")).toBe("syntax-91");
    expect(slugDiscordChannelSegment("Syntax_91")).toBe("syntax-91");
  });
});

describe("buildClosedDiscordRunChannelName", () => {
  it("prefixes the live slug with closed-", () => {
    expect(buildClosedDiscordRunChannelName(BASE)).toBe("closed-sat-2200-hc-vip-7of9-titan");
  });

  it("stays within Discord's 100-character limit", () => {
    const name = buildClosedDiscordRunChannelName({ ...BASE, raidLeadChannelName: "A".repeat(200) });
    expect(name.startsWith("closed-")).toBe(true);
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith("-")).toBe(false);
  });

  it("uses nickname for closed channel names", () => {
    expect(
      buildClosedDiscordRunChannelName({
        ...BASE,
        coverage: "9of9",
        raidLeadChannelName: "Syntax",
      }),
    ).toBe("closed-sat-2200-hc-vip-9of9-syntax");
  });
});
