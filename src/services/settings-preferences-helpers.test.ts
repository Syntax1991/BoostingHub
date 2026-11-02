import { describe, expect, it } from "vitest";
import { preferDefaultCharacterId } from "@/lib/default-character-preference";
import { DEFAULT_TIME_ZONE } from "@/lib/datetime";
import { isValidIanaTimeZone, listIanaTimeZones } from "@/lib/timezone";
import { resolveDiscordDelivery } from "@/domain/notification-content";

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
      }),
    ).toEqual({ status: "PENDING", discordUserId: "1", discordDeliverAfter: null });
  });
});
