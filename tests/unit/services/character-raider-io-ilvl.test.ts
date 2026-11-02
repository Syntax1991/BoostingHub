import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const getCharacterEquippedItemLevel = vi.hoisted(() => vi.fn());
const recordRaiderIoApiOutcome = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/raider-io/raider-io-api-client", () => ({
  raiderIoApiClient: {
    getCharacterEquippedItemLevel,
  },
}));

vi.mock("@/lib/integration-provider-events", () => ({
  recordRaiderIoApiOutcome,
}));

import {
  resolveRaiderIoItemLevelEnrichment,
  shouldPreferRaiderIoItemLevel,
} from "@/services/character-raider-io-ilvl";

beforeEach(() => {
  getCharacterEquippedItemLevel.mockReset();
  recordRaiderIoApiOutcome.mockReset();
  recordRaiderIoApiOutcome.mockResolvedValue(undefined);
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
    expect(recordRaiderIoApiOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCESS", region: "EU" }),
    );
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
    // API succeeded — record SUCCESS for health recovery even when ilvl is not preferred.
    expect(recordRaiderIoApiOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCESS", region: "EU" }),
    );
  });

  it("returns null on NOT_FOUND without API telemetry flood", async () => {
    getCharacterEquippedItemLevel.mockResolvedValue({ status: "NOT_FOUND" });
    await expect(
      resolveRaiderIoItemLevelEnrichment({
        name: "Tikaanie",
        realm: "Blackmoore",
        region: "EU",
        blizzardEquippedItemLevel: 272,
      }),
    ).resolves.toBeNull();
    expect(recordRaiderIoApiOutcome).not.toHaveBeenCalled();
  });

  it("soft-fails TEMPORARY_FAILURE with telemetry and never throws", async () => {
    getCharacterEquippedItemLevel.mockResolvedValue({
      status: "TEMPORARY_FAILURE",
      message: "Raider.IO HTTP 503",
    });
    await expect(
      resolveRaiderIoItemLevelEnrichment({
        name: "Tikaanie",
        realm: "Blackmoore",
        region: "EU",
        blizzardEquippedItemLevel: 272,
      }),
    ).resolves.toBeNull();
    expect(recordRaiderIoApiOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "TEMPORARY_FAILURE",
        region: "EU",
        reason: "Raider.IO HTTP 503",
      }),
    );
  });
});
