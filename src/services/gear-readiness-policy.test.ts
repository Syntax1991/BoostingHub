import { describe, expect, it } from "vitest";
import { GEAR_SLOT } from "@/lib/wow-gear-catalog";
import { itemSocketCount } from "@/lib/wow-item-sockets";
import type { WowClass } from "@/models/enums";
import {
  evaluateEnchants,
  evaluateGems,
  offHandKind,
  resolveWeaponEnhancementRequirement,
  type GearItemFact,
} from "@/services/gear-readiness-policy";

// Enchant ids as Warcraft Logs reports them (SpellItemEnchantment, build 12.1.5).
const OIL = 8052; // Thalassian Phoenix Oil
const WHETSTONE = 7905; // Sharpened
const FLAMETONGUE = 5400;
const WINDFURY = 5401;
const EARTHLIVING = 6498;
const TIDECALLERS_GUARD = 7528; // Shaman shield imbue
const RITE_OF_SANCTIFICATION = 7143; // Lightsmith
const FALLEN_CRUSADER = 3368;
const RAZORICE = 3370;
const WEAPON_ENCHANT = 8039; // Acuity of the Ren'dorei
const ARMOR_ENCHANT = 7987;
const UNKNOWN_TEMP = 99999;

function item(slot: number, overrides: Partial<GearItemFact> = {}): GearItemFact {
  return {
    fightId: "f1",
    slot,
    itemId: 1000 + slot,
    permanentEnchantId: null,
    temporaryEnchantId: null,
    gemCount: 0,
    socketCount: 0,
    ...overrides,
  };
}
const mainHand = (overrides: Partial<GearItemFact> = {}) => item(GEAR_SLOT.MAIN_HAND, { permanentEnchantId: WEAPON_ENCHANT, ...overrides });
const offHand = (overrides: Partial<GearItemFact> = {}) => item(GEAR_SLOT.OFF_HAND, overrides);
/** Every enchantable armor slot, enchanted. */
const enchantedArmor = () =>
  [GEAR_SLOT.HEAD, GEAR_SLOT.SHOULDERS, GEAR_SLOT.CHEST, GEAR_SLOT.LEGS, GEAR_SLOT.FEET, GEAR_SLOT.RING_1, GEAR_SLOT.RING_2].map(
    (slot) => item(slot, { permanentEnchantId: ARMOR_ENCHANT }),
  );
const weapon = (wowClass: WowClass | null, gear: GearItemFact[]) => resolveWeaponEnhancementRequirement({ wowClass, gear });

describe("weapon enhancement — generic", () => {
  it("an oil or a sharpening stone on the weapon passes", () => {
    expect(weapon("MAGE", [mainHand({ temporaryEnchantId: OIL })])).toMatchObject({
      status: "PASS",
      weapons: [{ slotLabel: "Main Hand", result: "EXTERNAL", label: "Oil" }],
    });
    expect(weapon("WARRIOR", [mainHand({ temporaryEnchantId: WHETSTONE })]).weapons[0]).toMatchObject({
      result: "EXTERNAL",
      label: "Stone",
    });
  });

  it("no temporary enhancement on the weapon is missing (affirmative: the log shows the weapon without one)", () => {
    expect(weapon("MAGE", [mainHand()])).toMatchObject({ status: "WARNING", weapons: [{ result: "MISSING" }] });
  });

  it("a temporary enchant the catalog does not know yet counts as present, never missing", () => {
    expect(weapon("MAGE", [mainHand({ temporaryEnchantId: UNKNOWN_TEMP })])).toMatchObject({
      status: "PASS",
      weapons: [{ result: "OTHER" }],
    });
  });

  it("no weapon equipped is N/A", () => {
    expect(weapon("MAGE", [item(GEAR_SLOT.HEAD)])).toEqual({ status: "NA", weapons: [], skipped: [] });
  });

  it("a shield / off-hand frill is not a weapon and is never asked for an oil", () => {
    const shieldWithoutEnchant = weapon("PALADIN", [mainHand({ temporaryEnchantId: OIL }), offHand()]);
    expect(shieldWithoutEnchant.status).toBe("PASS");
    expect(shieldWithoutEnchant.skipped).toEqual([{ slot: GEAR_SLOT.OFF_HAND, slotLabel: "Off Hand", reason: "UNKNOWN_IF_WEAPON" }]);
    const frill = weapon("PRIEST", [mainHand({ temporaryEnchantId: OIL }), offHand()]);
    expect(frill).toMatchObject({ status: "PASS", weapons: [{ slot: GEAR_SLOT.MAIN_HAND }] });
  });

  it("a dual-wielded off-hand known to be a weapon is checked too", () => {
    const rogue = weapon("ROGUE", [mainHand({ temporaryEnchantId: OIL }), offHand()]);
    expect(rogue).toMatchObject({ status: "WARNING", weapons: [{ result: "EXTERNAL" }, { slotLabel: "Off Hand", result: "MISSING" }] });
    // Fury Warrior: the off-hand weapon enchant proves it is a weapon.
    const fury = weapon("WARRIOR", [mainHand({ temporaryEnchantId: OIL }), offHand({ permanentEnchantId: WEAPON_ENCHANT, temporaryEnchantId: OIL })]);
    expect(fury).toMatchObject({ status: "PASS", weapons: [{}, { result: "EXTERNAL" }] });
  });
});

