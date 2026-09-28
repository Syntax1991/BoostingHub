import { describe, expect, it } from "vitest";
import {
  CONSUMABLE_AUDIT_POLICY,
  DEATH_CONSUMABLE_LOOKBACK_SECONDS,
  evaluatePlayerConsumables,
  healthstoneApplicability,
  summarizePlayedRole,
  type AuditFightFact,
  type AuditObservationFact,
  type AuditPlayerFact,
} from "@/services/consumable-audit-policy";
import { findConsumableBySpellId } from "@/lib/consumable-catalog";
import type { CharacterRole } from "@/models/enums";

const RECKLESSNESS = 1236994; // DAMAGE_POTION
const LIGHTFUSED_MANA = 1236648; // MANA_POTION
const SILVERMOON_HEALTH = 1234768; // HEALING_POTION
const HEALTHSTONE = 6262;
const FLASK_MAGISTERS = 1235108;

function fight(overrides: Partial<AuditFightFact> & { id: string }): AuditFightFact {
  return {
    wclFightId: Number(overrides.id.replace(/\D/g, "")) || 1,
    encounterName: "Ula'tek",
    kill: true,
    startMs: 0,
    endMs: 600_000,
    raidContentId: null,
    warlockPresent: true,
    healthstoneUseSeen: false,
    ...overrides,
    reportCode: overrides.reportCode ?? "AbCdEfGhIjKlMnOp",
  };
}

const at = (fightId: string, ms: number) => ({ fightId, atMs: ms });
const combatant = (fightId: string, ms = 0): AuditObservationFact => ({
  ...at(fightId, ms),
  kind: "COMBATANT",
  category: null,
  spellId: null,
  specId: null,
});
const participant = (fightId: string, ms = 0): AuditObservationFact => ({
  ...at(fightId, ms),
  kind: "PARTICIPANT",
  category: null,
  spellId: null,
  specId: null,
});
const flask = (fightId: string, ms = 0): AuditObservationFact => ({
  ...at(fightId, ms),
  kind: "AURA",
  category: "FLASK",
  spellId: FLASK_MAGISTERS,
  specId: null,
});
/** Food buff at pull (recognized by name at extraction; any id). */
const food = (fightId: string, ms = 0): AuditObservationFact => ({
  ...at(fightId, ms),
  kind: "AURA",
  category: "FOOD",
  spellId: 1285644,
  specId: null,
});
const cast = (fightId: string, ms: number, spellId: number, category: string): AuditObservationFact => ({
  ...at(fightId, ms),
  kind: "CAST",
  category,
  spellId,
  specId: null,
});
const damagePot = (fightId: string, ms: number) => cast(fightId, ms, RECKLESSNESS, "DAMAGE_POTION");
const manaPot = (fightId: string, ms: number) => cast(fightId, ms, LIGHTFUSED_MANA, "MANA_POTION");
const healPot = (fightId: string, ms: number) => cast(fightId, ms, SILVERMOON_HEALTH, "HEALING_POTION");
const stone = (fightId: string, ms: number) => cast(fightId, ms, HEALTHSTONE, "HEALTHSTONE");
const death = (fightId: string, ms: number): AuditObservationFact => ({
  ...at(fightId, ms),
  kind: "DEATH",
  category: null,
  spellId: null,
  specId: null,
});

/** Blizzard spec ids: Shadow / Holy Priest, Protection Warrior. */
const SPEC = { SHADOW: 258, HOLY: 257, PROT_WARRIOR: 73 } as const;
const PLAYED_SPEC: Record<CharacterRole, number> = { DPS: SPEC.SHADOW, HEALER: SPEC.HOLY, TANK: SPEC.PROT_WARRIOR };
const withSpec = (row: AuditObservationFact, specId: number | null): AuditObservationFact => ({ ...row, specId });

/**
 * `role` is the role PLAYED in every snapshot (stamped as a matching spec on
 * COMBATANT rows without one) and the roster role alike — roster and log agree.
 */
function player(role: CharacterRole | null, observations: AuditObservationFact[]): AuditPlayerFact {
  return {
    id: "p1",
    displayName: "Synlight",
    characterName: "Synlight",
    characterRealm: "Blackhand",
    wowClass: role === "TANK" ? "WARRIOR" : "PRIEST",
    rosterRole: role,
    matchStatus: "MATCHED",
    isExternal: false,
    observations: observations.map((row) =>
      row.kind === "COMBATANT" && row.specId == null && role ? withSpec(row, PLAYED_SPEC[role]) : row,
    ),
    gear: [],
  };
}

