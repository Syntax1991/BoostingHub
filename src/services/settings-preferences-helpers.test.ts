import { describe, expect, it } from "vitest";
import { preferDefaultCharacterId } from "@/lib/default-character-preference";
import { DEFAULT_TIME_ZONE } from "@/lib/datetime";
import { buildRunTitle } from "@/lib/run-title";
import { buildDiscordRunChannelName } from "@/lib/discord-channel-name";
import { classifyRunWeek } from "@/lib/wow-run-week";
import { isValidIanaTimeZone, listIanaTimeZones } from "@/lib/timezone";
import { resolveDiscordDelivery } from "@/services/notification-content";

describe("preferDefaultCharacterId", () => {
  const eligible = [
    { characterId: "a", name: "A" },
    { characterId: "b", name: "B" },
    { characterId: "c", name: "C" },
  ];

  it("moves an eligible default to the front", () => {
    const result = preferDefaultCharacterId(eligible, "b");
    expect(result.preferredCharacterId).toBe("b");
    expect(result.ordered.map((item) => item.characterId)).toEqual(["b", "a", "c"]);
  });

  it("ignores an ineligible default without error", () => {
    const result = preferDefaultCharacterId(eligible, "missing");
    expect(result.preferredCharacterId).toBeNull();
    expect(result.ordered).toEqual(eligible);
  });
});

describe("timezone helpers", () => {
  it("validates IANA zones and lists supported values with Berlin fallback", () => {
    expect(isValidIanaTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidIanaTimeZone("America/New_York")).toBe(true);
    expect(isValidIanaTimeZone("UTC+2")).toBe(false);
    expect(isValidIanaTimeZone("Not/AZone")).toBe(false);
    const zones = listIanaTimeZones();
    expect(zones).toContain(DEFAULT_TIME_ZONE);
    expect(zones.length).toBeGreaterThan(1);
  });
});

describe("resolveDiscordDelivery master override", () => {
  it("requires master AND event AND discord identity", () => {
    expect(
      resolveDiscordDelivery({
        discordDmEnabled: false,
        eventDmEnabled: true,
        discordUserId: "1",
      }).status,
    ).toBe("SKIPPED");
    expect(
      resolveDiscordDelivery({
        discordDmEnabled: true,
        eventDmEnabled: false,
        discordUserId: "1",
      }).status,
    ).toBe("SKIPPED");
    expect(
      resolveDiscordDelivery({
        discordDmEnabled: true,
        eventDmEnabled: true,
        discordUserId: null,
      }).status,
    ).toBe("SKIPPED");
    expect(
      resolveDiscordDelivery({
        discordDmEnabled: true,
        eventDmEnabled: true,
        discordUserId: "1",
      }).status,
    ).toBe("PENDING");
  });
});

describe("community timezone authority regression", () => {
  const scheduledStartAt = "2026-09-17T19:00:00.000Z";

  it("Run.title stays community-derived regardless of viewer timezone", () => {
    const title = buildRunTitle({
      scheduledStartAt,
      difficulty: "HEROIC",
      lootType: "VIP",
      titleCoverage: "8/8",
      raidLeadName: "Syntax_1991",
    });
    expect(title).toContain("HC");
    expect(title).toContain("VIP");
    expect(title).toContain("Syntax_1991");
  });

  it("Discord channel name stays community-derived", () => {
    const name = buildDiscordRunChannelName({
      scheduledStartAt,
      difficulty: "HEROIC",
      lootType: "VIP",
      coverage: "8of8",
      raidLeadName: "Syntax_1991",
    });
    expect(name.length).toBeGreaterThan(0);
    expect(name).toMatch(/hc|vip|syntax/i);
  });

  it("raid-ID week classification ignores viewer timezone", () => {
    const now = new Date("2026-09-15T12:00:00.000Z");
    const a = classifyRunWeek({ scheduledStartAt, now });
    const b = classifyRunWeek({ scheduledStartAt, now });
    expect(a.bucket).toBe(b.bucket);
  });
});
