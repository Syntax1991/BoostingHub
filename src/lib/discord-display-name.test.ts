import { describe, expect, it } from "vitest";
import { realmKey, resolveDiscordDisplayName, stripKnownRealmSuffix } from "@/lib/discord-display-name";

const realms = new Set(["Antonidas", "Twisting Nether", "Mal'Ganis", "Aman'Thul"].map(realmKey));

describe("stripKnownRealmSuffix — only a known realm is dropped, never a blanket split", () => {
  it("drops a known realm suffix in any spelling (case, spaces, hyphens, apostrophes)", () => {
    expect(stripKnownRealmSuffix("Gamma-Antonidas", realms)).toBe("Gamma");
    expect(stripKnownRealmSuffix("Gamma-antonidas", realms)).toBe("Gamma");
    expect(stripKnownRealmSuffix("Delta-TwistingNether", realms)).toBe("Delta");
    expect(stripKnownRealmSuffix("Delta-Twisting Nether", realms)).toBe("Delta");
    expect(stripKnownRealmSuffix("Delta-Twisting-Nether", realms)).toBe("Delta");
    expect(stripKnownRealmSuffix("Nyx-MalGanis", realms)).toBe("Nyx");
    expect(stripKnownRealmSuffix("Nyx-Mal'Ganis", realms)).toBe("Nyx");
  });

  it("keeps hyphenated names: an unknown suffix stays, a known realm after them is still dropped", () => {
    expect(stripKnownRealmSuffix("Jean-Luc", realms)).toBe("Jean-Luc");
    expect(stripKnownRealmSuffix("Anna-Maria-Antonidas", realms)).toBe("Anna-Maria");
    expect(stripKnownRealmSuffix("Gamma-Blackhand", realms)).toBe("Gamma-Blackhand"); // not a known realm here
    expect(stripKnownRealmSuffix("Gam-Ma", realms)).toBe("Gam-Ma");
  });

  it("never strips to nothing and ignores names without a hyphen", () => {
    expect(stripKnownRealmSuffix("-Antonidas", realms)).toBe("-Antonidas");
    expect(stripKnownRealmSuffix("Antonidas", realms)).toBe("Antonidas");
    expect(stripKnownRealmSuffix("Gamma-", realms)).toBe("Gamma-");
    expect(stripKnownRealmSuffix("  Gamma-Antonidas  ", realms)).toBe("Gamma");
    expect(stripKnownRealmSuffix("Gamma-Antonidas", new Set())).toBe("Gamma-Antonidas");
  });
});

describe("resolveDiscordDisplayName — server nickname → global name → username", () => {
  it("prefers the server nickname, realm suffix dropped", () => {
    expect(resolveDiscordDisplayName({ guildNickname: "Gamma-Antonidas", globalName: "Epsilon", username: "gamma1991" }, realms)).toBe(
      "Gamma",
    );
  });

  it("falls back to the global display name, then the username (blank values skipped)", () => {
    expect(resolveDiscordDisplayName({ guildNickname: null, globalName: "Epsilon", username: "gamma1991" }, realms)).toBe("Epsilon");
    expect(resolveDiscordDisplayName({ guildNickname: "  ", globalName: null, username: "gamma1991" }, realms)).toBe("gamma1991");
    expect(resolveDiscordDisplayName({ guildNickname: null, globalName: "Delta-Antonidas", username: "delta" }, realms)).toBe("Delta");
  });

  it("null when Discord gave no name at all", () => {
    expect(resolveDiscordDisplayName({ guildNickname: null, globalName: null, username: null }, realms)).toBeNull();
  });
});