const F1 = fight({ id: "f1" });

describe("combat potion role policy", () => {
  it("DPS with a Damage Potion passes", () => {
    const view = evaluatePlayerConsumables(player("DPS", [combatant("f1"), damagePot("f1", 4_000)]), [F1]);
    expect(view.combatPotion.status).toBe("PASS");
    expect(view.combatPotion.uses).toHaveLength(1);
    expect(view.combatPotion.uses[0]!.atFightMs).toBe(4_000);
  });

  it("DPS without a Damage Potion warns", () => {
    const view = evaluatePlayerConsumables(player("DPS", [combatant("f1")]), [F1]);
    expect(view.combatPotion.status).toBe("WARNING");
    expect(view.combatPotion.missing.map((ref) => ref.fightId)).toEqual(["f1"]);
  });

  it("DPS with only a Mana Potion still warns", () => {
    const view = evaluatePlayerConsumables(player("DPS", [combatant("f1"), manaPot("f1", 1_000)]), [F1]);
    expect(view.combatPotion.status).toBe("WARNING");
  });

  it("Tank with a Damage Potion passes", () => {
    const view = evaluatePlayerConsumables(player("TANK", [combatant("f1"), damagePot("f1", 1_000)]), [F1]);
    expect(view.combatPotion.status).toBe("PASS");
  });

  it("Tank without a Damage Potion warns", () => {
    const view = evaluatePlayerConsumables(player("TANK", [combatant("f1")]), [F1]);
    expect(view.combatPotion.status).toBe("WARNING");
  });

  it("Healer with a Damage Potion passes", () => {
    const view = evaluatePlayerConsumables(player("HEALER", [combatant("f1"), damagePot("f1", 1_000)]), [F1]);
    expect(view.combatPotion.status).toBe("PASS");
  });

  it("Healer with a Mana Potion passes", () => {
    const view = evaluatePlayerConsumables(player("HEALER", [combatant("f1"), manaPot("f1", 273_000)]), [F1]);
    expect(view.combatPotion.status).toBe("PASS");
    expect(view.combatPotion.accepted).toEqual(["DAMAGE_POTION", "MANA_POTION"]);
  });

  it("Healer with neither warns", () => {
    const view = evaluatePlayerConsumables(player("HEALER", [combatant("f1"), healPot("f1", 1_000)]), [F1]);
    expect(view.combatPotion.status).toBe("WARNING");
  });

  it("does not require a potion on wipes and reports N/A with no kills", () => {
    const wipe = fight({ id: "f2", kill: false });
    const view = evaluatePlayerConsumables(player("DPS", [combatant("f2"), flask("f2"), food("f2")]), [wipe]);
    expect(view.combatPotion.status).toBe("NA");
    expect(view.warningCount).toBe(0);
  });

  it("requires one accepted potion per kill, not every cooldown", () => {
    const f2 = fight({ id: "f2", startMs: 700_000, endMs: 1_300_000 });
    const onePerKill = evaluatePlayerConsumables(
      player("DPS", [combatant("f1"), damagePot("f1", 1_000), combatant("f2", 700_000), damagePot("f2", 701_000)]),
      [F1, f2],
    );
    expect(onePerKill.combatPotion.status).toBe("PASS");

    const missedSecond = evaluatePlayerConsumables(
      player("DPS", [combatant("f1"), damagePot("f1", 1_000), damagePot("f1", 300_000), combatant("f2", 700_000)]),
      [F1, f2],
    );
    expect(missedSecond.combatPotion.status).toBe("WARNING");
    expect(missedSecond.combatPotion.missing.map((ref) => ref.fightId)).toEqual(["f2"]);
    expect(missedSecond.combatPotion.uses).toHaveLength(2);
  });

  it("is UNKNOWN (never a failure) when the played role is unknown", () => {
    const view = evaluatePlayerConsumables(player(null, [combatant("f1"), flask("f1"), food("f1")]), [F1]);
    expect(view.combatPotion.status).toBe("UNKNOWN");
    expect(view.warningCount).toBe(0);
  });
});

