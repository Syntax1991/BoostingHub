import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  raiderIoApiClient,
  raiderIoRealmSlugFromRealm,
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

  it("returns NOT_FOUND when gear.item_level_equipped is missing", async () => {
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
