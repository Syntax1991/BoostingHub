import { describe, expect, it } from "vitest";
import {
  emptySocketText,
  gemCheckText,
  playedRoleLabel,
  rosterRoleMismatch,
  runePresenceText,
  weaponEnhancementText,
} from "@/lib/consumable-audit-display";

describe("optional rune display", () => {
  it("shows present / absent / unknown — never a 'missing' failure", () => {
    expect(runePresenceText({ fightsWith: 2, fightsChecked: 2 })).toBe("Present");
    expect(runePresenceText({ fightsWith: 1, fightsChecked: 2 })).toBe("Present 1/2");
    expect(runePresenceText({ fightsWith: 0, fightsChecked: 2 })).toBe("Absent");
    expect(runePresenceText({ fightsWith: 0, fightsChecked: 0 })).toBe("Unknown");
  });
});

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

describe("played role display", () => {
  it("labels the played role; MIXED and UNKNOWN are explicit", () => {
    expect(playedRoleLabel("DPS")).toBe("DPS");
    expect(playedRoleLabel("HEALER")).toBe("Healer");
    expect(playedRoleLabel("MIXED")).toBe("Mixed");
    expect(playedRoleLabel("UNKNOWN")).toBe("Unknown");
  });

  it("names the roster role only when it differs from a single played role (information, not a warning)", () => {
    expect(rosterRoleMismatch({ rosterRole: "HEALER", playedRole: "DPS" })).toBe("HEALER");
    expect(rosterRoleMismatch({ rosterRole: "DPS", playedRole: "DPS" })).toBeNull();
    expect(rosterRoleMismatch({ rosterRole: "HEALER", playedRole: "MIXED" })).toBeNull();
    expect(rosterRoleMismatch({ rosterRole: "HEALER", playedRole: "UNKNOWN" })).toBeNull();
    expect(rosterRoleMismatch({ rosterRole: null, playedRole: "TANK" })).toBeNull();
  });
});