describe("flask", () => {
  it("passes when the flask aura is active at pull", () => {
    const view = evaluatePlayerConsumables(player("DPS", [combatant("f1"), flask("f1")]), [F1]);
    expect(view.flask.status).toBe("PASS");
    expect(view.flask.flaskNames).toEqual(["Flask of the Magisters"]);
  });

  it("warns when the pull snapshot has no flask", () => {
    const view = evaluatePlayerConsumables(player("DPS", [combatant("f1")]), [F1]);
    expect(view.flask.status).toBe("WARNING");
    expect(view.flask.missing).toHaveLength(1);
  });

  it("is UNKNOWN, not a warning, without a pull snapshot", () => {
    const view = evaluatePlayerConsumables(player("DPS", [participant("f1"), damagePot("f1", 1_000)]), [F1]);
    expect(view.flask.status).toBe("UNKNOWN");
    expect(view.flask.unknown).toHaveLength(1);
    expect(view.warningCount).toBe(0);
  });
});

describe("general Healing Potion / Healthstone usage", () => {
  it("zero deaths + no Healing Potion + no Healthstone is neutral, never a warning", () => {
    const view = evaluatePlayerConsumables(
      player("DPS", [combatant("f1"), flask("f1"), food("f1"), damagePot("f1", 1_000)]),
      [F1],
    );
    expect(view.healingPotion.status).toBe("NEUTRAL");
    expect(view.healthstone.status).toBe("NEUTRAL");
    expect(view.deaths).toEqual([]);
    expect(view.warningCount).toBe(0);
  });

  it("shows usage without deaths as PASS", () => {
    const view = evaluatePlayerConsumables(
      player("DPS", [combatant("f1"), healPot("f1", 10_000), stone("f1", 20_000)]),
      [F1],
    );
    expect(view.healingPotion.status).toBe("PASS");
    expect(view.healthstone.status).toBe("PASS");
  });
});

describe("healthstone applicability", () => {
  it("is applicable with a Warlock or any Healthstone use in the fight", () => {
    expect(healthstoneApplicability(fight({ id: "f1", warlockPresent: true }))).toBe("APPLICABLE");
    expect(
      healthstoneApplicability(fight({ id: "f1", warlockPresent: false, healthstoneUseSeen: true })),
    ).toBe("APPLICABLE");
  });

  it("is not applicable without a Warlock and without any Healthstone use", () => {
    expect(healthstoneApplicability(fight({ id: "f1", warlockPresent: false }))).toBe("NOT_APPLICABLE");
  });

  it("is unknown when fight participants were not reported", () => {
    expect(healthstoneApplicability(fight({ id: "f1", warlockPresent: null }))).toBe("UNKNOWN");
  });

  it("shows N/A (not a warning) for a death in a fight without Healthstones", () => {
    const noLock = fight({ id: "f1", warlockPresent: false });
    const view = evaluatePlayerConsumables(player("DPS", [combatant("f1"), healPot("f1", 50_000), death("f1", 60_000)]), [
      noLock,
    ]);
    expect(view.deaths[0]!.healthstone).toEqual({ status: "NOT_APPLICABLE" });
    expect(view.deaths[0]!.warnings).toBe(0);
    expect(view.healthstone.status).toBe("NA");
  });

  it("shows UNKNOWN (not a warning) for a death when applicability is unknown", () => {
    const unknown = fight({ id: "f1", warlockPresent: null });
    const view = evaluatePlayerConsumables(player("DPS", [combatant("f1"), death("f1", 60_000)]), [unknown]);
    expect(view.deaths[0]!.healthstone).toEqual({ status: "UNKNOWN" });
    expect(view.deaths[0]!.warnings).toBe(1); // only the Healing Potion
  });
});