describe("weapon enhancement — Shaman imbues", () => {
  it("a valid native imbue passes without any oil (Elemental Flametongue, Restoration Earthliving)", () => {
    expect(weapon("SHAMAN", [mainHand({ temporaryEnchantId: FLAMETONGUE })])).toMatchObject({
      status: "PASS",
      weapons: [{ result: "CLASS_NATIVE", label: "Shaman imbue" }],
    });
    expect(weapon("SHAMAN", [mainHand({ temporaryEnchantId: EARTHLIVING }), offHand({ temporaryEnchantId: TIDECALLERS_GUARD })])).toMatchObject({
      status: "PASS",
      weapons: [{ result: "CLASS_NATIVE" }],
      skipped: [{ reason: "NOT_A_WEAPON" }],
    });
  });

  it("Enhancement: Windfury main hand + Flametongue off-hand", () => {
    expect(weapon("SHAMAN", [mainHand({ temporaryEnchantId: WINDFURY }), offHand({ permanentEnchantId: WEAPON_ENCHANT, temporaryEnchantId: FLAMETONGUE })])).toMatchObject({
      status: "PASS",
      weapons: [{ result: "CLASS_NATIVE" }, { result: "CLASS_NATIVE" }],
    });
  });

  it("a Shaman using an oil instead of an imbue also passes", () => {
    expect(weapon("SHAMAN", [mainHand({ temporaryEnchantId: OIL })]).weapons[0]!.result).toBe("EXTERNAL");
  });

  it("a Shaman weapon with neither imbue nor oil is genuinely missing", () => {
    expect(weapon("SHAMAN", [mainHand()]).status).toBe("WARNING");
  });

  it("an Enhancement off-hand without any enchant data is not judged (could be a shield)", () => {
    expect(weapon("SHAMAN", [mainHand({ temporaryEnchantId: WINDFURY }), offHand()])).toMatchObject({
      status: "PASS",
      skipped: [{ reason: "UNKNOWN_IF_WEAPON" }],
    });
  });
});

describe("weapon enhancement — Death Knight Runeforge", () => {
  it("a Runeforge counts as the weapon enhancement; no oil is asked for on top", () => {
    expect(weapon("DEATH_KNIGHT", [mainHand({ permanentEnchantId: FALLEN_CRUSADER })])).toMatchObject({
      status: "PASS",
      weapons: [{ result: "RUNEFORGE", label: "Runeforge" }],
    });
  });

  it("a Runeforged weapon that also has an oil shows the oil", () => {
    expect(weapon("DEATH_KNIGHT", [mainHand({ permanentEnchantId: FALLEN_CRUSADER, temporaryEnchantId: OIL })]).weapons[0]!.result).toBe(
      "EXTERNAL",
    );
  });

  it("dual-wield: both Runeforged weapons pass; one without a Runeforge (and no oil) is missing", () => {
    expect(
      weapon("DEATH_KNIGHT", [mainHand({ permanentEnchantId: RAZORICE }), offHand({ permanentEnchantId: FALLEN_CRUSADER })]),
    ).toMatchObject({ status: "PASS", weapons: [{ result: "RUNEFORGE" }, { result: "RUNEFORGE" }] });
    // A Death Knight off-hand is always a weapon.
    expect(weapon("DEATH_KNIGHT", [mainHand({ permanentEnchantId: RAZORICE }), offHand({ permanentEnchantId: null })])).toMatchObject({
      status: "WARNING",
      weapons: [{ result: "RUNEFORGE" }, { slotLabel: "Off Hand", result: "MISSING" }],
    });
  });

  it("a Runeforge is recognized even when the class is unknown (Runeforge ids are Death Knight-only)", () => {
    expect(weapon(null, [mainHand({ permanentEnchantId: FALLEN_CRUSADER })]).status).toBe("PASS");
  });
});

