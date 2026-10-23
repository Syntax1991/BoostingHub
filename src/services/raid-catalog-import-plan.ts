import type { CatalogBoss, CatalogRaid } from "@/lib/raid-catalog";
import { catalogMatchKey } from "@/services/warcraft-logs-raid-metadata.service";

/**
 * Pure Blizzard import planning for the Raid Catalog: compares one Blizzard
 * journal instance with the persisted catalog and decides what an import /
 * refresh writes. No I/O — the import service fetches, the repository writes.
 *
 * Identity: a raid by its Blizzard journal instance id (the id the character
 * encounters API reports), a boss by its journal encounter id. Only
 * Blizzard-owned fields are planned: raid name, boss names, boss order and
 * encounter ids. Season, order, lockout tracking, run availability and WCL ids
 * of existing rows are never touched.
 */

export type JournalRaid = {
  instanceId: number;
  name: string;
  /** Journal encounters in journal (boss) order. */
  encounters: ReadonlyArray<{ id: number; name: string }>;
};

export type RaidImportStatus = "NEW" | "UP_TO_DATE" | "UPDATE_AVAILABLE";

export type PlannedBoss = {
  encounterId: number;
  name: string;
  /** 1-based journal order. */
  sortOrder: number;
  /** Existing RaidBoss id, or null when the import creates it. */
  bossId: string | null;
  change: "NEW" | "UNCHANGED" | "UPDATED";
  previousName: string | null;
  blizzardEncounterIds: number[];
};

export type RaidImportPlan = {
  instanceId: number;
  name: string;
  status: RaidImportStatus;
  /** Existing raid that this import updates (null → a new raid is created). */
  raidId: string | null;
  previousName: string | null;
  /** Existing raid without an instance id, matched by name and linked now. */
  adopt: boolean;
  /** In use or seeded: the encounter set is kept, differences need reconciliation. */
  structureLocked: boolean;
  /** Bosses written by the import, in Blizzard order. */
  bosses: PlannedBoss[];
  /** Existing bosses Blizzard no longer returns that are deleted (unlocked raids only). */
  removedBosses: Array<{ bossId: string; name: string }>;
  /** Locked raids: bosses kept although Blizzard no longer returns them. */
  staleBosses: Array<{ bossId: string; name: string }>;
  /** Locked raids: Blizzard bosses that are not added. */
  unaddedEncounters: Array<{ encounterId: number; name: string }>;
  /** Human-readable differences (empty when up to date). */
  changes: string[];
};

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** The catalog raid an import of `instanceId` updates: by instance id, else one unlinked raid of the same name. */
export function findImportTarget(
  raids: readonly CatalogRaid[],
  journal: Pick<JournalRaid, "instanceId" | "name">,
): { raid: CatalogRaid; adopt: boolean } | null {
  const linked = raids.find((raid) => raid.blizzardInstanceId === journal.instanceId);
  if (linked) return { raid: linked, adopt: false };
  const key = catalogMatchKey(journal.name);
  const unlinked = raids.filter(
    (raid) => raid.blizzardInstanceId == null && catalogMatchKey(raid.name) === key,
  );
  return unlinked.length === 1 ? { raid: unlinked[0]!, adopt: true } : null;
}

/**
 * Pair existing bosses with journal encounters: by encounter id first, then a
 * unique (normalized) name among the rest; a one-boss raid and a one-encounter
 * instance pair even when the names differ ("The Unbinding of Kith'ix" → "Kith'ix").
 */
export function matchBosses(
  bosses: readonly CatalogBoss[],
  encounters: JournalRaid["encounters"],
): Map<number, CatalogBoss> {
  const matched = new Map<number, CatalogBoss>();
  const used = new Set<string>();
  for (const encounter of encounters) {
    const boss = bosses.find(
      (row) => !used.has(row.id) && row.blizzardEncounterIds.includes(encounter.id),
    );
    if (boss) {
      matched.set(encounter.id, boss);
      used.add(boss.id);
    }
  }
  if (bosses.length === 1 && encounters.length === 1 && matched.size === 0) {
    matched.set(encounters[0]!.id, bosses[0]!);
    return matched;
  }
  for (const encounter of encounters) {
    if (matched.has(encounter.id)) continue;
    const key = catalogMatchKey(encounter.name);
    const hits = bosses.filter((row) => !used.has(row.id) && catalogMatchKey(row.name) === key);
    if (hits.length === 1) {
      matched.set(encounter.id, hits[0]!);
      used.add(hits[0]!.id);
    }
  }
  return matched;
}