describe("death context", () => {
  it("uses a 30s central lookback", () => {
    expect(DEATH_CONSUMABLE_LOOKBACK_SECONDS).toBe(30);
    expect(CONSUMABLE_AUDIT_POLICY.deathLookbackSeconds).toBe(30);
  });

  it("death + Healing Potion within lookback → used", () => {
    const view = evaluatePlayerConsumables(
      player("DPS", [combatant("f1"), healPot("f1", 315_000), death("f1", 318_000)]),
      [F1],
    );
    expect(view.deaths[0]!.atFightMs).toBe(318_000);
    expect(view.deaths[0]!.healingPotion).toMatchObject({ status: "USED", atFightMs: 315_000 });
  });

  it("death + Healing Potion outside lookback → not used before death", () => {
    const view = evaluatePlayerConsumables(
      player("DPS", [combatant("f1"), healPot("f1", 10_000), death("f1", 318_000)]),
      [F1],
    );
    expect(view.deaths[0]!.healingPotion).toEqual({ status: "NOT_USED" });
    expect(view.healingPotion.status).toBe("WARNING");
  });

  it("a use after the death does not count for it", () => {
    const view = evaluatePlayerConsumables(
      player("DPS", [combatant("f1"), death("f1", 100_000), healPot("f1", 101_000)]),
      [F1],
    );
    expect(view.deaths[0]!.healingPotion).toEqual({ status: "NOT_USED" });
  });

  it("death + Healthstone within lookback → used", () => {
    const view = evaluatePlayerConsumables(
      player("DPS", [combatant("f1"), stone("f1", 312_000), healPot("f1", 315_000), death("f1", 318_000)]),
      [F1],
    );
    expect(view.deaths[0]!.healthstone).toMatchObject({ status: "USED", atFightMs: 312_000 });
    expect(view.deaths[0]!.warnings).toBe(0);
  });

  it("death + no Healthstone (applicable) → not used before death, warning", () => {
    const view = evaluatePlayerConsumables(
      player("DPS", [combatant("f1"), healPot("f1", 315_000), death("f1", 318_000)]),
      [F1],
    );
    expect(view.deaths[0]!.healthstone).toEqual({ status: "NOT_USED" });
    expect(view.deaths[0]!.warnings).toBe(1);
    expect(view.healthstone.status).toBe("WARNING");
  });

  it("evaluates multiple deaths independently and picks the latest use per death", () => {
    const f2 = fight({ id: "f2", encounterName: "Sszorak", startMs: 1_000_000, endMs: 1_600_000 });
    const view = evaluatePlayerConsumables(
      player("DPS", [
        combatant("f1"),
        healPot("f1", 120_000),
        healPot("f1", 128_000),
        death("f1", 134_000),
        combatant("f2", 1_000_000),
        stone("f2", 1_407_000),
        death("f2", 1_411_000),
      ]),
      [F1, f2],
    );
    expect(view.deaths).toHaveLength(2);
    const [first, second] = view.deaths;
    expect(first).toMatchObject({ number: 1, atFightMs: 134_000 });
    expect(first!.fight.encounterName).toBe("Ula'tek");
    expect(first!.healingPotion).toMatchObject({ status: "USED", atFightMs: 128_000 });
    expect(first!.healthstone).toEqual({ status: "NOT_USED" });
    expect(second).toMatchObject({ number: 2, atFightMs: 411_000 });
    expect(second!.fight.encounterName).toBe("Sszorak");
    expect(second!.healingPotion).toEqual({ status: "NOT_USED" });
    expect(second!.healthstone).toMatchObject({ status: "USED", atFightMs: 407_000 });
    expect(view.deathWarnings).toBe(2);
  });

  it("an earlier death's consumable does not cover a later death in the same fight", () => {
    const view = evaluatePlayerConsumables(
      player("DPS", [combatant("f1"), healPot("f1", 100_000), death("f1", 105_000), death("f1", 120_000)]),
      [F1],
    );
    expect(view.deaths[0]!.healingPotion.status).toBe("USED");
    expect(view.deaths[1]!.healingPotion.status).toBe("NOT_USED");
  });
});

describe("multiple fights", () => {
  it("keeps deaths with their encounter and aggregates counts across fights", () => {
    const f2 = fight({ id: "f2", encounterName: "Sszorak", startMs: 700_000, endMs: 1_300_000 });
    const f3 = fight({ id: "f3", encounterName: "Sszorak", kill: false, startMs: 1_400_000, endMs: 1_500_000 });
    const view = evaluatePlayerConsumables(
      player("DPS", [
        combatant("f1"),
        flask("f1"),
        damagePot("f1", 2_000),
        combatant("f3", 1_400_000),
        flask("f3", 1_400_000),
        damagePot("f3", 1_401_000),
        death("f3", 1_450_000),
        combatant("f2", 700_000),
        flask("f2", 700_000),
        damagePot("f2", 702_000),
        death("f2", 900_000),
      ]),
      [F1, f2, f3],
    );
    expect(view.fightsParticipated).toBe(3);
    expect(view.combatPotion.uses).toHaveLength(3);
    expect(view.combatPotion.killFightsChecked).toBe(2);
    expect(view.combatPotion.status).toBe("PASS");
    expect(view.flask).toMatchObject({ status: "PASS", fightsWithFlask: 3, fightsChecked: 3 });
    expect(view.deaths.map((row) => [row.fight.label, row.atFightMs])).toEqual([
      ["Sszorak · Pull 1", 200_000],
      ["Sszorak · Pull 2 (wipe)", 50_000],
    ]);
  });
});

