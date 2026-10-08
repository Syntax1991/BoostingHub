import { describe, expect, it } from "vitest";
import {
  createProductSchema,
  createRaidSchema,
  encounterFieldsSchema,
  encounterIdList,
} from "@/validators/content-catalog";
import { summarizeProductContent } from "@/services/content-catalog.service";

describe("encounter id lists", () => {
  const blizzard = encounterIdList("Blizzard encounter");

  it("parses structured text into sorted positive integers; empty is allowed", () => {
    expect(blizzard.parse("3379, 2849")).toEqual([2849, 3379]);
    expect(blizzard.parse("2849\n3379")).toEqual([2849, 3379]);
    expect(blizzard.parse("")).toEqual([]);
    expect(blizzard.parse([12, 4])).toEqual([4, 12]);
  });

  it("rejects duplicates, non-numbers, zero and negatives", () => {
    for (const bad of ["2849, 2849", "abc", "0", "-5", "12.5", [1, 1]]) {
      expect(blizzard.safeParse(bad).success).toBe(false);
    }
  });

  it("keeps Blizzard and Warcraft Logs ids as separate fields", () => {
    expect(encounterFieldsSchema.parse({ name: "N", blizzardEncounterIds: "2849", wclEncounterIds: "3379" })).toEqual({
      name: "N",
      blizzardEncounterIds: [2849],
      wclEncounterIds: [3379],
    });
  });
});

describe("raid metadata", () => {
  it("accepts optional positive integration ids and rejects invalid ones", () => {
    const base = { name: "Raid", season: "S", sortOrder: "3", trackLockouts: false };
    expect(createRaidSchema.parse({ ...base, blizzardInstanceId: "", wclZoneId: "53", wclRankingEncounterId: null })).toMatchObject({
      sortOrder: 3,
      blizzardInstanceId: null,
      wclZoneId: 53,
      wclRankingEncounterId: null,
    });
    for (const bad of ["0", "-1", "abc", "1.5"]) {
      expect(createRaidSchema.safeParse({ ...base, blizzardInstanceId: bad, wclZoneId: null, wclRankingEncounterId: null }).success).toBe(false);
    }
    expect(createRaidSchema.safeParse({ ...base, name: " ", blizzardInstanceId: null, wclZoneId: null, wclRankingEncounterId: null }).success).toBe(false);
  });
});

describe("product input", () => {
  const content = { raidId: "r", bossCountMode: "FIXED", fixedBossCount: "1", minBossCount: "", defaultBossCount: "" };

  it("requires an UPPER_SNAKE_CASE key and at least one content", () => {
    const base = { name: "P", active: true, selectable: true, sortOrder: 1, contents: [content] };
    expect(createProductSchema.parse({ ...base, key: "QA_PRODUCT" }).contents[0]).toMatchObject({ fixedBossCount: 1, minBossCount: null });
    for (const key of ["qa_product", "1ABC", "A", "WITH SPACE", "DASH-KEY"]) {
      expect(createProductSchema.safeParse({ ...base, key }).success).toBe(false);
    }
    expect(createProductSchema.safeParse({ ...base, key: "QA_PRODUCT", contents: [] }).success).toBe(false);
  });

  it("summarizes contents with the raid encounter count as maximum", () => {
    expect(summarizeProductContent({ bossCountMode: "FIXED", fixedBossCount: 1, minBossCount: null, defaultBossCount: null }, 1)).toBe("Fixed 1/1");
    expect(summarizeProductContent({ bossCountMode: "VARIABLE", fixedBossCount: null, minBossCount: 1, defaultBossCount: 8 }, 8)).toBe(
      "Variable 1–8 (default 8)",
    );
  });
});
