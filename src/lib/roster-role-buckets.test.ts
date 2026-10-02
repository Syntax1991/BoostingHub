import { describe, expect, it } from "vitest";
import {
  countRolesByBucket,
  externalBoosterRosterBucket,
  rosterBucketForRole,
} from "@/lib/roster-role-buckets";
import { preferredRoleForClass } from "@/lib/external-booster-staging";
import { isConcreteCharacterRole } from "@/lib/character-roles";

describe("roster role buckets (concrete Melee/Ranged)", () => {
  it("1–4. concrete assigned roles map to distinct buckets", () => {
    expect(rosterBucketForRole("MELEE_DPS")).toBe("MELEE_DPS");
    expect(rosterBucketForRole("RANGED_DPS")).toBe("RANGED_DPS");
    expect(rosterBucketForRole("HEALER")).toBe("HEALER");
    expect(rosterBucketForRole("TANK")).toBe("TANK");
  });

  it("5. Melee and Ranged stay separate (never one authoritative DPS bucket)", () => {
    const counts = countRolesByBucket(["MELEE_DPS", "RANGED_DPS", "HEALER", "TANK"]);
    expect(counts.meleeDps).toBe(1);
    expect(counts.rangedDps).toBe(1);
    expect(counts.dps).toBe(2);
    expect(counts.healers).toBe(1);
    expect(counts.tanks).toBe(1);
  });

  it("6–7. HEALER + RANGED_DPS assignment picks the chosen concrete bucket", () => {
    expect(rosterBucketForRole("RANGED_DPS")).toBe("RANGED_DPS");
    expect(rosterBucketForRole("HEALER")).toBe("HEALER");
  });

  it("8. MELEE_DPS + RANGED_DPS offers stay explicit subtypes", () => {
    const offered = ["MELEE_DPS", "RANGED_DPS"] as const;
    expect(offered.every(isConcreteCharacterRole)).toBe(true);
    expect(offered.includes("DPS" as never)).toBe(false);
  });

  it("9. generic DPS is not a concrete assignment", () => {
    expect(isConcreteCharacterRole("DPS")).toBe(false);
  });

  it("10–11. external Mage/Rogue preferred roles are concrete subtypes", () => {
    expect(preferredRoleForClass("MAGE")).toBe("RANGED_DPS");
    expect(externalBoosterRosterBucket(preferredRoleForClass("MAGE"))).toBe("RANGED_DPS");
    expect(preferredRoleForClass("ROGUE")).toBe("MELEE_DPS");
    expect(externalBoosterRosterBucket(preferredRoleForClass("ROGUE"))).toBe("MELEE_DPS");
  });

  it("12–14. historical generic DPS stays Legacy — never auto Melee or Ranged", () => {
    expect(rosterBucketForRole("DPS")).toBe("LEGACY_DPS");
    expect(externalBoosterRosterBucket("DPS")).toBe("LEGACY_DPS");
    expect(externalBoosterRosterBucket("DPS")).not.toBe("MELEE_DPS");
    expect(externalBoosterRosterBucket("DPS")).not.toBe("RANGED_DPS");
  });

  it("aggregate DPS = melee + ranged + legacy", () => {
    expect(countRolesByBucket(["MELEE_DPS", "RANGED_DPS", "DPS"]).dps).toBe(3);
    expect(countRolesByBucket(["MELEE_DPS", "RANGED_DPS", "DPS"]).legacyDps).toBe(1);
  });
});
