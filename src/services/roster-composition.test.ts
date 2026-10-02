import { describe, expect, it } from "vitest";
import { composeRoster, compositionWarnings } from "@/services/roster-composition";

const targets = { tanks: 2, healers: 4, dps: 14 };

describe("composeRoster", () => {
  it("counts booster roles against run targets and excludes lootbuddies", () => {
    const composition = composeRoster(
      [
        { participationType: "BOOSTER", selectedRole: "TANK" },
        { participationType: "BOOSTER", selectedRole: "TANK" },
        { participationType: "BOOSTER", selectedRole: "HEALER" },
        { participationType: "BOOSTER", selectedRole: "MELEE_DPS" },
        { participationType: "LOOTBUDDY", selectedRole: null },
        { participationType: "LOOTBUDDY", selectedRole: "MELEE_DPS" },
      ],
      targets,
    );

    expect(composition.tanks).toEqual({ selected: 2, target: 2, delta: 0 });
    expect(composition.healers).toEqual({ selected: 1, target: 4, delta: -3 });
    expect(composition.dps).toEqual({ selected: 1, target: 14, delta: -13 });
    expect(composition.lootbuddies).toEqual({ selected: 2, target: 0, delta: 2 });
    expect(composition.boosterTotal).toBe(4);
    expect(composition.total).toBe(6);
  });

  it("does not count unresolved generic DPS as a concrete DPS slot", () => {
    const composition = composeRoster(
      [
        { participationType: "BOOSTER", selectedRole: "MELEE_DPS" },
        { participationType: "BOOSTER", selectedRole: "RANGED_DPS" },
        { participationType: "BOOSTER", selectedRole: "DPS" },
        { participationType: "BOOSTER", selectedRole: null },
      ],
      { tanks: 0, healers: 0, dps: 11 },
    );
    expect(composition.dps).toEqual({ selected: 2, target: 11, delta: -9 });
  });

  it("reports under, exact, and over target deltas", () => {
    expect(composeRoster([{ participationType: "BOOSTER", selectedRole: "HEALER" }], { tanks: 2, healers: 4, dps: 14 }).healers.delta).toBe(-3);
    expect(
      composeRoster(
        [
          { participationType: "BOOSTER", selectedRole: "HEALER" },
          { participationType: "BOOSTER", selectedRole: "HEALER" },
          { participationType: "BOOSTER", selectedRole: "HEALER" },
          { participationType: "BOOSTER", selectedRole: "HEALER" },
        ],
        { tanks: 2, healers: 4, dps: 14 },
      ).healers.delta,
    ).toBe(0);
    expect(
      composeRoster(
        [
          { participationType: "BOOSTER", selectedRole: "HEALER" },
          { participationType: "BOOSTER", selectedRole: "HEALER" },
          { participationType: "BOOSTER", selectedRole: "HEALER" },
          { participationType: "BOOSTER", selectedRole: "HEALER" },
          { participationType: "BOOSTER", selectedRole: "HEALER" },
        ],
        { tanks: 2, healers: 4, dps: 14 },
      ).healers.delta,
    ).toBe(1);
  });

  it("does not treat LOOT_ONLY or PLAYING lootbuddies as tank/healer/DPS capacity", () => {
    const composition = composeRoster(
      [
        { participationType: "LOOTBUDDY", selectedRole: "TANK" },
        { participationType: "LOOTBUDDY", selectedRole: "HEALER" },
        { participationType: "LOOTBUDDY", selectedRole: "MELEE_DPS" },
      ],
      targets,
    );
    expect(composition.tanks.selected).toBe(0);
    expect(composition.healers.selected).toBe(0);
    expect(composition.dps.selected).toBe(0);
    expect(composition.lootbuddies.selected).toBe(3);
  });
});

describe("compositionWarnings", () => {
  it("emits under and over warnings without treating them as exclusive", () => {
    const composition = composeRoster(
      [
        { participationType: "BOOSTER", selectedRole: "TANK" },
        { participationType: "BOOSTER", selectedRole: "HEALER" },
        { participationType: "BOOSTER", selectedRole: "HEALER" },
        { participationType: "BOOSTER", selectedRole: "HEALER" },
        { participationType: "BOOSTER", selectedRole: "HEALER" },
        { participationType: "BOOSTER", selectedRole: "HEALER" },
      ],
      targets,
    );
    const warnings = compositionWarnings(composition);
    expect(warnings.some((item) => item.code === "COMPOSITION_UNDER_TARGET" && item.message.includes("Tank"))).toBe(true);
    expect(warnings.some((item) => item.code === "COMPOSITION_OVER_TARGET" && item.message.includes("Healer"))).toBe(true);
    expect(warnings.some((item) => item.message.includes("DPS"))).toBe(true);
  });
});

describe("lootbuddy target (Run.desiredLootbuddyCount)", () => {
  const booster = (role: "TANK" | "HEALER" | "RANGED_DPS") => ({ participationType: "BOOSTER" as const, selectedRole: role });
  const lootbuddy = { participationType: "LOOTBUDDY" as const, selectedRole: null };
  const full = [booster("TANK"), booster("TANK"), ...Array(4).fill(booster("HEALER")), ...Array(12).fill(booster("RANGED_DPS"))];
  const withTargets = (lootbuddies: number) => ({ tanks: 2, healers: 4, dps: 12, lootbuddies });

  it("counts selected lootbuddies against their own target; never in Tank/Healer/DPS", () => {
    const composition = composeRoster([...full, lootbuddy], withTargets(2));
    expect(composition.lootbuddies).toEqual({ selected: 1, target: 2, delta: -1 });
    expect([composition.tanks.delta, composition.healers.delta, composition.dps.delta]).toEqual([0, 0, 0]);
    expect(composition.boosterTotal).toBe(18);
    expect(composition.total).toBe(19); // lootbuddies are real raid participants
  });

  it("a booster never counts as a lootbuddy", () => {
    expect(composeRoster(full, withTargets(2)).lootbuddies).toEqual({ selected: 0, target: 2, delta: -2 });
  });

  it("shortage and excess are acknowledgeable warnings, exactly like booster roles; satisfied → none", () => {
    const short = compositionWarnings(composeRoster([...full, lootbuddy], withTargets(2)));
    expect(short).toEqual([{ code: "COMPOSITION_UNDER_TARGET", message: "Lootbuddy composition is 1 / 2." }]);
    expect(compositionWarnings(composeRoster([...full, lootbuddy, lootbuddy], withTargets(2)))).toEqual([]);
    const over = compositionWarnings(composeRoster([...full, lootbuddy], withTargets(0)));
    expect(over).toEqual([{ code: "COMPOSITION_OVER_TARGET", message: "Lootbuddy composition is 1 / 0." }]);
  });

  it("a lootbuddy shortage never shows up as a DPS shortage", () => {
    const warnings = compositionWarnings(composeRoster(full, withTargets(2)));
    expect(warnings.map((w) => w.message)).toEqual(["Lootbuddy composition is 0 / 2."]);
  });

  it("callers without a lootbuddy target behave as target 0", () => {
    expect(composeRoster([lootbuddy], { tanks: 0, healers: 0, dps: 0 }).lootbuddies).toEqual({ selected: 1, target: 0, delta: 1 });
  });
});