describe("weapon enhancement — Paladin (Lightsmith)", () => {
  it("a Lightsmith rite is the weapon's temporary enchant and passes — no Hero Talent lookup needed", () => {
    expect(weapon("PALADIN", [mainHand({ temporaryEnchantId: RITE_OF_SANCTIFICATION })])).toMatchObject({
      status: "PASS",
      weapons: [{ result: "CLASS_NATIVE", label: "Lightsmith rite" }],
    });
  });

  it("a non-Lightsmith Paladin with an oil passes; the shield is never checked", () => {
    expect(weapon("PALADIN", [mainHand({ temporaryEnchantId: OIL }), offHand()])).toMatchObject({
      status: "PASS",
      skipped: [{ reason: "UNKNOWN_IF_WEAPON" }],
    });
  });

  it("Hero Talent state is not needed to judge: no rite and no oil on the weapon is missing either way", () => {
    expect(weapon("PALADIN", [mainHand()]).status).toBe("WARNING");
  });
});

describe("off-hand classification", () => {
  it("needs evidence unless the class can hold only weapons there", () => {
    expect(offHandKind(undefined, "ROGUE")).toBeNull();
    expect(offHandKind(offHand(), "DEMON_HUNTER")).toBe("WEAPON");
    expect(offHandKind(offHand(), "WARRIOR")).toBe("UNKNOWN");
    expect(offHandKind(offHand({ temporaryEnchantId: TIDECALLERS_GUARD }), "SHAMAN")).toBe("NOT_A_WEAPON");
    expect(offHandKind(offHand({ permanentEnchantId: WEAPON_ENCHANT }), "MONK")).toBe("WEAPON");
  });
});

describe("permanent enchants", () => {
  it("all applicable slots enchanted", () => {
    const check = evaluateEnchants({ wowClass: "MAGE", gear: [...enchantedArmor(), mainHand(), item(GEAR_SLOT.NECK), item(GEAR_SLOT.WAIST)] });
    expect(check).toMatchObject({ status: "PASS", enchanted: 8, required: 8, missing: [], unknown: [] });
  });

  it("one missing enchant names the slot", () => {
    const gear = [...enchantedArmor().filter((row) => row.slot !== GEAR_SLOT.RING_2), item(GEAR_SLOT.RING_2), mainHand()];
    expect(evaluateEnchants({ wowClass: "MAGE", gear })).toMatchObject({
      status: "WARNING",
      enchanted: 7,
      required: 8,
      missing: [{ slotLabel: "Ring 2" }],
    });
  });

  it("several missing enchants are all listed", () => {
    const gear = [item(GEAR_SLOT.HEAD), item(GEAR_SLOT.FEET), mainHand({ permanentEnchantId: null })];
    expect(evaluateEnchants({ wowClass: "MAGE", gear }).missing.map((row) => row.slotLabel)).toEqual(["Head", "Feet", "Main Hand"]);
  });

  it("non-enchantable slots (neck, waist, wrists, hands, back, trinkets) are never required", () => {
    const gear = [GEAR_SLOT.NECK, GEAR_SLOT.WAIST, GEAR_SLOT.WRISTS, GEAR_SLOT.HANDS, GEAR_SLOT.BACK, GEAR_SLOT.TRINKET_1].map((slot) => item(slot));
    expect(evaluateEnchants({ wowClass: "MAGE", gear })).toMatchObject({ status: "NA", required: 0 });
  });

  it("no gear in the log is UNKNOWN, never a failure", () => {
    expect(evaluateEnchants({ wowClass: "MAGE", gear: null }).status).toBe("UNKNOWN");
  });

  it("a Runeforge is the Death Knight's weapon enchant — no double failure next to the weapon check", () => {
    const gear = [...enchantedArmor(), mainHand({ permanentEnchantId: RAZORICE }), offHand({ permanentEnchantId: FALLEN_CRUSADER })];
    expect(evaluateEnchants({ wowClass: "DEATH_KNIGHT", gear })).toMatchObject({
      status: "PASS",
      required: 9,
      runeforges: ["Rune of Razorice", "Rune of the Fallen Crusader"],
    });
    expect(resolveWeaponEnhancementRequirement({ wowClass: "DEATH_KNIGHT", gear }).status).toBe("PASS");
  });

  it("an off-hand that may be a shield is listed as not judged, not as missing", () => {
    const check = evaluateEnchants({ wowClass: "WARRIOR", gear: [...enchantedArmor(), mainHand(), offHand()] });
    expect(check).toMatchObject({ status: "PASS", required: 8, unknown: [{ slotLabel: "Off Hand" }] });
  });
});

