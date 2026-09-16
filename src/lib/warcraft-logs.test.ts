import { describe, expect, it } from "vitest";
import { getWarcraftLogsCharacterUrl } from "@/lib/warcraft-logs";

describe("getWarcraftLogsCharacterUrl", () => {
  it("builds a deterministic URL for a valid id", () => {
    expect(getWarcraftLogsCharacterUrl("12345678")).toBe(
      "https://www.warcraftlogs.com/character/id/12345678",
    );
  });

  it("returns null for null or undefined", () => {
    expect(getWarcraftLogsCharacterUrl(null)).toBeNull();
    expect(getWarcraftLogsCharacterUrl(undefined)).toBeNull();
  });

  it("returns null for empty or whitespace-only values", () => {
    expect(getWarcraftLogsCharacterUrl("")).toBeNull();
    expect(getWarcraftLogsCharacterUrl("   ")).toBeNull();
  });

  it("URL-encodes the id defensively", () => {
    expect(getWarcraftLogsCharacterUrl("12/34?x=1")).toBe(
      "https://www.warcraftlogs.com/character/id/12%2F34%3Fx%3D1",
    );
  });

  it("trims surrounding whitespace before encoding", () => {
    expect(getWarcraftLogsCharacterUrl("  98765  ")).toBe(
      "https://www.warcraftlogs.com/character/id/98765",
    );
  });
});
