import { describe, expect, it } from "vitest";
import { realmKey, resolveDiscordDisplayName, stripKnownRealmSuffix } from "@/lib/discord-display-name";

const realms = new Set(["Antonidas", "Twisting Nether", "Mal'Ganis", "Aman'Thul"].map(realmKey));

describe("stripKnownRealmSuffix — only a known realm is dropped, never a blanket split", () => {
  it("drops a known realm suffix in any spelling (case, spaces, hyphens, apostrophes)", () => {
    expect(stripKnownRealmSuffix("Syntax-Antonidas", realms)).toBe("Syntax");
    expect(stripKnownRealmSuffix("Syntax-antonidas", realms)).toBe("Syntax");
    expect(stripKnownRealmSuffix("Kiri-TwistingNether", realms)).toBe("Kiri");
    expect(stripKnownRealmSuffix("Kiri-Twisting Nether", realms)).toBe("Kiri");
    expect(stripKnownRealmSuffix("Kiri-Twisting-Nether", realms)).toBe("Kiri");
    expect(stripKnownRealmSuffix("Nyx-MalGanis", realms)).toBe("Nyx");
    expect(stripKnownRealmSuffix("Nyx-Mal'Ganis", realms)).toBe("Nyx");
  });

  it("keeps hyphenated names: an unknown suffix stays, a known realm after them is still dropped", () => {
    expect(stripKnownRealmSuffix("Jean-Luc", realms)).toBe("Jean-Luc");
    expect(stripKnownRealmSuffix("Anna-Maria-Antonidas", realms)).toBe("Anna-Maria");
    expect(stripKnownRealmSuffix("Syntax-Blackhand", realms)).toBe("Syntax-Blackhand"); // not a known realm here
    expect(stripKnownRealmSuffix("Syn-Tax", realms)).toBe("Syn-Tax");
  });

  it("never strips to nothing and ignores names without a hyphen", () => {
    expect(stripKnownRealmSuffix("-Antonidas", realms)).toBe("-Antonidas");
    expect(stripKnownRealmSuffix("Antonidas", realms)).toBe("Antonidas");
    expect(stripKnownRealmSuffix("Syntax-", realms)).toBe("Syntax-");
    expect(stripKnownRealmSuffix("  Syntax-Antonidas  ", realms)).toBe("Syntax");
    expect(stripKnownRealmSuffix("Syntax-Antonidas", new Set())).toBe("Syntax-Antonidas");
  });
});

describe("resolveDiscordDisplayName — server nickname → global name → username", () => {
  it("prefers the server nickname, realm suffix dropped", () => {
    expect(resolveDiscordDisplayName({ guildNickname: "Syntax-Antonidas", globalName: "Simon", username: "syntax1991" }, realms)).toBe(
      "Syntax",
    );
  });

  it("falls back to the global display name, then the username (blank values skipped)", () => {
    expect(resolveDiscordDisplayName({ guildNickname: null, globalName: "Simon", username: "syntax1991" }, realms)).toBe("Simon");
    expect(resolveDiscordDisplayName({ guildNickname: "  ", globalName: null, username: "syntax1991" }, realms)).toBe("syntax1991");
    expect(resolveDiscordDisplayName({ guildNickname: null, globalName: "Kiri-Antonidas", username: "kiri" }, realms)).toBe("Kiri");
  });

  it("null when Discord gave no name at all", () => {
    expect(resolveDiscordDisplayName({ guildNickname: null, globalName: null, username: null }, realms)).toBeNull();
  });
});
