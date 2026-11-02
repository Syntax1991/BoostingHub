import { describe, expect, it } from "vitest";
import { CONSUMABLE_CATALOG } from "@/lib/consumable-catalog";
import {
  PERSONAL_DEFENSIVE_CATALOG,
  findPersonalDefensive,
  personalDefensiveSpellIds,
} from "@/lib/personal-defensive-catalog";
import { WOW_CLASSES } from "@/models/enums";

describe("personal defensive catalog", () => {
  it("covers every class, with unique spell ids that are never consumables", () => {
    const ids = personalDefensiveSpellIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(PERSONAL_DEFENSIVE_CATALOG.map((entry) => entry.wowClass))).toEqual(new Set(WOW_CLASSES));
    const consumables = new Set(CONSUMABLE_CATALOG.map((entry) => entry.spellId));
    expect(ids.filter((id) => consumables.has(id))).toEqual([]);
  });

  it("includes the real Retribution / Holy Divine Protection and other verified personal cooldowns", () => {
    expect(findPersonalDefensive(403876)).toMatchObject({ name: "Divine Protection", wowClass: "PALADIN", kind: "MITIGATION" });
    expect(findPersonalDefensive(498)).toMatchObject({ name: "Divine Protection", specs: ["Holy"] });
    expect(findPersonalDefensive(642)).toMatchObject({ name: "Divine Shield", kind: "IMMUNITY" });
    expect(findPersonalDefensive(48792)).toMatchObject({ name: "Icebound Fortitude", wowClass: "DEATH_KNIGHT" });
  });

  it("excludes externals, offensive and utility spells and secondary events", () => {
    for (const id of [
      633, // Lay on Hands — mostly cast on others
      33206, // Pain Suppression — external
      102342, // Ironbark — external
      1022, // Blessing of Protection — external
      200166, // Havoc Metamorphosis — offensive
      31884, // Avenging Wrath — offensive
      586, // Fade — threat utility
      110960, // Greater Invisibility secondary event
      342247, // Alter Time return
    ]) {
      expect(findPersonalDefensive(id)).toBeNull();
    }
  });
});
