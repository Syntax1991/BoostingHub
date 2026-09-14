import { describe, expect, it } from "vitest";
import { projectedBoosterCardCount, uniqueSignupCount } from "@/lib/roster-candidate-counts";

describe("roster candidate unique counts", () => {
  it("counts 30 single-role + 4 double-role as 34 unique and 38 projected cards", () => {
    const singles = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, roles: ["DPS"] as const }));
    const doubles = [
      { id: "d0", roles: ["TANK", "HEALER"] as const },
      { id: "d1", roles: ["HEALER", "DPS"] as const },
      { id: "d2", roles: ["TANK", "DPS"] as const },
      { id: "d3", roles: ["HEALER", "DPS"] as const },
    ];
    const boosters = [...singles, ...doubles];
    expect(uniqueSignupCount(boosters)).toBe(34);

    const tanks = boosters.filter((b) => b.roles.includes("TANK" as never));
    const healers = boosters.filter((b) => b.roles.includes("HEALER" as never));
    const dps = boosters.filter((b) => b.roles.includes("DPS" as never));
    expect(projectedBoosterCardCount({ tanks, healers, dps })).toBe(38);
    expect(tanks.length + healers.length + dps.length).not.toBe(uniqueSignupCount(boosters));
  });

  it("counts A DPS + B HEALER + C HEALER/DPS as 3 unique with 4 projected cards", () => {
    const boosters = [
      { id: "a", roles: ["DPS"] },
      { id: "b", roles: ["HEALER"] },
      { id: "c", roles: ["HEALER", "DPS"] },
    ];
    expect(uniqueSignupCount(boosters)).toBe(3);
    const healers = boosters.filter((b) => b.roles.includes("HEALER"));
    const dps = boosters.filter((b) => b.roles.includes("DPS"));
    expect(healers).toHaveLength(2);
    expect(dps).toHaveLength(2);
    expect(projectedBoosterCardCount({ tanks: [], healers, dps })).toBe(4);
  });

  it("counts one three-role signup as 1 unique and 3 projected cards", () => {
    const boosters = [{ id: "paladin", roles: ["TANK", "HEALER", "DPS"] }];
    expect(uniqueSignupCount(boosters)).toBe(1);
    expect(
      projectedBoosterCardCount({
        tanks: boosters,
        healers: boosters,
        dps: boosters,
      }),
    ).toBe(3);
  });

  it("keeps filtered unique count at 1 when a hybrid matches in two sections", () => {
    const boosters = [
      { id: "shaman", roles: ["HEALER", "DPS"], name: "Synblast" },
      { id: "mage", roles: ["DPS"], name: "Frostbolt" },
    ];
    const filtered = boosters.filter((b) => b.name.toLowerCase().includes("syn"));
    expect(uniqueSignupCount(filtered)).toBe(1);
    const healers = filtered.filter((b) => b.roles.includes("HEALER"));
    const dps = filtered.filter((b) => b.roles.includes("DPS"));
    expect(healers).toHaveLength(1);
    expect(dps).toHaveLength(1);
    expect(projectedBoosterCardCount({ tanks: [], healers, dps })).toBe(2);
  });
});