describe("matching", () => {
  it("an unmatched player is UNKNOWN everywhere, never a failure", () => {
    for (const matchStatus of ["NOT_IN_LOG", "NO_CHARACTER_IDENTITY"] as const) {
      const view = evaluatePlayerConsumables({ ...player("DPS", []), matchStatus }, [F1]);
      expect(view.hasLogData).toBe(false);
      expect(view.flask.status).toBe("UNKNOWN");
      expect(view.combatPotion.status).toBe("UNKNOWN");
      expect(view.healingPotion.status).toBe("UNKNOWN");
      expect(view.healthstone.status).toBe("UNKNOWN");
      expect(view.warningCount).toBe(0);
    }
  });

  it("a matched player in no audited fight is UNKNOWN", () => {
    const view = evaluatePlayerConsumables(player("DPS", []), [F1]);
    expect(view.hasLogData).toBe(false);
    expect(view.warningCount).toBe(0);
  });
});

describe("food, runes, weapon enhancement and gear readiness", () => {
  const F2 = fight({ id: "f2", startMs: 700_000, endMs: 1_300_000 });
  const gearItem = (fightId: string, slot: number, overrides: Partial<AuditPlayerFact["gear"][number]> = {}) => ({
    fightId,
    slot,
    itemId: 1000 + slot,
    permanentEnchantId: 7987,
    temporaryEnchantId: null,
    gemCount: 0,
    socketCount: 0,
    ...overrides,
  });
  const readyGear = (fightId: string) => [
    ...[0, 2, 4, 6, 7, 10, 11].map((slot) => gearItem(fightId, slot)),
    gearItem(fightId, 15, { permanentEnchantId: 8039, temporaryEnchantId: 8052 }),
    gearItem(fightId, 1, { permanentEnchantId: null, gemCount: 2, socketCount: 2 }),
  ];
  const withGear = (observations: AuditObservationFact[], gear: AuditPlayerFact["gear"]) => ({
    ...player("DPS", observations),
    gear,
  });

  it("a fully prepared player passes everything and has no warnings", () => {
    const view = evaluatePlayerConsumables(
      withGear([combatant("f1"), flask("f1"), food("f1"), damagePot("f1", 1_000)], readyGear("f1")),
      [F1],
    );
    expect(view.food.status).toBe("PASS");
    expect(view.weaponEnhancement).toMatchObject({ status: "PASS", labels: ["Oil"], fightsChecked: 1 });
    expect(view.gear.enchants).toMatchObject({ status: "PASS", enchanted: 8, required: 8 });
    expect(view.gear.gems).toMatchObject({ status: "PASS", filled: 2, sockets: 2 });
    // 9. No runes at all: still fully compliant.
    expect(view.augmentRune).toMatchObject({ status: "NEUTRAL", fightsWith: 0, fightsChecked: 1 });
    expect(view.vantusRune).toMatchObject({ status: "NEUTRAL", fightsWith: 0, fightsChecked: 1 });
    expect(view.warningCount).toBe(0);
  });

  it("food missing in one fight warns and names it; no snapshot is unknown", () => {
    const view = evaluatePlayerConsumables(
      withGear([combatant("f1"), food("f1"), combatant("f2", 700_000)], []),
      [F1, F2],
    );
    expect(view.food).toMatchObject({ status: "WARNING", fightsWith: 1, fightsChecked: 2 });
    expect(view.food.missing.map((ref) => ref.fightId)).toEqual(["f2"]);
    const unknown = evaluatePlayerConsumables(withGear([participant("f1")], []), [F1]);
    expect(unknown.food.status).toBe("UNKNOWN");
  });

  describe("augment and Vantus runes are optional — information only", () => {
    const augment = (fightId: string): AuditObservationFact => ({ ...at(fightId, 0), kind: "AURA", category: "AUGMENT_RUNE", spellId: 1234969, specId: null });
    const vantus = (fightId: string): AuditObservationFact => ({ ...at(fightId, 0), kind: "AURA", category: "VANTUS_RUNE", spellId: 1303171, specId: null });
    /** Every required check passes; only the runes vary. */
    const compliant = (extra: AuditObservationFact[], fights = [F1]) =>
      evaluatePlayerConsumables(
        withGear(
          [...fights.flatMap((f) => [combatant(f.id, f.startMs), flask(f.id, f.startMs), food(f.id, f.startMs)]), damagePot("f1", 1_000), ...extra],
          fights.flatMap((f) => readyGear(f.id)),
        ),
        fights,
      );
    const baseline = compliant([]);

    it("1 / 4. present is information only (never PASS)", () => {
      const view = compliant([augment("f1"), vantus("f1")]);
      expect(view.augmentRune).toMatchObject({ status: "NEUTRAL", fightsWith: 1, fightsChecked: 1, names: ["Ethereal Augmentation"] });
      expect(view.vantusRune).toMatchObject({ status: "NEUTRAL", fightsWith: 1, fightsChecked: 1 });
    });

    it("2 / 5. absent is information only (never WARNING, no missing-rune failure)", () => {
      expect(baseline.augmentRune).toMatchObject({ status: "NEUTRAL", fightsWith: 0 });
      expect(baseline.vantusRune).toMatchObject({ status: "NEUTRAL", fightsWith: 0 });
    });

    it("3 / 6. no pull snapshot is UNKNOWN, still never a failure", () => {
      const view = evaluatePlayerConsumables(withGear([participant("f1"), damagePot("f1", 1_000)], []), [F1]);
      expect(view.augmentRune.status).toBe("UNKNOWN");
      expect(view.vantusRune.status).toBe("UNKNOWN");
      expect(view.warningCount).toBe(0);
    });

    it("mixed across fights is still information only", () => {
      const view = compliant([augment("f1")], [F1, F2]);
      expect(view.augmentRune).toMatchObject({ status: "NEUTRAL", fightsWith: 1, fightsChecked: 2 });
    });

    it("7 / 8. neither rune changes warningCount or overall compliance", () => {
      for (const view of [compliant([augment("f1")]), compliant([vantus("f1")]), compliant([augment("f1"), vantus("f1")])]) {
        expect(view.warningCount).toBe(baseline.warningCount);
      }
      expect(baseline.warningCount).toBe(0);
      // A player with a real failure keeps exactly that one warning, runes or not.
      const noFlask = (extra: AuditObservationFact[]) =>
        evaluatePlayerConsumables(withGear([combatant("f1"), food("f1"), damagePot("f1", 1_000), ...extra], readyGear("f1")), [F1]);
      expect(noFlask([]).warningCount).toBe(1);
      expect(noFlask([augment("f1"), vantus("f1")]).warningCount).toBe(1);
    });
  });

  it("weapon enhancement is judged per fight; a fight without an oil is named with its weapon slot", () => {
    const gear = [...readyGear("f1"), ...readyGear("f2").map((row) => (row.slot === 15 ? { ...row, temporaryEnchantId: null } : row))];
    const view = evaluatePlayerConsumables(
      withGear([combatant("f1"), flask("f1"), food("f1"), combatant("f2", 700_000), flask("f2"), food("f2")], gear),
      [F1, F2],
    );
    expect(view.weaponEnhancement.status).toBe("WARNING");
    expect(view.weaponEnhancement.missing).toEqual([{ fight: expect.objectContaining({ fightId: "f2" }), slots: ["Main Hand"] }]);
  });

  it("gear readiness uses the latest snapshot and names missing enchants and empty sockets", () => {
    const early = readyGear("f1");
    const late = readyGear("f2").map((row) =>
      row.slot === 11 ? { ...row, permanentEnchantId: null } : row.slot === 1 ? { ...row, gemCount: 1 } : row,
    );
    const view = evaluatePlayerConsumables(withGear([combatant("f1"), combatant("f2", 700_000)], [...early, ...late]), [F1, F2]);
    expect(view.gear.fight?.fightId).toBe("f2");
    expect(view.gear.enchants).toMatchObject({ status: "WARNING", enchanted: 7, required: 8, missing: [{ slotLabel: "Ring 2" }] });
    expect(view.gear.gems).toMatchObject({ status: "WARNING", filled: 1, sockets: 2, empty: [{ slotLabel: "Neck", emptySockets: 1 }] });
  });

  it("no gear in the log: weapon, enchants and gems are UNKNOWN and never add warnings", () => {
    const view = evaluatePlayerConsumables(withGear([combatant("f1"), flask("f1"), food("f1"), damagePot("f1", 1)], []), [F1]);
    expect(view.weaponEnhancement.status).toBe("UNKNOWN");
    expect(view.gear.enchants.status).toBe("UNKNOWN");
    expect(view.gear.gems.status).toBe("UNKNOWN");
    expect(view.warningCount).toBe(0);
  });
});

