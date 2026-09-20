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
  it("uses only reported item_level_equipped (not gear.items average)", () => {
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
    ).toBe(272);

    expect(
      resolveRaiderIoEquippedItemLevel({
        item_level_equipped: 312,
        items: { head: { item_level: 300 } },
      }),
    ).toBe(312);
  });

  it("returns null when reported equipped is missing", () => {
    expect(
      resolveRaiderIoEquippedItemLevel({
        items: { head: { item_level: 310 }, chest: { item_level: 312 } },
      }),
    ).toBeNull();
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

  it("keeps reported equipped even when gear.items average would be higher", async () => {
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
