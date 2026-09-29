import {
  CONSUMABLE_CATEGORY_LABELS,
  findConsumableBySpellId,
  isConsumableCategory,
  type ConsumableCategory,
} from "@/lib/consumable-catalog";
import {
  PERSONAL_DEFENSIVE_CATEGORY,
  findPersonalDefensive,
  type PersonalDefensiveKind,
} from "@/lib/personal-defensive-catalog";
import { specializationById } from "@/lib/wow-specializations";
import type { CharacterRole, WowClass } from "@/models/enums";
import type {
  ConsumableAuditMatchStatus,
  ConsumableObservationKindValue,
} from "@/services/consumable-audit-extract";
import {
  evaluateEnchants,
  evaluateGems,
  expectedWeaponEnhancement,
  resolveWeaponEnhancementRequirement,
  type EnchantCheck,
  type GearItemFact,
  type GemCheck,
  type WeaponEnhancementExpectation,
  type WeaponEnhancementResult,
} from "@/services/gear-readiness-policy";

/**
 * Read-time rules for the Run Consumables Audit. Facts are stored; statuses
 * are derived here, so changing a rule never needs a new Warcraft Logs fetch.
 * Facts only — there is deliberately no score or overall rating.
 */
export const CONSUMABLE_AUDIT_POLICY = {
  /**
   * A Healing Potion / Healthstone counts for a death only when used within
   * this many seconds before it, in the same fight, and after that player's
   * previous death in the fight. An early-fight use never covers a later death.
   */
  deathLookbackSeconds: 30,
  /** Accepted combat potion categories per role PLAYED in that fight (from the log, not the roster). */
  combatPotionByRole: {
    TANK: ["DAMAGE_POTION"],
    DPS: ["DAMAGE_POTION"],
    HEALER: ["DAMAGE_POTION", "MANA_POTION"],
  } satisfies Record<CharacterRole, readonly ConsumableCategory[]>,
} as const;

export const DEATH_CONSUMABLE_LOOKBACK_SECONDS = CONSUMABLE_AUDIT_POLICY.deathLookbackSeconds;

/**
 * PASS: requirement met. WARNING: actionable fact. NEUTRAL: shown, never a
 * failure (e.g. no Healing Potion without dying). NA: check does not apply.
 * UNKNOWN: log data missing — never treated as a failure.
 */
export type ConsumableCheckStatus = "PASS" | "WARNING" | "NEUTRAL" | "NA" | "UNKNOWN";

export type AuditFightFact = {
  id: string;
  reportCode: string;
  wclFightId: number;
  encounterName: string;
  kill: boolean;
  startMs: number;
  endMs: number;
  raidContentId: string | null;
  warlockPresent: boolean | null;
  healthstoneUseSeen: boolean;
};

export type AuditObservationFact = {
  fightId: string;
  kind: ConsumableObservationKindValue;
  category: string | null;
  spellId: number | null;
  /** COMBATANT only: specialization played in that fight; null when the log had none (or an older snapshot). */
  specId: number | null;
  atMs: number;
};

/**
 * Role PLAYED in the analyzed fights, from the log's specialization per fight.
 * MIXED: the fights disagree. UNKNOWN: no fight carried a usable specialization.
 */
export type PlayedRole = CharacterRole | "MIXED" | "UNKNOWN";

export type AuditPlayerFact = {
  id: string;
  displayName: string;
  characterName: string | null;
  characterRealm: string | null;
  wowClass: WowClass | null;
  /** Planned/published roster role — reference only, never used as the played role. */
  rosterRole: CharacterRole | null;
  matchStatus: ConsumableAuditMatchStatus;
  isExternal: boolean;
  observations: AuditObservationFact[];
  /** Equipped gear per audited fight (Gear Readiness + weapon enhancement facts). */
  gear: GearItemFact[];
};

export type FightRef = {
  fightId: string;
  wclFightId: number;
  encounterName: string;
  /** e.g. "Ula'tek · Pull 3 (wipe)". */
  label: string;
  kill: boolean;
  raidContentId: string | null;
};

export type ConsumableUseView = {
  fight: FightRef;
  category: ConsumableCategory;
  spellName: string;
  /** Milliseconds since the fight's pull. */
  atFightMs: number;
};