describe("played role — the role in the log, not the roster (Synlight: roster Healer, played DPS)", () => {
  const F2 = fight({ id: "f2", startMs: 700_000, endMs: 1_300_000 });
  const priest = (rosterRole: CharacterRole | null, observations: AuditObservationFact[]): AuditPlayerFact => ({
    ...player(null, observations),
    rosterRole,
  });

  it("A: roster Healer, played DPS → role DPS, a Mana Potion alone does not satisfy the DPS expectation", () => {
    const view = evaluatePlayerConsumables(priest("HEALER", [withSpec(combatant("f1"), SPEC.SHADOW), manaPot("f1", 1_000)]), [F1]);
    expect(view).toMatchObject({ rosterRole: "HEALER", playedRole: "DPS" });
    expect(view.combatPotion).toMatchObject({ status: "WARNING", accepted: ["DAMAGE_POTION"], killFightsChecked: 1 });
  });

  it("B: roster DPS, played Healer → role Healer, a Mana Potion passes", () => {
    const view = evaluatePlayerConsumables(priest("DPS", [withSpec(combatant("f1"), SPEC.HOLY), manaPot("f1", 1_000)]), [F1]);
    expect(view).toMatchObject({ rosterRole: "DPS", playedRole: "HEALER" });
    expect(view.combatPotion).toMatchObject({ status: "PASS", accepted: ["DAMAGE_POTION", "MANA_POTION"] });
  });

  it("C: roster Healer, no spec in the log → role UNKNOWN, no potion warning, other checks unchanged", () => {
    const view = evaluatePlayerConsumables(priest("HEALER", [combatant("f1"), flask("f1"), food("f1")]), [F1]);
    expect(view.playedRole).toBe("UNKNOWN");
    expect(view.combatPotion).toMatchObject({ status: "UNKNOWN", killFightsChecked: 0, missing: [], accepted: [] });
    expect(view.combatPotion.unknown.map((ref) => ref.fightId)).toEqual(["f1"]);
    expect(view.warningCount).toBe(0);
    expect(view.flask.status).toBe("PASS");
  });

  it("D: Healer in fight 1, DPS in fight 2 → MIXED, each kill judged with its own role", () => {
    const observations = [
      withSpec(combatant("f1"), SPEC.HOLY),
      manaPot("f1", 1_000), // fine for a healer
      withSpec(combatant("f2", 700_000), SPEC.SHADOW),
      manaPot("f2", 701_000), // not a DPS combat potion
    ];
    const view = evaluatePlayerConsumables(priest("HEALER", observations), [F1, F2]);
    expect(view.playedRole).toBe("MIXED");
    expect(view.playedRoleByFight.map((row) => [row.fight.fightId, row.role])).toEqual([["f1", "HEALER"], ["f2", "DPS"]]);
    expect(view.combatPotion.status).toBe("WARNING");
    expect(view.combatPotion.missing.map((ref) => ref.fightId)).toEqual(["f2"]);
    expect(view.combatPotion.acceptedByRole).toEqual({ HEALER: ["DAMAGE_POTION", "MANA_POTION"], DPS: ["DAMAGE_POTION"] });
    // Collapsing MIXED to Healer would have passed both kills.
    const fixed = evaluatePlayerConsumables(priest("HEALER", [...observations, damagePot("f2", 702_000)]), [F1, F2]);
    expect(fixed.combatPotion.status).toBe("PASS");
  });

  it("E: roster and log agree → unchanged, no roster hint needed", () => {
    const view = evaluatePlayerConsumables(player("DPS", [combatant("f1"), damagePot("f1", 1_000)]), [F1]);
    expect(view).toMatchObject({ rosterRole: "DPS", playedRole: "DPS" });
    expect(view.combatPotion.status).toBe("PASS");
  });

  it("F: a player not in the log keeps the log-data-unavailable semantics", () => {
    const view = evaluatePlayerConsumables({ ...priest("HEALER", []), matchStatus: "NOT_IN_LOG" }, [F1]);
    expect(view).toMatchObject({ hasLogData: false, playedRole: "UNKNOWN", rosterRole: "HEALER" });
    expect(view.combatPotion.status).toBe("UNKNOWN");
    expect(view.warningCount).toBe(0);
  });

  it("a kill with a spec and one without: only the known one is judged", () => {
    const view = evaluatePlayerConsumables(
      priest("HEALER", [withSpec(combatant("f1"), SPEC.SHADOW), damagePot("f1", 1_000), combatant("f2", 700_000)]),
      [F1, F2],
    );
    expect(view.playedRole).toBe("DPS");
    expect(view.combatPotion).toMatchObject({ status: "PASS", killFightsChecked: 1 });
    expect(view.combatPotion.unknown.map((ref) => ref.fightId)).toEqual(["f2"]);
  });

  it("an unknown spec id or a spec of another class gives no role (never guessed)", () => {
    const unknownSpec = evaluatePlayerConsumables(priest("HEALER", [withSpec(combatant("f1"), 999_999)]), [F1]);
    expect(unknownSpec.playedRole).toBe("UNKNOWN");
    const otherClass = evaluatePlayerConsumables(priest("HEALER", [withSpec(combatant("f1"), SPEC.PROT_WARRIOR)]), [F1]);
    expect(otherClass.playedRole).toBe("UNKNOWN");
  });

  it("summarizes: agreeing fights → that role; disagreeing → MIXED; no evidence → UNKNOWN", () => {
    expect(summarizePlayedRole(["DPS", null, "DPS"])).toBe("DPS");
    expect(summarizePlayedRole(["TANK", "DPS"])).toBe("MIXED");
    expect(summarizePlayedRole([null, null])).toBe("UNKNOWN");
    expect(summarizePlayedRole([])).toBe("UNKNOWN");
  });
});

