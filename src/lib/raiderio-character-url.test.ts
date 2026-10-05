import { describe, expect, it } from "vitest";
import { parseRaiderIoCharacterUrl } from "@/lib/raiderio-character-url";

describe("parseRaiderIoCharacterUrl", () => {
  it("parses an EU Antonidas Character profile URL", () => {
    const result = parseRaiderIoCharacterUrl("https://raider.io/characters/eu/antonidas/Synblast");
    expect(result).toEqual({
      ok: true,
      value: { region: "EU", realmSlug: "antonidas", characterName: "Synblast" },
    });
  });

  it("parses a www US Mal'Ganis slug URL", () => {
    const result = parseRaiderIoCharacterUrl("https://www.raider.io/characters/us/malganis/Foo");
    expect(result).toEqual({
      ok: true,
      value: { region: "US", realmSlug: "malganis", characterName: "Foo" },
    });
  });

  it("accepts a trailing slash", () => {
    const result = parseRaiderIoCharacterUrl("https://raider.io/characters/eu/twisting-nether/Foo/");
    expect(result).toEqual({
      ok: true,
      value: { region: "EU", realmSlug: "twisting-nether", characterName: "Foo" },
    });
  });

  it("ignores query and hash", () => {
    const result = parseRaiderIoCharacterUrl(
      "https://raider.io/characters/eu/antonidas/Synblast?utm=1#gear",
    );
    expect(result).toEqual({
      ok: true,
      value: { region: "EU", realmSlug: "antonidas", characterName: "Synblast" },
    });
  });

  it("decodes a percent-encoded character name", () => {
    const result = parseRaiderIoCharacterUrl("https://raider.io/characters/eu/antonidas/%C3%89owyn");
    expect(result).toEqual({
      ok: true,
      value: { region: "EU", realmSlug: "antonidas", characterName: "Éowyn" },
    });
  });

  it("rejects an unsupported region", () => {
    const result = parseRaiderIoCharacterUrl("https://raider.io/characters/kr/azshara/Foo");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNSUPPORTED_REGION");
      expect(result.error.message).toContain("not supported");
    }
  });

  it("rejects evil.example", () => {
    const result = parseRaiderIoCharacterUrl("https://evil.example/characters/eu/antonidas/Synblast");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WRONG_HOST");
  });

  it("rejects raider.io.evil.example", () => {
    const result = parseRaiderIoCharacterUrl(
      "https://raider.io.evil.example/characters/eu/antonidas/Synblast",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WRONG_HOST");
  });

  it("rejects classic.raider.io", () => {
    const result = parseRaiderIoCharacterUrl(
      "https://classic.raider.io/characters/eu/antonidas/Synblast",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WRONG_HOST");
  });

  it("rejects guild URLs", () => {
    const result = parseRaiderIoCharacterUrl("https://raider.io/guilds/eu/antonidas/Some%20Guild");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WRONG_PATH");
  });

  it("rejects a missing character segment", () => {
    const result = parseRaiderIoCharacterUrl("https://raider.io/characters/eu/antonidas");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WRONG_PATH");
  });

  it("rejects malformed percent encoding", () => {
    const result = parseRaiderIoCharacterUrl("https://raider.io/characters/eu/antonidas/%E0%A4%A");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MALFORMED_ENCODING");
  });

  it("rejects blank input and non-URLs", () => {
    expect(parseRaiderIoCharacterUrl("").ok).toBe(false);
    expect(parseRaiderIoCharacterUrl("not a url").ok).toBe(false);
    expect(parseRaiderIoCharacterUrl("ftp://raider.io/characters/eu/antonidas/Synblast").ok).toBe(false);
  });
});
