import {
  CONSUMABLE_CATEGORY_LABELS,
  findConsumableBySpellId,
  isConsumableCategory,
  type ConsumableCategory,
} from "@/lib/consumable-catalog";
import type { CharacterRole, WowClass } from "@/models/enums";
import type {
  ConsumableAuditMatchStatus,
  ConsumableObservationKindValue,
} from "@/services/consumable-audit-extract";

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
  /** Accepted combat potion categories per assigned roster role. */
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
  atMs: number;
};

export type AuditPlayerFact = {
  id: string;
  displayName: string;
  characterName: string | null;
  characterRealm: string | null;
  wowClass: WowClass | null;
  role: CharacterRole | null;
  matchStatus: ConsumableAuditMatchStatus;
  isExternal: boolean;
  observations: AuditObservationFact[];
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

export type DeathView = {
  /** 1-based across the whole Run for this player. */
  number: number;
  fight: FightRef;
  atFightMs: number;
  healingPotion: DeathConsumableContext;
  healthstone: DeathConsumableContext;
  warnings: number;
};

export type PlayerConsumableAudit = {
  id: string;
  displayName: string;
  characterName: string | null;
  characterRealm: string | null;
  wowClass: WowClass | null;
  role: CharacterRole | null;
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
    accepted: ConsumableCategory[];
    uses: ConsumableUseView[];
    killFightsChecked: number;
    missing: FightRef[];
  };
  healingPotion: { status: ConsumableCheckStatus; uses: ConsumableUseView[] };
  healthstone: {
    status: ConsumableCheckStatus;
    applicability: HealthstoneApplicability;
    uses: ConsumableUseView[];
  };
  deaths: DeathView[];
  deathWarnings: number;
  warningCount: number;
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
    role: player.role,
    matchStatus: player.matchStatus,
    isExternal: player.isExternal,
    hasLogData: false,
    fightsParticipated,
    flask: { status: "UNKNOWN", fightsWithFlask: 0, fightsChecked: 0, missing: [], unknown: [], flaskNames: [] },
    combatPotion: {
      status: "UNKNOWN",
      accepted: player.role ? [...CONSUMABLE_AUDIT_POLICY.combatPotionByRole[player.role]] : [],
      uses: [],
      killFightsChecked: 0,
      missing: [],
    },
    healingPotion: { status: "UNKNOWN", uses: [] },
    healthstone: { status: "UNKNOWN", applicability: "UNKNOWN", uses: [] },
    deaths: [],
    deathWarnings: 0,
    warningCount: 0,
  };
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

  // Combat potion: at least one accepted potion per boss KILL the player was in.
  // Wipes are listed but never required — no "use every cooldown" rule.
  const accepted: ConsumableCategory[] = player.role
    ? [...CONSUMABLE_AUDIT_POLICY.combatPotionByRole[player.role]]
    : [];
  const combatUses = viewsOfUses(["DAMAGE_POTION", "MANA_POTION"]);
  const killFights = participated.filter((fight) => fight.kill);
  const combatMissing = killFights
    .filter((fight) => !uses.some((use) => use.fightId === fight.id && accepted.includes(use.category)))
    .map((fight) => refOf(fight.id));
  const combatStatus: ConsumableCheckStatus = !player.role
    ? "UNKNOWN"
    : killFights.length === 0
      ? "NA"
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
    return {
      number: index + 1,
      fight: refOf(death.fightId),
      atFightMs: death.atMs - start,
      healingPotion,
      healthstone,
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
    role: player.role,
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
      uses: combatUses,
      killFightsChecked: killFights.length,
      missing: combatMissing,
    },
    healingPotion: { status: healingStatus, uses: healingUses },
    healthstone: { status: healthstoneStatus, applicability: overallApplicability, uses: healthstoneUses },
    deaths,
    deathWarnings,
    warningCount:
      (flaskStatus === "WARNING" ? 1 : 0) + (combatStatus === "WARNING" ? 1 : 0) + deathWarnings,
  };
}