export function planRaidImport(input: {
  journal: JournalRaid;
  target: { raid: CatalogRaid; adopt: boolean } | null;
  structureLocked: boolean;
}): RaidImportPlan {
  const { journal, target } = input;
  if (!target) {
    return {
      instanceId: journal.instanceId,
      name: journal.name,
      status: "NEW",
      raidId: null,
      previousName: null,
      adopt: false,
      structureLocked: false,
      bosses: journal.encounters.map((encounter, index) => ({
        encounterId: encounter.id,
        name: encounter.name,
        sortOrder: index + 1,
        bossId: null,
        change: "NEW",
        previousName: null,
        blizzardEncounterIds: [encounter.id],
      })),
      removedBosses: [],
      staleBosses: [],
      unaddedEncounters: [],
      changes: [`New raid with ${journal.encounters.length} bosses.`],
    };
  }

  const { raid, adopt } = target;
  const locked = input.structureLocked;
  const matched = matchBosses(raid.bosses, journal.encounters);
  const changes: string[] = [];
  if (adopt) changes.push(`Links ${raid.name} to Blizzard instance ${journal.instanceId}.`);
  if (raid.name !== journal.name) changes.push(`Raid renamed: ${raid.name} → ${journal.name}.`);

  const bosses: PlannedBoss[] = [];
  const unaddedEncounters: RaidImportPlan["unaddedEncounters"] = [];
  for (const encounter of journal.encounters) {
    const boss = matched.get(encounter.id);
    if (!boss && locked) {
      unaddedEncounters.push({ encounterId: encounter.id, name: encounter.name });
      continue;
    }
    const sortOrder = bosses.length + 1;
    if (!boss) {
      bosses.push({
        encounterId: encounter.id,
        name: encounter.name,
        sortOrder,
        bossId: null,
        change: "NEW",
        previousName: null,
        blizzardEncounterIds: [encounter.id],
      });
      changes.push(`New boss: ${encounter.name}.`);
      continue;
    }
    // Matched by id keeps every stored id; matched by name / pairing takes Blizzard's id.
    const blizzardEncounterIds = boss.blizzardEncounterIds.includes(encounter.id)
      ? [...boss.blizzardEncounterIds]
      : [encounter.id];
    const renamed = boss.name !== encounter.name;
    const idsChanged = !sameIds(blizzardEncounterIds, boss.blizzardEncounterIds);
    const moved = boss.sortOrder !== sortOrder;
    if (renamed) changes.push(`Boss renamed: ${boss.name} → ${encounter.name}.`);
    if (idsChanged) changes.push(`${encounter.name}: Blizzard encounter id ${encounter.id}.`);
    if (moved && !renamed && !idsChanged)
      changes.push(`${encounter.name} moves to position ${sortOrder}.`);
    bosses.push({
      encounterId: encounter.id,
      name: encounter.name,
      sortOrder,
      bossId: boss.id,
      change: renamed || idsChanged || moved ? "UPDATED" : "UNCHANGED",
      previousName: renamed ? boss.name : null,
      blizzardEncounterIds,
    });
  }

  const matchedIds = new Set([...matched.values()].map((boss) => boss.id));
  const missing = raid.bosses
    .filter((boss) => !matchedIds.has(boss.id))
    .map((boss) => ({ bossId: boss.id, name: boss.name }));
  const removedBosses = locked ? [] : missing;
  const staleBosses = locked ? missing : [];
  for (const boss of removedBosses)
    changes.push(`Boss removed (no longer in the Blizzard journal): ${boss.name}.`);

  return {
    instanceId: journal.instanceId,
    name: journal.name,
    status: changes.length > 0 ? "UPDATE_AVAILABLE" : "UP_TO_DATE",
    raidId: raid.id,
    previousName: raid.name,
    adopt,
    structureLocked: locked,
    bosses,
    removedBosses,
    staleBosses,
    unaddedEncounters,
    changes,
  };
}
