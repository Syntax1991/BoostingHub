import { describe, expect, it } from "vitest";
import { buildDiscordRunChannelName } from "@/lib/discord-channel-name";

// 2026-09-12 20:00 UTC = Saturday 22:00 Europe/Berlin (CEST, UTC+2) during DST.
const SATURDAY_2200_BERLIN = "2026-09-12T20:00:00.000Z";

describe("buildDiscordRunChannelName", () => {
  it("builds the reduced weekday-HHMM-difficulty-raidLead form when runType/progress are absent", () => {
    expect(
      buildDiscordRunChannelName({
        scheduledStartAt: SATURDAY_2200_BERLIN,
        difficulty: "HEROIC",
        raidLeadName: "Titan",
      }),
    ).toBe("sat-2200-hc-titan");
  });

  it("includes runType and progress when supplied, in the reference order", () => {
    expect(
      buildDiscordRunChannelName({
        scheduledStartAt: SATURDAY_2200_BERLIN,
        difficulty: "HEROIC",
        raidLeadName: "Titan",
        runType: "VIP",
        progress: "7of9",
      }),
    ).toBe("sat-2200-hc-vip-7of9-titan");
  });

  it("abbreviates all three difficulties consistently", () => {
    const base = { scheduledStartAt: SATURDAY_2200_BERLIN, raidLeadName: "Titan" };
    expect(buildDiscordRunChannelName({ ...base, difficulty: "NORMAL" })).toContain("-nm-");
    expect(buildDiscordRunChannelName({ ...base, difficulty: "HEROIC" })).toContain("-hc-");
    expect(buildDiscordRunChannelName({ ...base, difficulty: "MYTHIC" })).toContain("-my-");
  });

  it("normalizes the raid lead name: spaces, punctuation, and diacritics", () => {
    expect(
      buildDiscordRunChannelName({
        scheduledStartAt: SATURDAY_2200_BERLIN,
        difficulty: "HEROIC",
        raidLeadName: "Dr. Émile O'Connor Jr.",
      }),
    ).toBe("sat-2200-hc-dr-emile-o-connor-jr");
  });

  it("collapses duplicate separators and never leaves a leading/trailing hyphen", () => {
    expect(
      buildDiscordRunChannelName({
        scheduledStartAt: SATURDAY_2200_BERLIN,
        difficulty: "HEROIC",
        raidLeadName: "  --Titan--  ",
      }),
    ).toBe("sat-2200-hc-titan");
  });

  it("is deterministic for the same input", () => {
    const input = { scheduledStartAt: SATURDAY_2200_BERLIN, difficulty: "MYTHIC" as const, raidLeadName: "Titan" };
    expect(buildDiscordRunChannelName(input)).toBe(buildDiscordRunChannelName(input));
  });

  it("formats midnight and single-digit minutes with zero-padding", () => {
    // 2026-09-14 22:03 UTC = Tuesday 00:03 Europe/Berlin (CEST, next calendar day).
    expect(
      buildDiscordRunChannelName({
        scheduledStartAt: "2026-09-14T22:03:00.000Z",
        difficulty: "NORMAL",
        raidLeadName: "Titan",
      }),
    ).toBe("tue-0003-nm-titan");
  });

  it("truncates to Discord's 100-character channel name limit without a dangling hyphen", () => {
    const name = buildDiscordRunChannelName({
      scheduledStartAt: SATURDAY_2200_BERLIN,
      difficulty: "HEROIC",
      raidLeadName: "A".repeat(200),
      runType: "VIP",
      progress: "7of9",
    });
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith("-")).toBe(false);
  });

  it("omits an empty runType/progress rather than leaving a blank segment", () => {
    expect(
      buildDiscordRunChannelName({
        scheduledStartAt: SATURDAY_2200_BERLIN,
        difficulty: "HEROIC",
        raidLeadName: "Titan",
        runType: "   ",
        progress: "",
      }),
    ).toBe("sat-2200-hc-titan");
  });
});