describe("Light's Potential from a Potion Cauldron (production: Synlight, Retribution)", () => {
  // WCL abilityGameID of Light's Potential — the cauldron's "Fleeting Light's Potential" casts the same spell.
  const LIGHTS_POTENTIAL = 1236616;
  const RETRIBUTION = 70;
  const HOLY_PALADIN = 65;
  const lightsPotential = (fightId: string, ms: number) =>
    cast(fightId, ms, LIGHTS_POTENTIAL, findConsumableBySpellId(LIGHTS_POTENTIAL)!.category);
  const synlight = (observations: AuditObservationFact[]): AuditPlayerFact => ({
    ...player(null, observations),
    wowClass: "PALADIN",
    rosterRole: "HEALER",
  });

  it("played Retribution + Light's Potential in the kill → DPS, combat potion PASS, shown by name", () => {
    const view = evaluatePlayerConsumables(synlight([withSpec(combatant("f1"), RETRIBUTION), lightsPotential("f1", 1_100)]), [F1]);
    expect(view.playedRole).toBe("DPS");
    expect(view.combatPotion).toMatchObject({ status: "PASS", missing: [], killFightsChecked: 1 });
    expect(view.combatPotion.uses.map((use) => [use.category, use.spellName, use.atFightMs])).toEqual([
      ["DAMAGE_POTION", "Light's Potential", 1_100],
    ]);
  });

  it("a Mana Potion still does not satisfy a Retribution kill", () => {
    const view = evaluatePlayerConsumables(synlight([withSpec(combatant("f1"), RETRIBUTION), manaPot("f1", 81_000)]), [F1]);
    expect(view.combatPotion.status).toBe("WARNING");
    expect(view.combatPotion.missing.map((ref) => ref.fightId)).toEqual(["f1"]);
  });

  it("Holy kill with a Mana Potion + Retribution kill with Light's Potential → both judged per fight, PASS", () => {
    const F2 = fight({ id: "f2", startMs: 700_000, endMs: 1_300_000 });
    const view = evaluatePlayerConsumables(
      synlight([
        withSpec(combatant("f1"), HOLY_PALADIN),
        manaPot("f1", 81_000),
        withSpec(combatant("f2", 700_000), RETRIBUTION),
        lightsPotential("f2", 701_100),
      ]),
      [F1, F2],
    );
    expect(view.playedRole).toBe("MIXED");
    expect(view.combatPotion).toMatchObject({ status: "PASS", missing: [], killFightsChecked: 2 });
  });
});
