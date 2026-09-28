import { describe, expect, it } from "vitest";
import { emptySocketText, gemCheckText, weaponEnhancementText } from "@/lib/consumable-audit-display";

describe("gem column shows the actual items' totals", () => {
  const gems = (overrides: Partial<Parameters<typeof gemCheckText>[0]>) =>
    gemCheckText({ status: "PASS", filled: 0, sockets: 0, empty: [], unknown: [], ...overrides });

  it("renders filled / real socket total, 0 sockets, and ? for an unavailable count", () => {
    expect(gems({ filled: 2, sockets: 2 })).toBe("2/2");
    expect(gems({ status: "WARNING", filled: 1, sockets: 2, empty: [{}] })).toBe("1/2");
    expect(gems({ status: "NA" })).toBe("0 sockets");
    expect(gems({ status: "UNKNOWN", unknown: [{}] })).toBe("?");
    expect(gems({ status: "UNKNOWN", filled: 2, sockets: 2, unknown: [{}] })).toBe("2/2 + ?");
  });

  it("names an item with several empty sockets with its count", () => {
    expect(emptySocketText({ slotLabel: "Neck", emptySockets: 1, sockets: 1 })).toBe("Neck");
    expect(emptySocketText({ slotLabel: "Neck", emptySockets: 2, sockets: 2 })).toBe("Neck — 2 of 2 sockets empty");
  });
});

describe("weapon column", () => {
  it("tells a Death Knight about the Runeforge, never about an oil", () => {
    expect(weaponEnhancementText({ status: "WARNING", expected: "RUNEFORGE", labels: [] })).toBe("Missing Runeforge");
    expect(weaponEnhancementText({ status: "WARNING", expected: "RUNEFORGE", labels: ["Runeforge"] })).toBe(
      "Missing Runeforge · Runeforge",
    );
    expect(weaponEnhancementText({ status: "PASS", expected: "RUNEFORGE", labels: ["Runeforge"] })).toBe("Runeforge");
  });

  it("shows what satisfied everyone else", () => {
    expect(weaponEnhancementText({ status: "PASS", expected: "TEMPORARY", labels: ["Shaman imbue"] })).toBe("Shaman imbue");
    expect(weaponEnhancementText({ status: "WARNING", expected: "TEMPORARY", labels: [] })).toBe("Missing");
    expect(weaponEnhancementText({ status: "UNKNOWN", expected: "TEMPORARY", labels: [] })).toBe("Unknown");
  });
});
