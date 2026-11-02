import { describe, expect, it } from "vitest";
import {
  buildClosedDiscordRunChannelName,
  buildDiscordRunChannelName,
  DISCORD_CHANNEL_NAME_MAX,
  formatRunVoiceChannelName,
  raidWeekMinuteFromChannelName,
  raidWeekMinuteFromSchedule,
  slugDiscordChannelSegment,
} from "@/lib/discord-channel-name";

// 2026-09-12 20:00 UTC = Saturday 22:00 Europe/Berlin (CEST, UTC+2) during DST.
const SATURDAY_2200_BERLIN = "2026-09-12T20:00:00.000Z";

const BASE = {
  scheduledStartAt: SATURDAY_2200_BERLIN,
  difficulty: "HEROIC" as const,
  lootType: "VIP" as const,
  coverage: "7of9",
  raidLeadChannelName: "Alpha",
};

describe("buildDiscordRunChannelName", () => {
  it("builds the weekday-HHMM-difficulty-lootType-coverage-raidLead form", () => {
    expect(buildDiscordRunChannelName(BASE)).toBe("sat-2200-hc-vip-7of9-alpha");
  });

  it("abbreviates Normal/Heroic and spells Mythic (never my)", () => {
    expect(buildDiscordRunChannelName({ ...BASE, difficulty: "NORMAL" })).toContain("-nm-");
    expect(buildDiscordRunChannelName({ ...BASE, difficulty: "HEROIC" })).toContain("-hc-");
    const mythic = buildDiscordRunChannelName({ ...BASE, difficulty: "MYTHIC", lootType: "UNSAVED" });
    expect(mythic).toContain("-mythic-");
    expect(mythic).not.toContain("-my-");
  });

  it("maps every run type to its Discord channel token, separate from difficulty", () => {
    expect(buildDiscordRunChannelName({ ...BASE, lootType: "SAVED" })).toContain("-hc-saved-");
    expect(buildDiscordRunChannelName({ ...BASE, lootType: "UNSAVED" })).toContain("-hc-unsaved-");
    expect(buildDiscordRunChannelName({ ...BASE, lootType: "VIP" })).toContain("-hc-vip-");
    expect(buildDiscordRunChannelName({ ...BASE, lootType: "COMMUNITY" })).toContain("-hc-com-");
    expect(buildDiscordRunChannelName({ ...BASE, lootType: "COMMUNITY" })).not.toContain("-community-");
  });

  it("builds Mythic + Community as -mythic-com-, never -my- or -community-", () => {
    const name = buildDiscordRunChannelName({
      ...BASE,
      difficulty: "MYTHIC",
      lootType: "COMMUNITY",
      coverage: "8of8",
      raidLeadChannelName: "IvO",
    });
    expect(name).toContain("-mythic-com-");
    expect(name).not.toContain("-my-");
    expect(name).not.toContain("-community-");
  });

  it("builds Heroic + VIP / Mythic + VIP / Heroic + Community examples", () => {
    const fri = "2026-09-11T18:15:00.000Z"; // Fri 20:15 Berlin
    const lead = "IvO";
    const coverage = "8of8";
    expect(
      buildDiscordRunChannelName({
        scheduledStartAt: fri,
        difficulty: "HEROIC",
        lootType: "VIP",
        coverage,
        raidLeadChannelName: lead,
      }),
    ).toMatch(/^[a-z]{3}-2015-hc-vip-8of8-ivo$/);
    expect(
      buildDiscordRunChannelName({
        scheduledStartAt: fri,
        difficulty: "MYTHIC",
        lootType: "VIP",
        coverage,
        raidLeadChannelName: lead,
      }),
    ).toMatch(/^[a-z]{3}-2015-mythic-vip-8of8-ivo$/);
    expect(
      buildDiscordRunChannelName({
        scheduledStartAt: fri,
        difficulty: "MYTHIC",
        lootType: "COMMUNITY",
        coverage,
        raidLeadChannelName: lead,
      }),
    ).toMatch(/^[a-z]{3}-2015-mythic-com-8of8-ivo$/);
    expect(
      buildDiscordRunChannelName({
        scheduledStartAt: fri,
        difficulty: "HEROIC",
        lootType: "COMMUNITY",
        coverage,
        raidLeadChannelName: lead,
      }),
    ).toMatch(/^[a-z]{3}-2015-hc-com-8of8-ivo$/);
  });

  it("uses the provided coverage token verbatim (content-native)", () => {
    expect(buildDiscordRunChannelName({ ...BASE, coverage: "8of8" })).toContain("-8of8-");
    expect(buildDiscordRunChannelName({ ...BASE, coverage: "1of8" })).toContain("-1of8-");
  });

  it("normalizes the raid lead name: spaces, punctuation, and diacritics", () => {
    expect(
      buildDiscordRunChannelName({ ...BASE, raidLeadChannelName: "Dr. Emile O'Connor Jr." }),
    ).toBe("sat-2200-hc-vip-7of9-dr-emile-o-connor-jr");
    expect(slugDiscordChannelSegment("Gämma")).toBe("gamma");
    expect(buildDiscordRunChannelName({ ...BASE, raidLeadChannelName: "Gämma" })).toBe(
      "sat-2200-hc-vip-7of9-gamma",
    );
  });

  it("collapses duplicate separators and never leaves a leading/trailing hyphen", () => {
    expect(buildDiscordRunChannelName({ ...BASE, raidLeadChannelName: "  --Alpha--  " })).toBe(
      "sat-2200-hc-vip-7of9-alpha",
    );
  });

  it("formats midnight and single-digit minutes with zero-padding", () => {
    expect(
      buildDiscordRunChannelName({
        ...BASE,
        scheduledStartAt: "2026-09-14T22:03:00.000Z",
        difficulty: "NORMAL",
        lootType: "UNSAVED",
      }),
    ).toBe("tue-0003-nm-unsaved-7of9-alpha");
  });

  it("truncates to Discord's 100-character channel name limit without a dangling hyphen", () => {
    const name = buildDiscordRunChannelName({ ...BASE, raidLeadChannelName: "A".repeat(200) });
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith("-")).toBe(false);
  });

  it("temporary Run voice channel: `Raid with <Raid Lead name>`, human-readable, not slugged", () => {
    expect(formatRunVoiceChannelName("Delta")).toBe("Raid with Delta");
    expect(formatRunVoiceChannelName("Gam Ma")).toBe("Raid with Gam Ma");
    expect(formatRunVoiceChannelName("Gamma")).not.toContain("raid-with");
  });

  it("temporary Run voice channel: line breaks and control characters cannot malform the name", () => {
    const hostile = `  Gam${String.fromCharCode(13, 10)}ma${String.fromCharCode(9)}${String.fromCharCode(0)}${String.fromCharCode(0x2028)}Lead  `;
    const name = formatRunVoiceChannelName(hostile);
    expect(name).toBe("Raid with Gam ma Lead");
    expect(Array.from(name).every((char) => char.codePointAt(0)! >= 0x20)).toBe(true);
  });

  it("temporary Run voice channel: stays within Discord's 100-character channel name limit", () => {
    const name = formatRunVoiceChannelName("X".repeat(300));
    expect(name.length).toBeLessThanOrEqual(DISCORD_CHANNEL_NAME_MAX);
    expect(name.startsWith("Raid with X")).toBe(true);
  });

  it("raid-week minute: channel names and schedules share one scale starting Wednesday 06:00 Berlin", () => {
    expect(raidWeekMinuteFromChannelName("wed-0600-first")).toBe(0);
    expect(raidWeekMinuteFromChannelName("fri-1300-nm-vip-9of9-locheia")).toBe(2 * 1440 + 7 * 60);
    expect(raidWeekMinuteFromChannelName("wed-0500-late")).toBe(7 * 1440 - 60);
    expect(raidWeekMinuteFromChannelName("FRI-1300-x")).toBe(raidWeekMinuteFromChannelName("fri-1300-x"));
    for (const invalid of ["general", "raid-notes", "fri-2560-x", "fri-1299-x", "closed-fri-1300-x", "fri1300", "💰-current-id"]) {
      expect(raidWeekMinuteFromChannelName(invalid)).toBeNull();
    }
    // A BoostingHub channel's own name parses to the same minute as its schedule (CET and CEST).
    for (const scheduledStartAt of [SATURDAY_2200_BERLIN, "2026-09-25T20:15:00.000Z", "2026-01-14T05:30:00.000Z"]) {
      const name = buildDiscordRunChannelName({ ...BASE, scheduledStartAt, coverage: "9of9" });
      expect(raidWeekMinuteFromChannelName(name)).toBe(raidWeekMinuteFromSchedule(scheduledStartAt));
    }
  });

  it("slugifies spaces and underscores in nickname", () => {
    expect(slugDiscordChannelSegment("Gamma 91")).toBe("gamma-91");
    expect(slugDiscordChannelSegment("Gamma_91")).toBe("gamma-91");
  });
});

describe("buildClosedDiscordRunChannelName", () => {
  it("prefixes the live slug with closed-", () => {
    expect(buildClosedDiscordRunChannelName(BASE)).toBe("closed-sat-2200-hc-vip-7of9-alpha");
  });

  it("uses mythic/com consistently for Mythic Community", () => {
    const name = buildClosedDiscordRunChannelName({
      ...BASE,
      difficulty: "MYTHIC",
      lootType: "COMMUNITY",
      coverage: "8of8",
      raidLeadChannelName: "IvO",
    });
    expect(name.startsWith("closed-")).toBe(true);
    expect(name).toContain("-mythic-com-");
    expect(name).not.toContain("-my-");
    expect(name).not.toContain("-community-");
    expect(name.length).toBeLessThanOrEqual(100);
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
        raidLeadChannelName: "Gamma",
      }),
    ).toBe("closed-sat-2200-hc-vip-9of9-gamma");
  });
});
