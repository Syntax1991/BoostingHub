import { normalizeCharacterIdentity } from "@/lib/character-identity";
import {
  CONSUMABLE_CATEGORY_EVIDENCE,
  classifyPullAura,
  findConsumableBySpellId,
  type ConsumableCategory,
} from "@/lib/consumable-catalog";
import { ENCHANTABLE_ARMOR_SLOTS, WEAPON_SLOTS } from "@/lib/wow-gear-catalog";
import { itemSocketCount } from "@/lib/wow-item-sockets";
import type {
  WarcraftLogsConsumableEvents,
  WarcraftLogsReportFight,
  WarcraftLogsReportMetadata,
} from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import type { CharacterRole, WowClass, WowRegion } from "@/models/enums";

/**
 * Pure WCL → normalized-facts extraction for the Run Consumables Audit.
 * No PASS/WARNING policy lives here (see consumable-audit-policy.ts), so
 * stored facts survive rule changes.
 */

export type ConsumableAuditMatchStatus = "MATCHED" | "NOT_IN_LOG" | "NO_CHARACTER_IDENTITY";
export type ConsumableObservationKindValue = "COMBATANT" | "PARTICIPANT" | "AURA" | "CAST" | "DEATH";

export type ConsumableAuditParticipant =
  | {
      source: "ATTENDANCE";
      attendanceId: string;
      displayName: string;
      characterName: string;
      characterRealm: string;
      characterRegion: WowRegion | null;
      warcraftLogsId: string | null;
      wowClass: WowClass | null;
      role: CharacterRole | null;
    }
  | {
      source: "EXTERNAL";
      externalBoosterId: string;
      displayName: string;
      wowClass: WowClass;
      role: CharacterRole | null;
    };

export type ExtractedFight = {
  reportCode: string;
  wclFightId: number;
  encounterId: number;
  encounterName: string;
  kill: boolean;
  difficulty: number | null;
  startMs: number;
  endMs: number;
  raidContentId: string | null;
  warlockPresent: boolean | null;
  healthstoneUseSeen: boolean;
};

export type ExtractedObservation = {
  reportCode: string;
  wclFightId: number;
  kind: ConsumableObservationKindValue;
  category: ConsumableCategory | null;
  spellId: number | null;
  atMs: number;
};

/** One equipped item at a fight's pull (Gear Readiness + weapon enhancement facts). */
export type ExtractedGearItem = {
  reportCode: string;
  wclFightId: number;
  slot: number;
  itemId: number;
  permanentEnchantId: number | null;
  temporaryEnchantId: number | null;
  gemCount: number;
  /** Null when the game data cannot explain the gems seen (unknown, never "missing"). */
  socketCount: number | null;
};

export type ExtractedPlayer = {
  attendanceId: string | null;
  externalBoosterId: string | null;
  displayName: string;
  characterName: string | null;
  characterRealm: string | null;
  wowClass: WowClass | null;
  role: CharacterRole | null;
  matchStatus: ConsumableAuditMatchStatus;
  wclActorId: number | null;
  sortOrder: number;
  observations: ExtractedObservation[];
  gear: ExtractedGearItem[];
};

export type ExtractedConsumableAudit = {
  fights: ExtractedFight[];
  players: ExtractedPlayer[];
};

/**
 * A catalog cast up to this long before a pull counts for that fight
 * (pre-pull potion). Its fight clock is then negative, e.g. "-00:02".
 */
export const CONSUMABLE_PRE_PULL_WINDOW_MS = 5_000;

/** Realm comparison key: accent-, case-, space- and punctuation-insensitive. */
export function realmKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]/g, "");
}

export function identityKey(name: string, realm: string): string {
  return `${normalizeCharacterIdentity(name)}|${realmKey(realm)}`;
}

