import type { CharacterRole, RaidDifficulty, RunStatus } from "@/models/enums";
import { attackTypeForSpecialization } from "@/lib/wow-specializations";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import { rosterRepository, type RosterSignupRow } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { isSignupWindowOpen } from "@/services/run-state";

export type SignupEmbedData = {
  runId: string;
  runTitle: string;
  raidName: string;
  difficulty: RaidDifficulty;
  scheduledStartAt: string;
  runStatus: RunStatus;
  signupWindowOpen: boolean;
  /** Distinct Users with an active (non-WITHDRAWN) signup — never a row count. */
  uniqueSignupCount: number;
};

export type RosterEmbedMember = {
  userId: string;
  userName: string;
  discordUserId: string | null;
  characterName: string;
  characterRealm: string;
};

export type RosterEmbedData = {
  runId: string;
  runTitle: string;
  raidName: string;
  difficulty: RaidDifficulty;
  publishedAt: string;
  version: number;
  /**
   * Tank/Healer targets come from the Run's real desired counts. DPS has no
   * melee/ranged split target in the current Run schema (desiredDpsCount is
   * one combined number) — melee/ranged DPS groups are reported without a
   * denominator rather than inventing one.
   */
  targets: { tanks: number; healers: number };
  groups: {
    tanks: RosterEmbedMember[];
    healers: RosterEmbedMember[];
    meleeDps: RosterEmbedMember[];
    rangedDps: RosterEmbedMember[];
    lootbuddies: RosterEmbedMember[];
  };
  totalSelected: number;
};

export type SignupSyncWorkItem = { runId: string; hasExistingPost: boolean };
export type RosterSyncWorkItem = { runId: string; hasExistingPost: boolean };

function signupSignature(run: { status: RunStatus; signupsOpen: boolean; signups: Array<{ userId: string; status: string }> }): string {
  const uniqueSignupCount = new Set(
    run.signups.filter((signup) => signup.status !== "WITHDRAWN").map((signup) => signup.userId),
  ).size;
  return `${uniqueSignupCount}:${isSignupWindowOpen(run.status, run.signupsOpen)}:${run.status}`;
}

function toMember(row: RosterSignupRow): RosterEmbedMember {
  return {
    userId: row.userId,
    userName: row.userName,
    discordUserId: row.discordUserId,
    characterName: row.character?.name ?? "Unknown character",
    characterRealm: row.character?.realm ?? "",
  };
}

function boosterByRole(selected: RosterSignupRow[], role: CharacterRole): RosterSignupRow[] {
  return selected.filter((row) => row.participationType === "BOOSTER" && row.role === role);
}

/**
 * Presentation-only integration state for the Discord bot. Never a second
 * source of truth: every DTO here is re-derived from the same Run/Signup/
 * Roster data the Web UI reads, and `RunDiscordPost` only remembers which
 * Discord message already represents that data.
 */
export const discordSyncService = {
  /**
   * Runs whose posted (or not-yet-posted) Discord message no longer matches
   * current BoostingHub state. DRAFT runs are never candidates — nothing is
   * posted until a Run is actually open for signups.
   */
  async listSyncWork(): Promise<{ signups: SignupSyncWorkItem[]; roster: RosterSyncWorkItem[] }> {
    const runs = await runRepository.listManaged();
    const signups: SignupSyncWorkItem[] = [];
    const roster: RosterSyncWorkItem[] = [];

    for (const run of runs) {
      if (run.status === "DRAFT") continue;
      const post = await runDiscordPostRepository.findByRunId(run.id);

      const signature = signupSignature(run);
      if (!post?.signupMessageId || post.lastSignupSignature !== signature) {
        signups.push({ runId: run.id, hasExistingPost: Boolean(post?.signupMessageId) });
      }

      if (run.roster?.publishedAt) {
        if (!post?.rosterMessageId || post.lastRosterVersion !== run.roster.version) {
          roster.push({ runId: run.id, hasExistingPost: Boolean(post?.rosterMessageId) });
        }
      }
    }

    return { signups, roster };
  },

  async getSignupEmbedData(runId: string): Promise<SignupEmbedData | null> {
    const run = await runRepository.findById(runId);
    if (!run) return null;
    return {
      runId: run.id,
      runTitle: run.title,
      raidName: run.raidName,
      difficulty: run.difficulty,
      scheduledStartAt: run.scheduledStartAt,
      runStatus: run.status,
      signupWindowOpen: isSignupWindowOpen(run.status, run.signupsOpen),
      uniqueSignupCount: new Set(
        run.signups.filter((signup) => signup.status !== "WITHDRAWN").map((signup) => signup.userId),
      ).size,
    };
  },

  /** Null when the Run has no published roster yet — there is nothing to post. */
  async getRosterEmbedData(runId: string): Promise<RosterEmbedData | null> {
    const run = await runRepository.findById(runId);
    if (!run || !run.roster?.publishedAt) return null;

    const rows = await rosterRepository.listSignups(runId);
    const selected = rows.filter((row) => row.status === "SELECTED");
    const dps = boosterByRole(selected, "DPS");
    const rangedDps = dps.filter(
      (row) => attackTypeForSpecialization(row.character?.wowClass ?? "WARRIOR", row.character?.specialization ?? null) === "RANGED",
    );
    const rangedIds = new Set(rangedDps.map((row) => row.id));
    const meleeDps = dps.filter((row) => !rangedIds.has(row.id));

    return {
      runId: run.id,
      runTitle: run.title,
      raidName: run.raidName,
      difficulty: run.difficulty,
      publishedAt: run.roster.publishedAt,
      version: run.roster.version,
      targets: { tanks: run.desiredTankCount, healers: run.desiredHealerCount },
      groups: {
        tanks: boosterByRole(selected, "TANK").map(toMember),
        healers: boosterByRole(selected, "HEALER").map(toMember),
        meleeDps: meleeDps.map(toMember),
        rangedDps: rangedDps.map(toMember),
        lootbuddies: selected.filter((row) => row.participationType === "LOOTBUDDY").map(toMember),
      },
      totalSelected: selected.length,
    };
  },

  async recordSignupPost(input: { runId: string; channelId: string; messageId: string }): Promise<void> {
    const data = await this.getSignupEmbedData(input.runId);
    if (!data) return;
    const run = await runRepository.findById(input.runId);
    if (!run) return;
    await runDiscordPostRepository.recordSignupPost({
      runId: input.runId,
      signupChannelId: input.channelId,
      signupMessageId: input.messageId,
      lastSignupSignature: signupSignature(run),
    });
  },

  async recordRosterPost(input: { runId: string; channelId: string; messageId: string }): Promise<void> {
    const run = await runRepository.findById(input.runId);
    if (!run?.roster) return;
    await runDiscordPostRepository.recordRosterPost({
      runId: input.runId,
      rosterChannelId: input.channelId,
      rosterMessageId: input.messageId,
      lastRosterVersion: run.roster.version,
    });
  },
};
