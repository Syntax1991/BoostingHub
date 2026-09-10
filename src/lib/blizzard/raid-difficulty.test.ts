import { describe, expect, it } from "vitest";
import { mapBlizzardRaidDifficulty } from "@/lib/blizzard/raid-difficulty";

describe("mapBlizzardRaidDifficulty", () => {
  it("maps Normal / Heroic / Mythic independently", () => {
    expect(mapBlizzardRaidDifficulty("NORMAL")).toBe("NORMAL");
    expect(mapBlizzardRaidDifficulty("HEROIC")).toBe("HEROIC");
    expect(mapBlizzardRaidDifficulty("MYTHIC")).toBe("MYTHIC");
  });

  it("ignores LFR and Story modes", () => {
    expect(mapBlizzardRaidDifficulty("LFR")).toBeNull();
    expect(mapBlizzardRaidDifficulty("RAID_FINDER")).toBeNull();
    expect(mapBlizzardRaidDifficulty("STORY")).toBeNull();
  });
});
