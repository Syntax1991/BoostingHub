import type { AuthenticatedUser } from "@/auth/authorization";
import { assertCanManageRun } from "@/auth/authorization";
import { deriveCharacterSyncHealth, resolveSyncHealthStaleMinutes } from "@/lib/blizzard/sync-health";
import { mapWithConcurrency } from "@/lib/concurrency";
import { DomainError } from "@/lib/errors";
import type { RunStatus } from "@/models/enums";
import { battleNetConnectionRepository } from "@/repositories/battle-net-connection.repository";
import { characterRepository } from "@/repositories/character.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import {
  isInManualCooldown,
  syncLinkedCharacterProfile,
  verifiedConnectionId,
} from "@/services/character-blizzard-sync.service";

const EDITABLE_RUN_STATUSES: readonly RunStatus[] = ["OPEN", "ROSTERING", "PUBLISHED"];
/** Same small fan-out as Start Run's re-check — Blizzard calls per Character are sequential. */
const ROSTER_SYNC_CONCURRENCY = 3;
/** A roster never has more; bounds one click. */
const ROSTER_SYNC_MAX = 40;

export type RosterCharacterSyncResult = {
  synced: number;
  failed: number;
  /** Already being synced elsewhere or inside the normal manual refresh cooldown. */
  skipped: number;
};

/**
 * Raid Lead "Sync Characters" (Roster tab / Preflight): one fresh Blizzard
 * sync of the roster's selected Booster Characters — saved draft or published
 * SELECTED — whose sync health is not HEALTHY, the same set the Preflight
 * "Blizzard sync" warning counts. The server picks the Characters itself;
 * nothing comes from the client. Runs through the one sync entry point
 * (per-Character lock, telemetry, newly-saved roster notices) and respects
 * the manual refresh cooldown.
 */
export const rosterCharacterSyncService = {
  async syncStaleSelected(user: AuthenticatedUser, runId: string): Promise<RosterCharacterSyncResult> {
    const run = await runRepository.findById(runId);
    if (!run) throw new DomainError("NOT_FOUND", "Run was not found.", 404);
    assertCanManageRun(user, run);
    if (!EDITABLE_RUN_STATUSES.includes(run.status)) {
      throw new DomainError("INVALID_ROSTER_SELECTION", "The roster is locked once the run has started.");
    }

    const roster = await rosterRepository.findByRunId(runId);
    const draftSelected = new Set(roster?.selectedSignupIds ?? []);
    const now = new Date();
    const staleMinutes = resolveSyncHealthStaleMinutes();
    const picks = (await rosterRepository.listSignups(runId))
      .filter(
        (signup) =>
          signup.participationType === "BOOSTER" &&
          signup.character?.isActive &&
          signup.status !== "WITHDRAWN" &&
          (draftSelected.has(signup.id) || signup.status === "SELECTED") &&
          deriveCharacterSyncHealth(signup.character, { now, staleMinutes }) !== "HEALTHY",
      )
      .slice(0, ROSTER_SYNC_MAX);

    const result: RosterCharacterSyncResult = { synced: 0, failed: 0, skipped: 0 };
    await mapWithConcurrency(picks, ROSTER_SYNC_CONCURRENCY, async (pick) => {
      // One Character's failure (lookup included) never aborts the others or loses their results.
      try {
        const character = await characterRepository.findById(pick.character!.id);
        if (!character?.isActive || isInManualCooldown(character)) {
          result.skipped += 1;
          return;
        }
        const connection = await battleNetConnectionRepository.findByUserAndRegion(pick.userId, character.region);
        await syncLinkedCharacterProfile(
          { id: pick.userId, name: pick.userName },
          character,
          verifiedConnectionId(character, connection),
          { trigger: "ROSTER_MANAGER", writeActivity: false },
        );
        result.synced += 1;
      } catch (error) {
        if (error instanceof DomainError && error.code === "CHARACTER_SYNC_IN_PROGRESS") result.skipped += 1;
        else result.failed += 1;
      }
    });
    return result;
  },
};