/**
 * Resolve a BoostingHub Character to WCL report actor ids.
 *
 * In-game identity is name + realm within a region, so this is not a
 * display-name heuristic: the report's region must match, and both name and
 * realm must match. A stored `warcraftLogsId` found in the report's ranked
 * characters is preferred (it survives renames). External boosters only carry
 * a Discord name, so they are never matched.
 */
export function matchParticipantActors(
  participant: ConsumableAuditParticipant,
  report: Pick<WarcraftLogsReportMetadata, "actors" | "rankedCharacters" | "regionSlug">,
): { matchStatus: ConsumableAuditMatchStatus; actorIds: number[] } {
  if (participant.source === "EXTERNAL") {
    return { matchStatus: "NO_CHARACTER_IDENTITY", actorIds: [] };
  }
  if (!participant.characterName.trim() || !participant.characterRealm.trim()) {
    return { matchStatus: "NO_CHARACTER_IDENTITY", actorIds: [] };
  }
  if (
    report.regionSlug &&
    participant.characterRegion &&
    report.regionSlug.toUpperCase() !== participant.characterRegion
  ) {
    return { matchStatus: "NOT_IN_LOG", actorIds: [] };
  }

  const actorsByKey = new Map<string, number[]>();
  for (const actor of report.actors) {
    if (!actor.server) continue;
    const key = identityKey(actor.name, actor.server);
    actorsByKey.set(key, [...(actorsByKey.get(key) ?? []), actor.id]);
  }

  const wclId = participant.warcraftLogsId?.trim();
  if (wclId) {
    const ranked = report.rankedCharacters.find(
      (character) => character.id === wclId || character.canonicalId === wclId,
    );
    if (ranked?.serverSlug) {
      const actorIds = actorsByKey.get(identityKey(ranked.name, ranked.serverSlug));
      if (actorIds?.length) return { matchStatus: "MATCHED", actorIds };
    }
  }

  // The same name + realm is one in-game character; several WCL actor rows
  // for it (rare) are merged rather than treated as ambiguous.
  const actorIds = actorsByKey.get(identityKey(participant.characterName, participant.characterRealm));
  return actorIds?.length
    ? { matchStatus: "MATCHED", actorIds }
    : { matchStatus: "NOT_IN_LOG", actorIds: [] };
}

type AttributedCast = { fight: number; timestamp: number; sourceId: number; abilityId: number };

/**
 * Attribute casts to audited fights by time: inside [pull, end], or within the
 * pre-pull window before a pull. Casts elsewhere (trash, between pulls) drop.
 */
export function attributeCastsToFights(
  casts: WarcraftLogsConsumableEvents["casts"],
  fights: ReadonlyArray<Pick<WarcraftLogsReportFight, "id" | "startTime" | "endTime">>,
): AttributedCast[] {
  const ordered = [...fights].sort((a, b) => a.startTime - b.startTime);
  const attributed: AttributedCast[] = [];
  for (const cast of casts) {
    const inside = ordered.find((fight) => cast.timestamp >= fight.startTime && cast.timestamp <= fight.endTime);
    const prePull =
      inside ??
      ordered.find(
        (fight) =>
          cast.timestamp < fight.startTime && fight.startTime - cast.timestamp <= CONSUMABLE_PRE_PULL_WINDOW_MS,
      );
    if (prePull) attributed.push({ ...cast, fight: prePull.id });
  }
  return attributed;
}