export type HealthstoneApplicability = "APPLICABLE" | "NOT_APPLICABLE" | "UNKNOWN";

export type DeathConsumableContext =
  | { status: "USED"; atFightMs: number; spellName: string }
  | { status: "NOT_USED" }
  | { status: "NOT_APPLICABLE" }
  | { status: "UNKNOWN" };

/** A personal defensive the player cast themselves before a death (fact, never a judgment). */
export type DefensiveUseView = {
  spellId: number;
  spellName: string;
  kind: PersonalDefensiveKind;
  /** Milliseconds since the fight's pull. */
  atFightMs: number;
  msBeforeDeath: number;
};

/**
 * USED: a tracked personal defensive was cast in the window. NOT_DETECTED:
 * none was — information only: the log cannot tell whether one was available.
 * UNKNOWN: the snapshot did not record defensive casts (re-analyze).
 */
export type DefensiveStatus = "USED" | "NOT_DETECTED" | "UNKNOWN";

export type DeathView = {
  /** 1-based across the whole Run for this player. */
  number: number;
  fight: FightRef;
  /** The pull ended in a kill or not (Warcraft Logs `kill`); nothing about when a wipe was called. */
  fightResult: "KILL" | "WIPE";
  atFightMs: number;
  healingPotion: DeathConsumableContext;
  healthstone: DeathConsumableContext;
  /** Own defensive casts in the same window as the recovery checks, oldest first. */
  personalDefensives: DefensiveUseView[];
  defensiveStatus: DefensiveStatus;
  /** Healing Potion / Healthstone only — a defensive is never a warning. */
  warnings: number;
};

export type PlayerConsumableAudit = {
  id: string;
  displayName: string;
  characterName: string | null;
  characterRealm: string | null;
  wowClass: WowClass | null;
  /** Planned/published roster role (reference only). */
  rosterRole: CharacterRole | null;
  /** Role played in the analyzed fights (see PlayedRole). */
  playedRole: PlayedRole;
  /** Played role per participated fight; null = no usable specialization in that fight. */
  playedRoleByFight: Array<{ fight: FightRef; role: CharacterRole | null }>;
  matchStatus: ConsumableAuditMatchStatus;
  isExternal: boolean;
  /** False when unmatched or in no audited fight — every check is UNKNOWN. */
  hasLogData: boolean;
  fightsParticipated: number;
  flask: {
    status: ConsumableCheckStatus;
    fightsWithFlask: number;
    fightsChecked: number;
    missing: FightRef[];
    unknown: FightRef[];
    flaskNames: string[];
  };
  combatPotion: {
    status: ConsumableCheckStatus;
    /** Accepted categories for the role(s) played in the judged kills. */
    accepted: ConsumableCategory[];
    /** Accepted categories per role played (several entries when MIXED). */
    acceptedByRole: Partial<Record<CharacterRole, ConsumableCategory[]>>;
    uses: ConsumableUseView[];
    /** Boss kills judged — each with the role played in that fight. */
    killFightsChecked: number;
    missing: FightRef[];
    /** Boss kills without a usable played role — not judged. */
    unknown: FightRef[];
  };
  /** Food buff at pull, per fight with a CombatantInfo snapshot (like the flask). */
  food: AuraAtPullCheck;
  /**
   * Augment / Vantus Rune at pull — optional, information only. Status is
   * NEUTRAL whenever the log shows it (present or absent, see `fightsWith`) and
   * UNKNOWN without snapshots; never PASS / WARNING, never in `warningCount`.
   */
  augmentRune: AuraAtPullCheck;
  vantusRune: AuraAtPullCheck;
  /** Oil / stone, the class's own imbue, or a Death Knight Runeforge on every weapon, per fight. */
  weaponEnhancement: {
    status: ConsumableCheckStatus;
    /** RUNEFORGE for a Death Knight (an oil is optional), else TEMPORARY (oil / stone / class imbue). */
    expected: WeaponEnhancementExpectation;
    fightsChecked: number;
    missing: Array<{ fight: FightRef; slots: string[] }>;
    /** What satisfied it, e.g. ["Oil"], ["Shaman imbue"], ["Runeforge"]. */
    labels: string[];
    results: WeaponEnhancementResult[];
    /** Off-hand not judged: not a weapon, or unknown whether it is one. */
    notChecked: string[];
  };
  healingPotion: { status: ConsumableCheckStatus; uses: ConsumableUseView[] };
  healthstone: {
    status: ConsumableCheckStatus;
    applicability: HealthstoneApplicability;
    uses: ConsumableUseView[];
  };
  deaths: DeathView[];
  /** Counts only — a wipe death is neither automatically a mistake nor irrelevant. */
  deathsInWipes: number;
  deathsInKills: number;
  deathWarnings: number;
  /** Gear Readiness from the player's latest audited snapshot. */
  gear: {
    fight: FightRef | null;
    enchants: EnchantCheck;
    gems: GemCheck;
  };
  warningCount: number;
};

