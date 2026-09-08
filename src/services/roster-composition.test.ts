import { describe, expect, it } from "vitest";
import { composeRoster, compositionWarnings } from "@/services/roster-composition";

const targets = { tanks: 2, healers: 4, dps: 14 };

describe("composeRoster", () => {
  it("counts booster roles against run targets and excludes lootbuddies", () => {
    const composition = composeRoster(
      [
        { participationType: "BOOSTER", role: "TANK" },
        { participationType: "BOOSTER", role: "TANK" },
        { participationType: "BOOSTER", role: "HEALER" },
        { participationType: "BOOSTER", role: "DPS" },
        { participationType: "LOOTBUDDY", role: null },
        { participationType: "LOOTBUDDY", role: "DPS" },
      ],
      targets,
    );

    expect(composition.tanks).toEqual({ selected: 2, target: 2, delta: 0 });
    expect(composition.healers).toEqual({ selected: 1, target: 4, delta: -3 });
    expect(composition.dps).toEqual({ selected: 1, target: 14, delta: -13 });
    expect(composition.lootbuddies).toBe(2);
    expect(composition.boosterTotal).toBe(4);
    expect(composition.total).toBe(6);
  });

  it("reports under, exact, and over target deltas", () => {
    expect(composeRoster([{ participationType: "BOOSTER", role: "HEALER" }], { tanks: 2, healers: 4, dps: 14 }).healers.delta).toBe(-3);
    expect(
      composeRoster(
        [
          { participationType: "BOOSTER", role: "HEALER" },
          { participationType: "BOOSTER", role: "HEALER" },
          { participationType: "BOOSTER", role: "HEALER" },
          { participationType: "BOOSTER", role: "HEALER" },
        ],
        { tanks: 2, healers: 4, dps: 14 },
      ).healers.delta,
    ).toBe(0);
    expect(
      composeRoster(
        [
          { participationType: "BOOSTER", role: "HEALER" },
          { participationType: "BOOSTER", role: "HEALER" },
          { participationType: "BOOSTER", role: "HEALER" },
          { participationType: "BOOSTER", role: "HEALER" },
          { participationType: "BOOSTER", role: "HEALER" },
        ],
        { tanks: 2, healers: 4, dps: 14 },
      ).healers.delta,
    ).toBe(1);
  });

  it("does not treat LOOT_ONLY or PLAYING lootbuddies as tank/healer/DPS capacity", () => {
    const composition = composeRoster(
      [
        { participationType: "LOOTBUDDY", role: "TANK" },
        { participationType: "LOOTBUDDY", role: "HEALER" },
        { participationType: "LOOTBUDDY", role: "DPS" },
      ],
      targets,
    );
    expect(composition.tanks.selected).toBe(0);
    expect(composition.healers.selected).toBe(0);
    expect(composition.dps.selected).toBe(0);
    expect(composition.lootbuddies).toBe(3);
  });
});

describe("compositionWarnings", () => {
  it("emits under and over warnings without treating them as exclusive", () => {
    const composition = composeRoster(
      [
        { participationType: "BOOSTER", role: "TANK" },
        { participationType: "BOOSTER", role: "HEALER" },
        { participationType: "BOOSTER", role: "HEALER" },
        { participationType: "BOOSTER", role: "HEALER" },
        { participationType: "BOOSTER", role: "HEALER" },
        { participationType: "BOOSTER", role: "HEALER" },
      ],
      targets,
    );
    const warnings = compositionWarnings(composition);
    expect(warnings.some((item) => item.code === "COMPOSITION_UNDER_TARGET" && item.message.includes("Tank"))).toBe(true);
    expect(warnings.some((item) => item.code === "COMPOSITION_OVER_TARGET" && item.message.includes("Healer"))).toBe(true);
    expect(warnings.some((item) => item.message.includes("DPS"))).toBe(true);
  });
});