describe("gems — every existing socket filled", () => {
  it("no sockets at all is N/A (0 required)", () => {
    expect(evaluateGems({ gear: [mainHand(), item(GEAR_SLOT.HEAD)] })).toEqual({ status: "NA", filled: 0, sockets: 0, empty: [], unknown: [] });
  });

  it("one socket filled / one socket empty", () => {
    expect(evaluateGems({ gear: [item(GEAR_SLOT.RING_1, { socketCount: 1, gemCount: 1 })] })).toMatchObject({ status: "PASS", filled: 1, sockets: 1 });
    expect(evaluateGems({ gear: [item(GEAR_SLOT.RING_1, { socketCount: 1, gemCount: 0 })] })).toMatchObject({
      status: "WARNING",
      empty: [{ slotLabel: "Ring 1", emptySockets: 1, sockets: 1 }],
    });
  });

  it("multiple sockets on one item: all filled, or one of them empty", () => {
    expect(evaluateGems({ gear: [item(GEAR_SLOT.NECK, { socketCount: 2, gemCount: 2 })] }).status).toBe("PASS");
    expect(evaluateGems({ gear: [item(GEAR_SLOT.NECK, { socketCount: 2, gemCount: 1 })] })).toMatchObject({
      status: "WARNING",
      filled: 1,
      sockets: 2,
      empty: [{ slotLabel: "Neck", emptySockets: 1, sockets: 2 }],
    });
  });

  it("several socketed items are summed; only the item with an empty socket is named", () => {
    const gear = [
      item(GEAR_SLOT.NECK, { socketCount: 2, gemCount: 2 }),
      item(GEAR_SLOT.RING_1, { socketCount: 1, gemCount: 1 }),
      item(GEAR_SLOT.WRISTS, { socketCount: 1, gemCount: 0 }),
    ];
    expect(evaluateGems({ gear })).toMatchObject({ status: "WARNING", filled: 3, sockets: 4, empty: [{ slotLabel: "Wrists" }] });
  });

  it("socket data unavailable is UNKNOWN (never a missing gem)", () => {
    expect(evaluateGems({ gear: null }).status).toBe("UNKNOWN");
    expect(evaluateGems({ gear: [item(GEAR_SLOT.CHEST, { socketCount: null, gemCount: 1 })] })).toMatchObject({
      status: "UNKNOWN",
      unknown: [{ slotLabel: "Chest" }],
    });
  });
});

describe("item socket count from game data", () => {
  it("adds base sockets and bonus-list sockets; gems it cannot explain make it unknown", () => {
    // Real items from Venomous Abyss logs.
    expect(itemSocketCount({ itemId: 268265, bonusIds: [6652, 13668, 13334, 13987, 12852], gemCount: 2 })).toBe(2);
    expect(itemSocketCount({ itemId: 271492, bonusIds: [13695], gemCount: 0 })).toBe(1); // socket bonus, empty
    expect(itemSocketCount({ itemId: 271492, bonusIds: [], gemCount: 0 })).toBe(0);
    expect(itemSocketCount({ itemId: 251513, bonusIds: [], gemCount: 1 })).toBe(1); // base socket
    expect(itemSocketCount({ itemId: 271495, bonusIds: [], gemCount: 1 })).toBeNull();
  });
});
