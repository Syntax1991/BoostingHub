import type { LootbuddyMode, ParticipationType, WowClass } from "@/models/enums";

/**
 * Class Buff Checker — composition coverage, not live aura / talent verification.
 *
 * A buff is "covered" when the CURRENTLY SELECTED draft roster contains at least
 * one participation whose class can provide it. BOOSTER uses Character class;
 * PLAYING Lootbuddy uses lootbuddyClass (with legacy Character fallback);
 * LOOT_ONLY never contributes.
 */

export const RAID_BUFF_KINDS = ["BUFF", "DEBUFF"] as const;
export type RaidBuffKind = (typeof RAID_BUFF_KINDS)[number];

export const RAID_BUFF_IDS = [
  "ARCANE_INTELLECT",
  "POWER_WORD_FORTITUDE",
  "BATTLE_SHOUT",
  "MARK_OF_THE_WILD",
  "SKYFURY",
  "DEVOTION_AURA",
  "BLESSING_OF_THE_BRONZE",
  "CHAOS_BRAND",
  "MYSTIC_TOUCH",
] as const;
export type RaidBuffId = (typeof RAID_BUFF_IDS)[number];

export type RaidBuffDefinition = {
  id: RaidBuffId;
  name: string;
  kind: RaidBuffKind;
  /** Classes that can provide this tracked raid buff. Currently one each; modeled as an array for future multi-provider buffs. */
  providerClasses: readonly WowClass[];
};

/**
 * Midnight Season 2 raid-composition set. Single authoritative mapping —
 * Views and Discord must not redefine these.
 */
export const RAID_BUFF_DEFINITIONS: readonly RaidBuffDefinition[] = [
  { id: "ARCANE_INTELLECT", name: "Arcane Intellect", kind: "BUFF", providerClasses: ["MAGE"] },
  { id: "POWER_WORD_FORTITUDE", name: "Power Word: Fortitude", kind: "BUFF", providerClasses: ["PRIEST"] },
  { id: "BATTLE_SHOUT", name: "Battle Shout", kind: "BUFF", providerClasses: ["WARRIOR"] },
  { id: "MARK_OF_THE_WILD", name: "Mark of the Wild", kind: "BUFF", providerClasses: ["DRUID"] },
  { id: "SKYFURY", name: "Skyfury", kind: "BUFF", providerClasses: ["SHAMAN"] },
  { id: "DEVOTION_AURA", name: "Devotion Aura", kind: "BUFF", providerClasses: ["PALADIN"] },
  { id: "BLESSING_OF_THE_BRONZE", name: "Blessing of the Bronze", kind: "BUFF", providerClasses: ["EVOKER"] },
  { id: "CHAOS_BRAND", name: "Chaos Brand", kind: "DEBUFF", providerClasses: ["DEMON_HUNTER"] },
  { id: "MYSTIC_TOUCH", name: "Mystic Touch", kind: "DEBUFF", providerClasses: ["MONK"] },
] as const;

export type RaidBuffParticipant = {
  /** Participation identity — never userId. */
  signupId: string;
  userName: string;
  participationType: ParticipationType;
  lootbuddyMode: LootbuddyMode | null;
  /** Resolved WowClass for coverage, or null when unknown (never invents a class). */
  wowClass: WowClass | null;
  characterName: string | null;
};

export type RaidBuffProvider = {
  signupId: string;
  userName: string;
  participationType: ParticipationType;
  lootbuddyMode: LootbuddyMode | null;
  wowClass: WowClass;
  characterName: string | null;
};

export type RaidBuffCoverageItem = {
  id: RaidBuffId;
  name: string;
  kind: RaidBuffKind;
  covered: boolean;
  providerClasses: readonly WowClass[];
  /** Primary display class when covered (first matching provider's class); null when missing. */
  providerClass: WowClass | null;
  providers: RaidBuffProvider[];
};

export type RaidBuffCoverage = {
  coveredCount: number;
  totalCount: number;
  missingCount: number;
  buffs: RaidBuffCoverageItem[];
};

/**
 * Resolves the class a draft-selected participation contributes to buff coverage.
 * Returns null when the row must not count (LOOT_ONLY, unknown class, etc.).
 */
export function resolveBuffContributorClass(participant: {
  participationType: ParticipationType;
  lootbuddyMode: LootbuddyMode | null;
  lootbuddyClass: WowClass | null;
  characterWowClass: WowClass | null;
}): WowClass | null {
  if (participant.participationType === "BOOSTER") {
    return participant.characterWowClass;
  }
  if (participant.participationType === "LOOTBUDDY") {
    if (participant.lootbuddyMode !== "PLAYING") {
      return null;
    }
    return participant.lootbuddyClass ?? participant.characterWowClass;
  }
  return null;
}

/**
 * Pure coverage evaluation over already-selected roster participants.
 * Callers must pass ONLY draft-selected entries — this function does not
 * filter by draftSelected itself.
 */
export function evaluateRaidBuffCoverage(participants: readonly RaidBuffParticipant[]): RaidBuffCoverage {
  const buffs: RaidBuffCoverageItem[] = RAID_BUFF_DEFINITIONS.map((definition) => {
    const providers: RaidBuffProvider[] = [];
    for (const participant of participants) {
      if (!participant.wowClass) continue;
      if (!definition.providerClasses.includes(participant.wowClass)) continue;
      providers.push({
        signupId: participant.signupId,
        userName: participant.userName,
        participationType: participant.participationType,
        lootbuddyMode: participant.lootbuddyMode,
        wowClass: participant.wowClass,
        characterName: participant.characterName,
      });
    }
    const covered = providers.length > 0;
    return {
      id: definition.id,
      name: definition.name,
      kind: definition.kind,
      covered,
      providerClasses: definition.providerClasses,
      providerClass: covered ? providers[0]!.wowClass : null,
      providers,
    };
  });

  const coveredCount = buffs.filter((item) => item.covered).length;
  return {
    coveredCount,
    totalCount: buffs.length,
    missingCount: buffs.length - coveredCount,
    buffs,
  };
}