export function extractConsumableAudit(input: {
  report: WarcraftLogsReportMetadata;
  fights: Array<WarcraftLogsReportFight & { raidContentId: string | null }>;
  events: WarcraftLogsConsumableEvents;
  participants: ConsumableAuditParticipant[];
}): ExtractedConsumableAudit {
  const { report, fights, participants } = input;
  const events = { ...input.events, casts: attributeCastsToFights(input.events.casts, fights) };
  const fightById = new Map(fights.map((fight) => [fight.id, fight]));
  const warlockActorIds = new Set(
    report.actors.filter((actor) => actor.subType?.toLowerCase() === "warlock").map((actor) => actor.id),
  );

  const healthstoneFights = new Set<number>();
  for (const cast of events.casts) {
    if (!fightById.has(cast.fight)) continue;
    if (findConsumableBySpellId(cast.abilityId)?.category === "HEALTHSTONE") healthstoneFights.add(cast.fight);
  }
  const combatantWarlockFights = new Set(
    events.combatants.filter((row) => warlockActorIds.has(row.sourceId)).map((row) => row.fight),
  );

  const extractedFights: ExtractedFight[] = fights.map((fight) => ({
    reportCode: report.code,
    wclFightId: fight.id,
    encounterId: fight.encounterId,
    encounterName: fight.name,
    kill: fight.kill,
    difficulty: fight.difficulty,
    startMs: fight.startTime,
    endMs: fight.endTime,
    raidContentId: fight.raidContentId,
    warlockPresent:
      fight.friendlyPlayers != null
        ? fight.friendlyPlayers.some((id) => warlockActorIds.has(id)) || combatantWarlockFights.has(fight.id)
        : combatantWarlockFights.has(fight.id)
          ? true
          : null,
    healthstoneUseSeen: healthstoneFights.has(fight.id),
  }));

  const players: ExtractedPlayer[] = participants.map((participant, index) => {
    const { matchStatus, actorIds } = matchParticipantActors(participant, report);
    const base = {
      attendanceId: participant.source === "ATTENDANCE" ? participant.attendanceId : null,
      externalBoosterId: participant.source === "EXTERNAL" ? participant.externalBoosterId : null,
      displayName: participant.displayName,
      characterName: participant.source === "ATTENDANCE" ? participant.characterName : null,
      characterRealm: participant.source === "ATTENDANCE" ? participant.characterRealm : null,
      wowClass: participant.wowClass,
      role: participant.role,
      sortOrder: index,
    };
    if (matchStatus !== "MATCHED") {
      return { ...base, matchStatus, wclActorId: null, observations: [], gear: [] };
    }
    const actors = new Set(actorIds);
    return {
      ...base,
      matchStatus,
      wclActorId: actorIds[0] ?? null,
      observations: observationsForActors(actors, fights, events).map((row) => ({
        ...row,
        reportCode: report.code,
      })),
      gear: gearForActors(actors, fights, events.combatants).map((row) => ({ ...row, reportCode: report.code })),
    };
  });

  return { fights: extractedFights, players };
}

function observationsForActors(
  actorIds: Set<number>,
  fights: Array<WarcraftLogsReportFight & { raidContentId: string | null }>,
  events: Omit<WarcraftLogsConsumableEvents, "casts"> & { casts: AttributedCast[] },
): Array<Omit<ExtractedObservation, "reportCode">> {
  const fightById = new Map(fights.map((fight) => [fight.id, fight]));
  const observations: Array<Omit<ExtractedObservation, "reportCode">> = [];
  const snapshotFights = new Set<number>();
  const activeFights = new Set<number>();

  for (const snapshot of events.combatants) {
    if (!actorIds.has(snapshot.sourceId) || !fightById.has(snapshot.fight)) continue;
    if (snapshotFights.has(snapshot.fight)) continue;
    snapshotFights.add(snapshot.fight);
    observations.push({
      wclFightId: snapshot.fight,
      kind: "COMBATANT",
      category: null,
      spellId: null,
      atMs: snapshot.timestamp,
    });
    for (const auraId of new Set(snapshot.auraIds)) {
      const category = classifyPullAura({ id: auraId, name: snapshot.auraNames?.[auraId] ?? null });
      if (!category) continue;
      observations.push({
        wclFightId: snapshot.fight,
        kind: "AURA",
        category,
        spellId: auraId,
        atMs: snapshot.timestamp,
      });
    }
  }

  for (const cast of events.casts) {
    if (!actorIds.has(cast.sourceId) || !fightById.has(cast.fight)) continue;
    const entry = findConsumableBySpellId(cast.abilityId);
    if (!entry || CONSUMABLE_CATEGORY_EVIDENCE[entry.category] !== "CAST") continue;
    activeFights.add(cast.fight);
    observations.push({
      wclFightId: cast.fight,
      kind: "CAST",
      category: entry.category,
      spellId: entry.spellId,
      atMs: cast.timestamp,
    });
  }

  for (const death of events.deaths) {
    if (!actorIds.has(death.targetId) || !fightById.has(death.fight)) continue;
    activeFights.add(death.fight);
    observations.push({
      wclFightId: death.fight,
      kind: "DEATH",
      category: null,
      spellId: null,
      atMs: death.timestamp,
    });
  }

  // Participation without a pull snapshot: listed as a fight participant, or
  // had events in the fight. Auras at pull are unknown there.
  for (const fight of fights) {
    if (snapshotFights.has(fight.id)) continue;
    const listed = fight.friendlyPlayers?.some((id) => actorIds.has(id)) ?? false;
    if (!listed && !activeFights.has(fight.id)) continue;
    observations.push({
      wclFightId: fight.id,
      kind: "PARTICIPANT",
      category: null,
      spellId: null,
      atMs: fight.startTime,
    });
  }

  return observations.sort((a, b) => a.atMs - b.atMs);
}

