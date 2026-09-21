import { describe, expect, it } from "vitest";
import {
  evaluateRaidBuffCoverage,
  resolveBuffContributorClass,
  type RaidBuffParticipant,
} from "@/services/roster-raid-buffs";

/**
 * Mirrors the roster projection rule: draft-selected WITHDRAWN rows must not
 * contribute to Class Buff coverage (same filter as getRosterManagementView).
 */
function participantsForBuffCoverage(
  rows: Array<RaidBuffParticipant & { draftSelected: boolean; status: string }>,
): RaidBuffParticipant[] {
  return rows
    .filter((row) => row.draftSelected && row.status !== "WITHDRAWN")
    .map((row) => ({
      signupId: row.signupId,
      userName: row.userName,
      participationType: row.participationType,
      lootbuddyMode: row.lootbuddyMode,
      wowClass: row.wowClass,
      characterName: row.characterName,
    }));
}

describe("class buff coverage after signup removal", () => {
  it("drops WITHDRAWN draft-selected providers from coverage", () => {
    const mage: RaidBuffParticipant & { draftSelected: boolean; status: string } = {
      signupId: "mage-1",
      userName: "Mage User",
      participationType: "BOOSTER",
      lootbuddyMode: null,
      wowClass: "MAGE",
      characterName: "Arcane",
      draftSelected: true,
      status: "WITHDRAWN",
    };
    const shaman: RaidBuffParticipant & { draftSelected: boolean; status: string } = {
      signupId: "sham-1",
      userName: "Shaman User",
      participationType: "BOOSTER",
      lootbuddyMode: null,
      wowClass: "SHAMAN",
      characterName: "Storm",
      draftSelected: true,
      status: "PENDING",
    };

    const withWithdrawn = evaluateRaidBuffCoverage([mage, shaman]);
    expect(withWithdrawn.buffs.find((b) => b.id === "ARCANE_INTELLECT")?.covered).toBe(true);

    const filtered = evaluateRaidBuffCoverage(participantsForBuffCoverage([mage, shaman]));
    expect(filtered.buffs.find((b) => b.id === "ARCANE_INTELLECT")?.covered).toBe(false);
    expect(filtered.buffs.find((b) => b.id === "SKYFURY")?.covered).toBe(true);
  });

  it("live staged deselect removes class coverage immediately", () => {
    const selectedIds = new Set(["mage-1", "sham-1"]);
    const rows = [
      {
        id: "mage-1",
        participationType: "BOOSTER" as const,
        lootbuddyMode: null,
        lootbuddyClass: null,
        character: { wowClass: "MAGE" as const, name: "Arcane" },
        userName: "Mage",
      },
      {
        id: "sham-1",
        participationType: "BOOSTER" as const,
        lootbuddyMode: null,
        lootbuddyClass: null,
        character: { wowClass: "SHAMAN" as const, name: "Storm" },
        userName: "Sham",
      },
    ];

    function coverageFor(ids: Set<string>) {
      return evaluateRaidBuffCoverage(
        rows
          .filter((row) => ids.has(row.id))
          .map((row) => ({
            signupId: row.id,
            userName: row.userName,
            participationType: row.participationType,
            lootbuddyMode: row.lootbuddyMode,
            wowClass: resolveBuffContributorClass({
              participationType: row.participationType,
              lootbuddyMode: row.lootbuddyMode,
              lootbuddyClass: row.lootbuddyClass,
              characterWowClass: row.character.wowClass,
            }),
            characterName: row.character.name,
          })),
      );
    }

    expect(coverageFor(selectedIds).buffs.find((b) => b.id === "ARCANE_INTELLECT")?.covered).toBe(true);
    selectedIds.delete("mage-1");
    expect(coverageFor(selectedIds).buffs.find((b) => b.id === "ARCANE_INTELLECT")?.covered).toBe(false);
    expect(coverageFor(selectedIds).buffs.find((b) => b.id === "SKYFURY")?.covered).toBe(true);
  });
});

describe("live composition from staged selection", () => {
  it("updates tank/healer/dps counts when a staged signup is removed", async () => {
    const { composeRoster } = await import("@/services/roster-composition");
    const selected = [
      { participationType: "BOOSTER" as const, selectedRole: "TANK" as const },
      { participationType: "BOOSTER" as const, selectedRole: "HEALER" as const },
      { participationType: "BOOSTER" as const, selectedRole: "DPS" as const },
    ];
    const targets = { tanks: 2, healers: 4, dps: 14 };
    expect(composeRoster(selected, targets).tanks.selected).toBe(1);
    expect(composeRoster(selected.slice(1), targets).tanks.selected).toBe(0);
    expect(composeRoster(selected.slice(1), targets).healers.selected).toBe(1);
  });
});
