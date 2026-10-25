import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { projectCurrentRaidLockoutSlots } from "@/lib/lockout-display";
import {
  TIDEBOUND_GROTTO_RAID_ID,
  UNBINDING_KITHIX_RAID_ID,
  VENOMOUS_ABYSS_RAID_ID,
  WOW_RAID_CATALOG,
  raidContentDisplayName,
} from "@/lib/wow-raid-catalog";

/** Catalog-backed lockout raid descriptors — mirrors Characters page mapping. */
function lockoutRaidDescriptors() {
  return WOW_RAID_CATALOG.filter((raid) => raid.trackLockouts)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((raid) => ({
      id: raid.id,
      name: raidContentDisplayName(raid.id, raid.name),
      bosses: raid.bosses.map((boss) => ({ name: boss.name })),
    }));
}

describe("Characters multi-raid lockout projection", () => {
  it("1. includes every trackLockouts raid from the catalog (no UI hardcode)", () => {
    const descriptors = lockoutRaidDescriptors();
    expect(descriptors.map((raid) => raid.id)).toEqual([
      VENOMOUS_ABYSS_RAID_ID,
      TIDEBOUND_GROTTO_RAID_ID,
      UNBINDING_KITHIX_RAID_ID,
    ]);
    expect(descriptors.map((raid) => raid.name)).toEqual([
      "The Venomous Abyss",
      "Tide",
      "The Unbinding of Kith'ix",
    ]);
  });

  it("2. raid with no Character lockout rows still renders as UNKNOWN with catalog bosses", () => {
    const slots = projectCurrentRaidLockoutSlots([], lockoutRaidDescriptors());
    const kithix = slots.find((slot) => slot.raidId === UNBINDING_KITHIX_RAID_ID);
    expect(kithix).toEqual({
      raidId: UNBINDING_KITHIX_RAID_ID,
      raidName: "The Unbinding of Kith'ix",
      bosses: [{ name: "Kith'ix" }],
      status: "UNKNOWN",
    });
  });

  it("3. 8-boss raid exposes 8 boss names for dots", () => {
    const venomous = lockoutRaidDescriptors().find((raid) => raid.id === VENOMOUS_ABYSS_RAID_ID)!;
    expect(venomous.bosses).toHaveLength(8);
  });

  it("4. 1-boss raids expose a single boss name for dots", () => {
    const tide = lockoutRaidDescriptors().find((raid) => raid.id === TIDEBOUND_GROTTO_RAID_ID)!;
    const kithix = lockoutRaidDescriptors().find((raid) => raid.id === UNBINDING_KITHIX_RAID_ID)!;
    expect(tide.bosses).toHaveLength(1);
    expect(kithix.bosses).toHaveLength(1);
  });

  it("5. Kith'ix is not omitted when other raids have verified rows", () => {
    const slots = projectCurrentRaidLockoutSlots(
      [
        {
          raidId: VENOMOUS_ABYSS_RAID_ID,
          difficulty: "HEROIC",
          bossesDefeated: 3,
          bossTotal: 8,
        },
      ],
      lockoutRaidDescriptors(),
    );
    expect(slots.map((slot) => slot.raidId)).toContain(UNBINDING_KITHIX_RAID_ID);
    expect(slots.find((slot) => slot.raidId === UNBINDING_KITHIX_RAID_ID)?.status).toBe("UNKNOWN");
  });

  it("6. raid order follows catalog sortOrder", () => {
    const ids = lockoutRaidDescriptors().map((raid) => raid.id);
    expect(ids).toEqual([VENOMOUS_ABYSS_RAID_ID, TIDEBOUND_GROTTO_RAID_ID, UNBINDING_KITHIX_RAID_ID]);
  });

  it("7. Characters view does not hardcode current-season raid names", () => {
    const view = readFileSync(resolve("src/components/characters/characters-view.tsx"), "utf8");
    expect(view).not.toMatch(/Venomous Abyss/);
    expect(view).not.toMatch(/Tidebound/);
    expect(view).not.toMatch(/Kith['']ix/);
    expect(view).toMatch(/currentLockoutRaids/);
  });
});
