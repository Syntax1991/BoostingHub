import type { WowClass, WowRegion } from "@/models/enums";

/** Normalized owned character from Account Profile Summary. */
export type OwnedBlizzardCharacter = {
  id: string;
  name: string;
  realmId: string;
  realmName: string;
  realmSlug: string;
  wowClass: WowClass;
  level: number;
  region: WowRegion;
};

export type BlizzardProfileSummary = {
  id: string;
  name: string;
  realmId: string | null;
  realmSlug: string | null;
  realmName: string | null;
  wowClass: WowClass | null;
  equippedItemLevel: number | null;
  /** Mapped BoostingHub specialization name when active_spec is recognized. */
  activeSpecialization: string | null;
};

export type BlizzardProfileStatus = {
  id: string;
  isValid: boolean;
};

export type ImportCandidateStatus =
  | "import"
  | "link"
  | "already_linked"
  | "conflict"
  | "level_too_low";

export type ImportCandidate = {
  blizzardCharacterId: string;
  name: string;
  realm: string;
  realmSlug: string;
  realmId: string;
  region: WowRegion;
  wowClass: WowClass;
  level: number;
  status: ImportCandidateStatus;
  /** Existing BoostingHub character when status is link or already_linked. */
  characterId: string | null;
  conflictReason: string | null;
  /** Prefill from profile active_spec when enrichment succeeded. */
  suggestedSpecialization: string | null;
  suggestedItemLevel: number | null;
};

export type ImportCharacterSelection = {
  blizzardCharacterId: string;
  /** Required for import and link; validated against the Blizzard class. */
  specialization: string;
};

export type BattleNetConnectionSummary = {
  id: string;
  region: WowRegion;
  battleTag: string | null;
  connectedAt: string;
  lastSuccessfulSyncAt: string | null;
};

/** Normalized Character Raids Encounters payload (no raw Blizzard shapes). */
export type BlizzardRaidEncounterKill = {
  encounterId: string;
  encounterName: string;
  completedCount: number;
  lastKillTimestampMs: number | null;
};

export type BlizzardRaidDifficultyProgress = {
  difficulty: "NORMAL" | "HEROIC" | "MYTHIC";
  progressCompleted: number;
  progressTotal: number;
  encounters: BlizzardRaidEncounterKill[];
};

export type BlizzardRaidInstanceProgress = {
  instanceId: string;
  instanceName: string;
  difficulties: BlizzardRaidDifficultyProgress[];
};

export type BlizzardCharacterRaidEncounters = {
  raids: BlizzardRaidInstanceProgress[];
};
