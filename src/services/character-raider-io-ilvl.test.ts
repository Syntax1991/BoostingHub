import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const getCharacterEquippedItemLevel = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/raider-io/raider-io-api-client", () => ({
  raiderIoApiClient: {
    getCharacterEquippedItemLevel,
  },
}));

import {
  resolveRaiderIoItemLevelEnrichment,
  shouldPreferRaiderIoItemLevel,
} from "@/services/character-raider-io-ilvl";

beforeEach(() => {
  getCharacterEquippedItemLevel.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("shouldPreferRaiderIoItemLevel", () => {
  it("prefers RIO when Blizzard omitted ilvl", () => {
    expect(shouldPreferRaiderIoItemLevel(null, 312)).toBe(true);
    expect(shouldPreferRaiderIoItemLevel(undefined, 312)).toBe(true);
  });

  it("prefers RIO only when strictly greater", () => {
    expect(shouldPreferRaiderIoItemLevel(272, 312)).toBe(true);
    expect(shouldPreferRaiderIoItemLevel(312, 312)).toBe(false);
    expect(shouldPreferRaiderIoItemLevel(320, 312)).toBe(false);
  });
});

describe("resolveRaiderIoItemLevelEnrichment", () => {
  it("returns floored RIO ilvl when higher than Blizzard", async () => {
    getCharacterEquippedItemLevel.mockResolvedValue({
      status: "SUCCESS",
      equippedItemLevel: 312.875,
    });

    await expect(
      resolveRaiderIoItemLevelEnrichment({
        name: "Tikaanie",
        realm: "Blackmoore",
        region: "EU",
        blizzardEquippedItemLevel: 272,
      }),
    ).resolves.toBe(312);
  });

  it("returns null when RIO is lower or equal", async () => {
    getCharacterEquippedItemLevel.mockResolvedValue({
      status: "SUCCESS",
      equippedItemLevel: 300,
    });

    await expect(
      resolveRaiderIoItemLevelEnrichment({
        name: "Tikaanie",
        realm: "Blackmoore",
        region: "EU",
        blizzardEquippedItemLevel: 320,
      }),
    ).resolves.toBeNull();
  });

  it("returns null on NOT_FOUND or TEMPORARY_FAILURE", async () => {
    getCharacterEquippedItemLevel.mockResolvedValue({ status: "NOT_FOUND" });
    await expect(
      resolveRaiderIoItemLevelEnrichment({
        name: "Tikaanie",
        realm: "Blackmoore",
        region: "EU",
        blizzardEquippedItemLevel: 272,
      }),
    ).resolves.toBeNull();

    getCharacterEquippedItemLevel.mockResolvedValue({
      status: "TEMPORARY_FAILURE",
      message: "boom",
    });
    await expect(
      resolveRaiderIoItemLevelEnrichment({
        name: "Tikaanie",
        realm: "Blackmoore",
        region: "EU",
        blizzardEquippedItemLevel: 272,
      }),
    ).resolves.toBeNull();
  });
});
