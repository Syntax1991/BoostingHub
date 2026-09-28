import { describe, expect, it } from "vitest";
import { GEAR_SLOT } from "@/lib/wow-gear-catalog";
import { WOW_ITEM_SOCKETS_MAX_ITEM_ID, itemSocketCount } from "@/lib/wow-item-sockets";
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
    expect(weapon("MAGE", [item(GEAR_SLOT.HEAD)])).toEqual({ status: "NA", expected: "TEMPORARY", weapons: [], skipped: [] });
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

describe("weapon enhancement — Death Knight Runeforge (product rule: an oil is never required)", () => {
  const dkMissingTexts = (gear: GearItemFact[]) => {
    const requirement = weapon("DEATH_KNIGHT", gear);
    return requirement.weapons.filter((row) => row.result === "MISSING").map((row) => `${row.slotLabel}: ${row.label}`);
  };

  it("1. two-hander with a Runeforge and no oil passes", () => {
    expect(weapon("DEATH_KNIGHT", [mainHand({ permanentEnchantId: FALLEN_CRUSADER })])).toMatchObject({
      status: "PASS",
      expected: "RUNEFORGE",
      weapons: [{ result: "RUNEFORGE", label: "Runeforge" }],
    });
  });

  it("2. two-hander with a Runeforge and an oil passes — the oil is optional", () => {
    expect(weapon("DEATH_KNIGHT", [mainHand({ permanentEnchantId: FALLEN_CRUSADER, temporaryEnchantId: OIL })])).toMatchObject({
      status: "PASS",
      weapons: [{ result: "RUNEFORGE", label: "Runeforge" }],
    });
  });

  it("3. dual-wield with a Runeforge on both weapons and no oil passes", () => {
    expect(
      weapon("DEATH_KNIGHT", [mainHand({ permanentEnchantId: RAZORICE }), offHand({ permanentEnchantId: FALLEN_CRUSADER })]),
    ).toMatchObject({ status: "PASS", weapons: [{ result: "RUNEFORGE" }, { result: "RUNEFORGE" }] });
  });

  it("4. dual-wield with one weapon lacking a Runeforge fails for that weapon only", () => {
    // A Death Knight off-hand is always a weapon.
    expect(weapon("DEATH_KNIGHT", [mainHand({ permanentEnchantId: RAZORICE }), offHand({ permanentEnchantId: null })])).toMatchObject({
      status: "WARNING",
      weapons: [{ result: "RUNEFORGE" }, { slotLabel: "Off Hand", result: "MISSING", label: "Missing Runeforge" }],
    });
  });

  it("5. a valid Runeforge never produces an oil failure", () => {
    const gear = [mainHand({ permanentEnchantId: FALLEN_CRUSADER, temporaryEnchantId: null })];
    expect(dkMissingTexts(gear)).toEqual([]);
  });

  it("6. a valid Runeforge never produces a generic weapon-enchant failure", () => {
    const check = evaluateEnchants({ wowClass: "DEATH_KNIGHT", gear: [...enchantedArmor(), mainHand({ permanentEnchantId: FALLEN_CRUSADER })] });
    expect(check).toMatchObject({ status: "PASS", enchanted: 8, required: 8, missing: [], runeforges: ["Rune of the Fallen Crusader"] });
  });

  it("7. a missing Runeforge is one precise failure — not an oil failure, not a second enchant failure", () => {
    // Even an oil does not stand in for the Runeforge.
    const gear = [...enchantedArmor(), mainHand({ permanentEnchantId: null, temporaryEnchantId: OIL })];
    expect(dkMissingTexts(gear)).toEqual(["Main Hand: Missing Runeforge"]);
    const enchants = evaluateEnchants({ wowClass: "DEATH_KNIGHT", gear });
    expect(enchants).toMatchObject({ status: "PASS", missing: [], checkedAsWeapon: [{ slotLabel: "Main Hand" }] });
    // A normal weapon enchant is not a Runeforge either — still reported once, by the weapon check.
    const normalEnchant = [...enchantedArmor(), mainHand({ permanentEnchantId: WEAPON_ENCHANT })];
    expect(dkMissingTexts(normalEnchant)).toEqual(["Main Hand: Missing Runeforge"]);
    expect(evaluateEnchants({ wowClass: "DEATH_KNIGHT", gear: normalEnchant }).missing).toEqual([]);
  });

  it("no weapon data is UNKNOWN at the policy level, not a missing Runeforge", () => {
    expect(weapon("DEATH_KNIGHT", [item(GEAR_SLOT.HEAD)])).toMatchObject({ status: "NA", weapons: [] });
    expect(evaluateEnchants({ wowClass: "DEATH_KNIGHT", gear: null }).status).toBe("UNKNOWN");
  });

  it("a Runeforge is recognized even when the class is unknown (Runeforge ids are Death Knight-only)", () => {
    expect(weapon(null, [mainHand({ permanentEnchantId: FALLEN_CRUSADER })])).toMatchObject({
      status: "PASS",
      expected: "TEMPORARY",
      weapons: [{ result: "RUNEFORGE" }],
    });
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

describe("socket count comes from the actual item, never from its slot", () => {
  // Real items and bonus lists from Blizzard game data (build 12.1.5), as seen in Venomous Abyss logs.
  const ULATEK_NECK = 268265; // Aqirbane Reliquary: 1 base socket
  const ULATEK_NECK_BONUSES = [6652, 13668, 13334, 13987, 12852]; // 13668 adds a socket
  const TWO_BASE_SOCKET_NECK = 96932; // a neck with 2 base sockets
  const ZERO_SOCKET_NECK = 282426; // a neck without any socket
  const neckGems = (itemId: number, bonusIds: number[], gemCount: number) => {
    const socketCount = itemSocketCount({ itemId, bonusIds, gemCount });
    return { socketCount, check: evaluateGems({ gear: [item(GEAR_SLOT.NECK, { itemId, gemCount, socketCount })] }) };
  };

  it("multi-socket neck (item data: 2 base sockets): 2/2 pass, 1/2 and 0/2 fail", () => {
    expect(neckGems(TWO_BASE_SOCKET_NECK, [], 2)).toMatchObject({ socketCount: 2, check: { status: "PASS", filled: 2, sockets: 2 } });
    expect(neckGems(TWO_BASE_SOCKET_NECK, [], 1)).toMatchObject({
      check: { status: "WARNING", filled: 1, sockets: 2, empty: [{ slotLabel: "Neck", emptySockets: 1, sockets: 2 }] },
    });
    expect(neckGems(TWO_BASE_SOCKET_NECK, [], 0)).toMatchObject({
      check: { status: "WARNING", filled: 0, sockets: 2, empty: [{ emptySockets: 2, sockets: 2 }] },
    });
  });

  it("base + bonus socket: the Ula'tek-type neck has 1 base socket, bonus 13668 adds the 2nd", () => {
    expect(itemSocketCount({ itemId: ULATEK_NECK, bonusIds: [], gemCount: 0 })).toBe(1);
    expect(itemSocketCount({ itemId: ULATEK_NECK, bonusIds: [13668], gemCount: 0 })).toBe(2);
    expect(neckGems(ULATEK_NECK, ULATEK_NECK_BONUSES, 2)).toMatchObject({ socketCount: 2, check: { status: "PASS", filled: 2, sockets: 2 } });
    expect(neckGems(ULATEK_NECK, ULATEK_NECK_BONUSES, 1)).toMatchObject({ check: { status: "WARNING", filled: 1, sockets: 2 } });
    expect(neckGems(ULATEK_NECK, ULATEK_NECK_BONUSES, 0)).toMatchObject({ check: { status: "WARNING", filled: 0, sockets: 2 } });
  });

  it("zero-socket items have no gem requirement — whatever the slot", () => {
    expect(neckGems(ZERO_SOCKET_NECK, [], 0)).toMatchObject({ socketCount: 0, check: { status: "NA", sockets: 0 } });
    expect(itemSocketCount({ itemId: 271492, bonusIds: [], gemCount: 0 })).toBe(0); // a head piece
  });

  it("socket bonuses count on any slot, and a base socket on a ring works the same way", () => {
    expect(itemSocketCount({ itemId: 271492, bonusIds: [13695], gemCount: 0 })).toBe(1); // head + socket bonus, empty
    expect(itemSocketCount({ itemId: 251513, bonusIds: [], gemCount: 1 })).toBe(1); // ring, base socket
  });

  it("unknown items are UNKNOWN, never a missing gem", () => {
    // Newer than the socket table (a later patch before it is regenerated), even with no gems seen.
    const newItem = WOW_ITEM_SOCKETS_MAX_ITEM_ID + 1;
    expect(neckGems(newItem, [], 0)).toMatchObject({ socketCount: null, check: { status: "UNKNOWN", unknown: [{ slotLabel: "Neck" }] } });
    expect(neckGems(newItem, [13668], 0).check.status).toBe("UNKNOWN");
    // Known item, but the log shows more gems than the game data explains (unknown bonus).
    expect(itemSocketCount({ itemId: 271495, bonusIds: [], gemCount: 1 })).toBeNull();
  });
});
