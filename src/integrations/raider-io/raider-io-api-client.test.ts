import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  raiderIoApiClient,
  raiderIoRealmSlugFromRealm,
  resolveRaiderIoEquippedItemLevel,
} from "@/integrations/raider-io/raider-io-api-client";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.stubEnv("RAIDER_IO_ACCESS_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("raiderIoRealmSlugFromRealm", () => {
  it("reuses Blizzard-compatible realm slug rules", () => {
    expect(raiderIoRealmSlugFromRealm("Twisting Nether")).toBe("twisting-nether");
    expect(raiderIoRealmSlugFromRealm("Blackmoore")).toBe("blackmoore");
  });
});

describe("resolveRaiderIoEquippedItemLevel", () => {
  it("averages present slots with 2H mainhand and no empty-offhand penalty", () => {
    // (308+308+308+331)/4 floored
    expect(
      resolveRaiderIoEquippedItemLevel({
        item_level_equipped: 272,
        items: {
          head: { item_level: 308 },
          chest: { item_level: 308 },
          legs: { item_level: 308 },
          mainhand: { item_level: 331 },
        },
      }),
    ).toBe(313);
  });

  it("counts missing mainhand+offhand as 0 so unequipped weapons match Blizzard", () => {
    const armor = {
      head: { item_level: 308 },
      neck: { item_level: 298 },
      shoulder: { item_level: 321 },
      back: { item_level: 321 },
      chest: { item_level: 308 },
      waist: { item_level: 324 },
      wrist: { item_level: 331 },
      hands: { item_level: 308 },
      legs: { item_level: 308 },
      feet: { item_level: 308 },
      finger1: { item_level: 298 },
      finger2: { item_level: 318 },
      trinket1: { item_level: 318 },
      trinket2: { item_level: 298 },
    };
    // 4367 armor + 0 + 0 over 16 slots → floor 272
    expect(
      resolveRaiderIoEquippedItemLevel({
        item_level_equipped: 272,
        items: armor,
      }),
    ).toBe(272);
  });

  it("keeps a higher reported equipped when item average is lower", () => {
    expect(
      resolveRaiderIoEquippedItemLevel({
        item_level_equipped: 320,
        items: { head: { item_level: 300 }, chest: { item_level: 300 } },
      }),
    ).toBe(320);
  });

  it("uses item average when reported equipped is missing", () => {
    // both weapons missing → (310+312+0+0)/4
    expect(
      resolveRaiderIoEquippedItemLevel({
        items: { head: { item_level: 310 }, chest: { item_level: 312 } },
      }),
    ).toBe(155);
  });
});

describe("raiderIoApiClient.getCharacterEquippedItemLevel", () => {
  it("returns SUCCESS with equipped item level from gear", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        name: "Tikaanie",
        gear: { item_level_equipped: 312, item_level_total: 0 },
      }),
    );

    const result = await raiderIoApiClient.getCharacterEquippedItemLevel({
      name: "Tikaanie",
      realm: "Blackmoore",
      region: "EU",
    });

    expect(result).toEqual({ status: "SUCCESS", equippedItemLevel: 312 });
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("region=eu");
    expect(calledUrl).toContain("realm=blackmoore");
    expect(calledUrl).toContain("name=Tikaanie");
    expect(calledUrl).toContain("fields=gear");
    expect(calledUrl).not.toContain("access_key=");
  });

  it("does not inflate ilvl when weapons are unequipped", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        name: "Tikaanie",
        gear: {
          item_level_equipped: 272,
          items: {
            head: { item_level: 308 },
            neck: { item_level: 298 },
            shoulder: { item_level: 321 },
            back: { item_level: 321 },
            chest: { item_level: 308 },
            waist: { item_level: 324 },
            wrist: { item_level: 331 },
            hands: { item_level: 308 },
            legs: { item_level: 308 },
            feet: { item_level: 308 },
            finger1: { item_level: 298 },
            finger2: { item_level: 318 },
            trinket1: { item_level: 318 },
            trinket2: { item_level: 298 },
          },
        },
      }),
    );

    const result = await raiderIoApiClient.getCharacterEquippedItemLevel({
      name: "Tikaanie",
      realm: "Blackmoore",
      region: "EU",
    });

    expect(result).toEqual({ status: "SUCCESS", equippedItemLevel: 272 });
  });

  it("raises stale equipped ilvl when a 2H weapon is present in gear.items", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        name: "Tikaanie",
        gear: {
          item_level_equipped: 272,
          items: {
            head: { item_level: 308 },
            neck: { item_level: 298 },
            shoulder: { item_level: 321 },
            back: { item_level: 321 },
            chest: { item_level: 308 },
            waist: { item_level: 324 },
            wrist: { item_level: 331 },
            hands: { item_level: 308 },
            legs: { item_level: 308 },
            feet: { item_level: 308 },
            finger1: { item_level: 298 },
            finger2: { item_level: 318 },
            trinket1: { item_level: 318 },
            trinket2: { item_level: 298 },
            mainhand: { item_level: 331 },
          },
        },
      }),
    );

    const result = await raiderIoApiClient.getCharacterEquippedItemLevel({
      name: "Tikaanie",
      realm: "Blackmoore",
      region: "EU",
    });

    // (4367 + 331) / 15 floored
    expect(result).toEqual({ status: "SUCCESS", equippedItemLevel: 313 });
  });

  it("appends access_key when RAIDER_IO_ACCESS_KEY is set", async () => {
    vi.stubEnv("RAIDER_IO_ACCESS_KEY", "test-rio-key");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        name: "Tikaanie",
        gear: { item_level_equipped: 312 },
      }),
    );

    await raiderIoApiClient.getCharacterEquippedItemLevel({
      name: "Tikaanie",
      realm: "Blackmoore",
      region: "EU",
    });

    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("access_key=test-rio-key");
  });

  it("returns NOT_FOUND on HTTP 404", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ statusCode: 404, error: "Not Found" }, 404));

    const result = await raiderIoApiClient.getCharacterEquippedItemLevel({
      name: "Missing",
      realm: "Blackmoore",
      region: "EU",
    });

    expect(result).toEqual({ status: "NOT_FOUND" });
  });

  it("returns NOT_FOUND when gear has no usable item levels", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ name: "Tikaanie", gear: {} }));

    const result = await raiderIoApiClient.getCharacterEquippedItemLevel({
      name: "Tikaanie",
      realm: "Blackmoore",
      region: "EU",
    });

    expect(result).toEqual({ status: "NOT_FOUND" });
  });

  it("returns TEMPORARY_FAILURE on non-404 HTTP errors", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429));

    const result = await raiderIoApiClient.getCharacterEquippedItemLevel({
      name: "Tikaanie",
      realm: "Blackmoore",
      region: "EU",
    });

    expect(result.status).toBe("TEMPORARY_FAILURE");
  });

  it("returns TEMPORARY_FAILURE when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const result = await raiderIoApiClient.getCharacterEquippedItemLevel({
      name: "Tikaanie",
      realm: "Blackmoore",
      region: "EU",
    });

    expect(result).toEqual({
      status: "TEMPORARY_FAILURE",
      message: "network down",
    });
  });
});