/** Slots stored as gear facts: everything that can need an enchant, plus socketed items. */
const GEAR_FACT_SLOTS = new Set<number>([...ENCHANTABLE_ARMOR_SLOTS, ...WEAPON_SLOTS]);

/** The player's equipped gear at each audited fight's pull (first snapshot per fight). */
function gearForActors(
  actorIds: Set<number>,
  fights: ReadonlyArray<Pick<WarcraftLogsReportFight, "id">>,
  combatants: WarcraftLogsConsumableEvents["combatants"],
): Array<Omit<ExtractedGearItem, "reportCode">> {
  const audited = new Set(fights.map((fight) => fight.id));
  const seen = new Set<number>();
  const rows: Array<Omit<ExtractedGearItem, "reportCode">> = [];
  for (const snapshot of combatants) {
    if (!actorIds.has(snapshot.sourceId) || !audited.has(snapshot.fight) || seen.has(snapshot.fight)) continue;
    seen.add(snapshot.fight);
    for (const item of snapshot.gear ?? []) {
      const gemCount = item.gemIds.length;
      const socketCount = itemSocketCount({ itemId: item.itemId, bonusIds: item.bonusIds, gemCount });
      if (!GEAR_FACT_SLOTS.has(item.slot) && socketCount === 0) continue;
      rows.push({
        wclFightId: snapshot.fight,
        slot: item.slot,
        itemId: item.itemId,
        permanentEnchantId: item.permanentEnchantId,
        temporaryEnchantId: item.temporaryEnchantId,
        gemCount,
        socketCount,
      });
    }
  }
  return rows;
}

/**
 * Combine per-report extractions for one Run (same participant list, in the
 * same order). A player is MATCHED if any report matched them.
 */
export function mergeExtractedAudits(parts: ExtractedConsumableAudit[]): ExtractedConsumableAudit {
  if (parts.length === 0) return { fights: [], players: [] };
  const [first, ...rest] = parts;
  return {
    fights: parts.flatMap((part) => part.fights),
    players: first!.players.map((player, index) => {
      const all = [player, ...rest.map((part) => part.players[index]!)];
      const matched = all.find((row) => row.matchStatus === "MATCHED");
      return {
        ...player,
        matchStatus: matched ? "MATCHED" : player.matchStatus,
        wclActorId: matched?.wclActorId ?? null,
        observations: all.flatMap((row) => row.observations),
        gear: all.flatMap((row) => row.gear),
      };
    }),
  };
}