export type AuraAtPullCheck = {
  status: ConsumableCheckStatus;
  fightsWith: number;
  fightsChecked: number;
  missing: FightRef[];
  unknown: FightRef[];
  names: string[];
};

export function healthstoneApplicability(fight: AuditFightFact): HealthstoneApplicability {
  if (fight.healthstoneUseSeen || fight.warlockPresent === true) return "APPLICABLE";
  if (fight.warlockPresent === false) return "NOT_APPLICABLE";
  return "UNKNOWN";
}

export function buildFightRefs(fights: AuditFightFact[]): Map<string, FightRef> {
  const ordered = [...fights].sort((a, b) => a.startMs - b.startMs);
  const pullsPerEncounter = new Map<string, number>();
  for (const fight of ordered) {
    pullsPerEncounter.set(fight.encounterName, (pullsPerEncounter.get(fight.encounterName) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const refs = new Map<string, FightRef>();
  for (const fight of ordered) {
    const pull = (seen.get(fight.encounterName) ?? 0) + 1;
    seen.set(fight.encounterName, pull);
    const multiple = (pullsPerEncounter.get(fight.encounterName) ?? 1) > 1;
    const label = `${fight.encounterName}${multiple ? ` · Pull ${pull}` : ""}${fight.kill ? "" : " (wipe)"}`;
    refs.set(fight.id, {
      fightId: fight.id,
      wclFightId: fight.wclFightId,
      encounterName: fight.encounterName,
      label,
      kill: fight.kill,
      raidContentId: fight.raidContentId,
    });
  }
  return refs;
}

function spellLabel(spellId: number | null, category: ConsumableCategory): string {
  return (spellId != null ? findConsumableBySpellId(spellId)?.name : null) ?? CONSUMABLE_CATEGORY_LABELS[category];
}

function unknownPlayer(player: AuditPlayerFact, fightsParticipated = 0): PlayerConsumableAudit {
  return {
    id: player.id,
    displayName: player.displayName,
    characterName: player.characterName,
    characterRealm: player.characterRealm,
    wowClass: player.wowClass,
    rosterRole: player.rosterRole,
    playedRole: "UNKNOWN",
    playedRoleByFight: [],
    matchStatus: player.matchStatus,
    isExternal: player.isExternal,
    hasLogData: false,
    fightsParticipated,
    flask: { status: "UNKNOWN", fightsWithFlask: 0, fightsChecked: 0, missing: [], unknown: [], flaskNames: [] },
    combatPotion: {
      status: "UNKNOWN",
      accepted: [],
      acceptedByRole: {},
      uses: [],
      killFightsChecked: 0,
      missing: [],
      unknown: [],
    },
    food: emptyAuraCheck(),
    augmentRune: emptyAuraCheck(),
    vantusRune: emptyAuraCheck(),
    weaponEnhancement: {
      status: "UNKNOWN",
      expected: expectedWeaponEnhancement(player.wowClass),
      fightsChecked: 0,
      missing: [],
      labels: [],
      results: [],
      notChecked: [],
    },
    healingPotion: { status: "UNKNOWN", uses: [] },
    healthstone: { status: "UNKNOWN", applicability: "UNKNOWN", uses: [] },
    deaths: [],
    deathsInWipes: 0,
    deathsInKills: 0,
    deathWarnings: 0,
    gear: {
      fight: null,
      enchants: evaluateEnchants({ wowClass: player.wowClass, gear: null }),
      gems: evaluateGems({ gear: null }),
    },
    warningCount: 0,
  };
}

function emptyAuraCheck(): AuraAtPullCheck {
  return { status: "UNKNOWN", fightsWith: 0, fightsChecked: 0, missing: [], unknown: [], names: [] };
}

function latestUseBefore(
  uses: Array<{ category: ConsumableCategory; spellId: number | null; atMs: number; fightId: string }>,
  categories: readonly ConsumableCategory[],
  fightId: string,
  windowStartMs: number,
  deathMs: number,
): { atMs: number; category: ConsumableCategory; spellId: number | null } | null {
  let latest: { atMs: number; category: ConsumableCategory; spellId: number | null } | null = null;
  for (const use of uses) {
    if (use.fightId !== fightId || !categories.includes(use.category)) continue;
    if (use.atMs < windowStartMs || use.atMs > deathMs) continue;
    if (!latest || use.atMs > latest.atMs) latest = use;
  }
  return latest;
}

export function evaluatePlayerConsumables(
  player: AuditPlayerFact,
  fights: AuditFightFact[],
  fightRefs: Map<string, FightRef> = buildFightRefs(fights),
  policy: { deathLookbackSeconds: number } = CONSUMABLE_AUDIT_POLICY,
  /** False for a snapshot taken before defensive casts were recorded: defensives are UNKNOWN, never "not detected". */
  facts: { defensivesRecorded: boolean } = { defensivesRecorded: true },
): PlayerConsumableAudit {
  if (player.matchStatus !== "MATCHED") {
    return unknownPlayer(player);
  }
  const fightById = new Map(fights.map((fight) => [fight.id, fight]));
  const obs = player.observations.filter((row) => fightById.has(row.fightId));
  const snapshotFights = new Set(obs.filter((row) => row.kind === "COMBATANT").map((row) => row.fightId));
  const participantFights = new Set(
    obs.filter((row) => row.kind === "COMBATANT" || row.kind === "PARTICIPANT").map((row) => row.fightId),
  );
  if (participantFights.size === 0) {
    return unknownPlayer(player);
  }
  const participated = [...participantFights]
    .map((id) => fightById.get(id)!)
    .sort((a, b) => a.startMs - b.startMs);
  const refOf = (fightId: string) => fightRefs.get(fightId)!;
  const fightStart = (fightId: string) => fightById.get(fightId)!.startMs;

  const uses = obs
    .filter((row) => row.kind === "CAST" && isConsumableCategory(row.category))
    .map((row) => ({
      fightId: row.fightId,
      category: row.category as ConsumableCategory,
      spellId: row.spellId,
      atMs: row.atMs,
    }))
    .sort((a, b) => a.atMs - b.atMs);
  const viewsOfUses = (categories: readonly ConsumableCategory[]): ConsumableUseView[] =>
    uses
      .filter((use) => categories.includes(use.category))
      .map((use) => ({
        fight: refOf(use.fightId),
        category: use.category,
        spellName: spellLabel(use.spellId, use.category),
        atFightMs: use.atMs - fightStart(use.fightId),
      }));

  // Flask: aura at pull, per fight with a CombatantInfo snapshot.
  const flaskAuras = obs.filter((row) => row.kind === "AURA" && row.category === "FLASK");
  const flaskFights = new Set(flaskAuras.map((row) => row.fightId));
  const flaskMissing: FightRef[] = [];
  const flaskUnknown: FightRef[] = [];
  for (const fight of participated) {
    if (!snapshotFights.has(fight.id)) flaskUnknown.push(refOf(fight.id));
    else if (!flaskFights.has(fight.id)) flaskMissing.push(refOf(fight.id));
  }
  const flaskChecked = participated.length - flaskUnknown.length;
  const flaskStatus: ConsumableCheckStatus =
    flaskChecked === 0 ? "UNKNOWN" : flaskMissing.length > 0 ? "WARNING" : "PASS";
  const flaskNames = [
    ...new Set(flaskAuras.map((row) => spellLabel(row.spellId, "FLASK"))),
  ];

  // Food / Augment Rune / Vantus Rune: auras at pull, per fight with a snapshot.
  // Required (food): PASS / WARNING. Optional (runes): NEUTRAL whether present or
  // absent — kept out of compliance entirely.
  const auraAtPull = (category: ConsumableCategory, informational: boolean): AuraAtPullCheck => {
    const rows = obs.filter((row) => row.kind === "AURA" && row.category === category);
    const withAura = new Set(rows.map((row) => row.fightId));
    const missing: FightRef[] = [];
    const unknown: FightRef[] = [];
    for (const fight of participated) {
      if (!snapshotFights.has(fight.id)) unknown.push(refOf(fight.id));
      else if (!withAura.has(fight.id)) missing.push(refOf(fight.id));
    }
    const checked = participated.length - unknown.length;
    const status: ConsumableCheckStatus =
      checked === 0 ? "UNKNOWN" : informational ? "NEUTRAL" : missing.length === 0 ? "PASS" : "WARNING";
    return {
      status,
      fightsWith: checked - missing.length,
      fightsChecked: checked,
      missing,
      unknown,
      names: [...new Set(rows.map((row) => spellLabel(row.spellId, category)))],
    };
  };
  const food = auraAtPull("FOOD", false);
  const augmentRune = auraAtPull("AUGMENT_RUNE", true);
  const vantusRune = auraAtPull("VANTUS_RUNE", true);

  // Weapon enhancement, per fight whose snapshot carried gear.
  const gearByFight = new Map<string, GearItemFact[]>();
  for (const item of player.gear) {
    if (!fightById.has(item.fightId)) continue;
    const list = gearByFight.get(item.fightId) ?? [];
    list.push(item);
    gearByFight.set(item.fightId, list);
  }
  const weaponMissing: Array<{ fight: FightRef; slots: string[] }> = [];
  const weaponLabels = new Set<string>();
  const weaponResults = new Set<WeaponEnhancementResult>();
  const notChecked = new Set<string>();
  let weaponFightsChecked = 0;
  for (const fight of participated) {
    const gear = gearByFight.get(fight.id);
    if (!gear) continue;
    const requirement = resolveWeaponEnhancementRequirement({ wowClass: player.wowClass, gear });
    if (requirement.status === "NA") continue;
    weaponFightsChecked += 1;
    for (const weapon of requirement.weapons) {
      weaponResults.add(weapon.result);
      if (weapon.result !== "MISSING") weaponLabels.add(weapon.label);
    }
    for (const row of requirement.skipped) notChecked.add(row.slotLabel);
    const missingSlots = requirement.weapons.filter((row) => row.result === "MISSING").map((row) => row.slotLabel);
    if (missingSlots.length > 0) weaponMissing.push({ fight: refOf(fight.id), slots: missingSlots });
  }
  const weaponStatus: ConsumableCheckStatus =
    weaponFightsChecked === 0
      ? gearByFight.size > 0
        ? "NA"
        : "UNKNOWN"
      : weaponMissing.length > 0
        ? "WARNING"
        : "PASS";

  // Gear Readiness: enchants and gems of the latest audited snapshot with gear.
  const latestGearFight = [...participated].reverse().find((fight) => gearByFight.has(fight.id)) ?? null;
  const latestGear = latestGearFight ? gearByFight.get(latestGearFight.id)! : null;
  const enchants = evaluateEnchants({ wowClass: player.wowClass, gear: latestGear });
  const gems = evaluateGems({ gear: latestGear });

  // Played role per fight, from the specialization in that fight's snapshot.
  const roleByFight = playedRolesByFight(player, obs);
  const playedRoleByFight = participated.map((fight) => ({
    fight: refOf(fight.id),
    role: roleByFight.get(fight.id) ?? null,
  }));
  const playedRole = summarizePlayedRole(playedRoleByFight.map((row) => row.role));

  // Combat potion: at least one accepted potion per boss KILL the player was in,
  // judged with the role PLAYED in that kill. A kill without a usable played
  // role is not judged (UNKNOWN), never a warning. Wipes are listed but never
  // required — no "use every cooldown" rule.
  const acceptedFor = (role: CharacterRole): readonly ConsumableCategory[] =>
    CONSUMABLE_AUDIT_POLICY.combatPotionByRole[role];
  const combatUses = viewsOfUses(["DAMAGE_POTION", "MANA_POTION"]);
  const killFights = participated.filter((fight) => fight.kill);
  const judgedKills = killFights.flatMap((fight) => {
    const role = roleByFight.get(fight.id);
    return role ? [{ fight, role }] : [];
  });
  const combatUnknown = killFights.filter((fight) => !roleByFight.has(fight.id)).map((fight) => refOf(fight.id));
  const combatMissing = judgedKills
    .filter(({ fight, role }) => !uses.some((use) => use.fightId === fight.id && acceptedFor(role).includes(use.category)))
    .map(({ fight }) => refOf(fight.id));
  const accepted = [
    ...new Set(
      (judgedKills.length > 0 ? judgedKills.map((row) => row.role) : [...roleByFight.values()]).flatMap(acceptedFor),
    ),
  ];
  const combatStatus: ConsumableCheckStatus =
    killFights.length === 0
      ? "NA"
      : judgedKills.length === 0
        ? "UNKNOWN"
        : combatMissing.length > 0
          ? "WARNING"
          : "PASS";

  // General Healing Potion / Healthstone usage — never a failure on its own.
  const healingUses = viewsOfUses(["HEALING_POTION"]);
  const healthstoneUses = viewsOfUses(["HEALTHSTONE"]);
  const applicabilities = participated.map(healthstoneApplicability);
  const overallApplicability: HealthstoneApplicability = applicabilities.includes("APPLICABLE")
    ? "APPLICABLE"
    : applicabilities.includes("UNKNOWN")
      ? "UNKNOWN"
      : "NOT_APPLICABLE";

  // Deaths — each evaluated independently against its own lookback window.
  const lookbackMs = policy.deathLookbackSeconds * 1000;
  const deathRows = obs.filter((row) => row.kind === "DEATH").sort((a, b) => a.atMs - b.atMs);
  const previousDeathInFight = new Map<string, number>();
  const deaths: DeathView[] = deathRows.map((death, index) => {
    const windowStart = Math.max(death.atMs - lookbackMs, previousDeathInFight.get(death.fightId) ?? -Infinity);
    previousDeathInFight.set(death.fightId, death.atMs);
    const start = fightStart(death.fightId);
    const healing = latestUseBefore(uses, ["HEALING_POTION"], death.fightId, windowStart, death.atMs);
    const stone = latestUseBefore(uses, ["HEALTHSTONE"], death.fightId, windowStart, death.atMs);
    const applicability = healthstoneApplicability(fightById.get(death.fightId)!);
    const healingPotion: DeathConsumableContext = healing
      ? { status: "USED", atFightMs: healing.atMs - start, spellName: spellLabel(healing.spellId, healing.category) }
      : { status: "NOT_USED" };
    const healthstone: DeathConsumableContext = stone
      ? { status: "USED", atFightMs: stone.atMs - start, spellName: spellLabel(stone.spellId, stone.category) }
      : applicability === "APPLICABLE"
        ? { status: "NOT_USED" }
        : applicability === "NOT_APPLICABLE"
          ? { status: "NOT_APPLICABLE" }
          : { status: "UNKNOWN" };
    const warnings = (healingPotion.status === "NOT_USED" ? 1 : 0) + (healthstone.status === "NOT_USED" ? 1 : 0);
    // Same window as the recovery checks: this fight, up to the death, after the previous death.
    const personalDefensives: DefensiveUseView[] = facts.defensivesRecorded
      ? obs
          .filter(
            (row) =>
              row.kind === "CAST" &&
              row.category === PERSONAL_DEFENSIVE_CATEGORY &&
              row.fightId === death.fightId &&
              row.spellId != null &&
              row.atMs >= windowStart &&
              row.atMs <= death.atMs,
          )
          .flatMap((row) => {
            const entry = findPersonalDefensive(row.spellId!);
            return entry
              ? [{ spellId: entry.spellId, spellName: entry.name, kind: entry.kind, atFightMs: row.atMs - start, msBeforeDeath: death.atMs - row.atMs }]
              : [];
          })
          .sort((a, b) => a.atFightMs - b.atFightMs)
      : [];
    return {
      number: index + 1,
      fight: refOf(death.fightId),
      fightResult: fightById.get(death.fightId)!.kill ? "KILL" : "WIPE",
      atFightMs: death.atMs - start,
      healingPotion,
      healthstone,
      personalDefensives,
      defensiveStatus: !facts.defensivesRecorded ? "UNKNOWN" : personalDefensives.length > 0 ? "USED" : "NOT_DETECTED",
      warnings,
    };
  });
  const deathWarnings = deaths.reduce((sum, death) => sum + death.warnings, 0);
  const deathsWithoutHealing = deaths.some((death) => death.healingPotion.status === "NOT_USED");
  const deathsWithoutStone = deaths.some((death) => death.healthstone.status === "NOT_USED");

  const healingStatus: ConsumableCheckStatus = deathsWithoutHealing
    ? "WARNING"
    : healingUses.length > 0
      ? "PASS"
      : "NEUTRAL";
  const healthstoneStatus: ConsumableCheckStatus = deathsWithoutStone
    ? "WARNING"
    : healthstoneUses.length > 0
      ? "PASS"
      : overallApplicability === "NOT_APPLICABLE"
        ? "NA"
        : overallApplicability === "UNKNOWN"
          ? "UNKNOWN"
          : "NEUTRAL";

  return {
    id: player.id,
    displayName: player.displayName,
    characterName: player.characterName,
    characterRealm: player.characterRealm,
    wowClass: player.wowClass,
    rosterRole: player.rosterRole,
    playedRole,
    playedRoleByFight,
    matchStatus: player.matchStatus,
    isExternal: player.isExternal,
    hasLogData: true,
    fightsParticipated: participated.length,
    flask: {
      status: flaskStatus,
      fightsWithFlask: flaskChecked - flaskMissing.length,
      fightsChecked: flaskChecked,
      missing: flaskMissing,
      unknown: flaskUnknown,
      flaskNames,
    },
    combatPotion: {
      status: combatStatus,
      accepted,
      acceptedByRole: Object.fromEntries(
        [...new Set(roleByFight.values())].map((role) => [role, [...acceptedFor(role)]]),
      ),
      uses: combatUses,
      killFightsChecked: judgedKills.length,
      missing: combatMissing,
      unknown: combatUnknown,
    },
    food,
    augmentRune,
    vantusRune,
    weaponEnhancement: {
      status: weaponStatus,
      expected: expectedWeaponEnhancement(player.wowClass),
      fightsChecked: weaponFightsChecked,
      missing: weaponMissing,
      labels: [...weaponLabels],
      results: [...weaponResults],
      notChecked: [...notChecked],
    },
    healingPotion: { status: healingStatus, uses: healingUses },
    healthstone: { status: healthstoneStatus, applicability: overallApplicability, uses: healthstoneUses },
    deaths,
    deathsInWipes: deaths.filter((death) => death.fightResult === "WIPE").length,
    deathsInKills: deaths.filter((death) => death.fightResult === "KILL").length,
    deathWarnings,
    gear: { fight: latestGearFight ? refOf(latestGearFight.id) : null, enchants, gems },
    warningCount:
      [flaskStatus, food.status, weaponStatus, combatStatus, enchants.status, gems.status].filter(
        (status) => status === "WARNING",
      ).length + deathWarnings,
  };
}

/**
 * Role played per fight: the specialization in that fight's CombatantInfo
 * snapshot, mapped through the specialization catalog. A spec of another class
 * than the player's (never expected) or an unknown spec id gives no role.
 */
export function playedRolesByFight(
  player: Pick<AuditPlayerFact, "wowClass">,
  observations: AuditObservationFact[],
): Map<string, CharacterRole> {
  const roles = new Map<string, CharacterRole>();
  for (const row of observations) {
    if (row.kind !== "COMBATANT" || row.specId == null || roles.has(row.fightId)) continue;
    const spec = specializationById(row.specId);
    if (!spec || (player.wowClass && spec.wowClass !== player.wowClass)) continue;
    roles.set(row.fightId, spec.role);
  }
  return roles;
}

/** One role when every fight with evidence agrees; MIXED when they differ; UNKNOWN without evidence. */
export function summarizePlayedRole(roles: ReadonlyArray<CharacterRole | null>): PlayedRole {
  const seen = new Set(roles.filter((role): role is CharacterRole => role != null));
  if (seen.size === 0) return "UNKNOWN";
  return seen.size === 1 ? [...seen][0]! : "MIXED";
}
