import type { CharacterRole, RaidDifficulty, RunStatus, SignupStatus } from "@/models/enums";
import { buildDiscordRunChannelName } from "@/lib/discord-channel-name";
import { attackTypeForSpecialization } from "@/lib/wow-specializations";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import { rosterRepository, type RosterSignupRow } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { isSignupWindowOpen } from "@/services/run-state";
import { isActiveSignupOffer } from "@/services/signup-state";

export type SignupEmbedData = {
  runId: string;
  runTitle: string;
  raidName: string;
  difficulty: RaidDifficulty;
  scheduledStartAt: string;
  runStatus: RunStatus;
  signupWindowOpen: boolean;
  /** Distinct Users with an active (PENDING or SELECTED) offer — never a row count, never WITHDRAWN/NOT_SELECTED. */
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

/**
 * existingChannelId/existingMessageId let the bot edit its own prior post;
 * both are null when nothing has been posted for this Run yet.
 * existingRunChannelId/desiredChannelName drive per-Run channel provisioning
 * (bot-side DISCORD_RUN_CATEGORY_ID) — desiredChannelName is always computed
 * so a schedule/difficulty/raid-lead change is reflected as a rename even
 * when a bot instance is running in legacy single-channel mode and ignores it.
 */
export type SignupSyncWorkItem = {
  runId: string;
  existingChannelId: string | null;
  existingMessageId: string | null;
  existingRunChannelId: string | null;
  desiredChannelName: string;
  /** Whether the Run's channel, if any, belongs in the archive category rather than the active one. */
  archived: boolean;
};
export type RosterSyncWorkItem = {
  runId: string;
  existingChannelId: string | null;
  existingMessageId: string | null;
  existingRunChannelId: string | null;
  desiredChannelName: string;
  archived: boolean;
};

function desiredChannelNameFor(run: { scheduledStartAt: string; difficulty: RaidDifficulty; raidLeadName: string }): string {
  return buildDiscordRunChannelName({
    scheduledStartAt: run.scheduledStartAt,
    difficulty: run.difficulty,
    raidLeadName: run.raidLeadName,
  });
}

function signupSignature(run: {
  status: RunStatus;
  signupsOpen: boolean;
  signups: Array<{ userId: string; status: SignupStatus }>;
  scheduledStartAt: string;
  difficulty: RaidDifficulty;
  raidLeadName: string;
  archivedAt: string | null;
}): string {
  const uniqueSignupCount = new Set(
    run.signups.filter((signup) => isActiveSignupOffer(signup.status)).map((signup) => signup.userId),
  ).size;
  // desiredChannelName and archived are folded in so a schedule/difficulty/
  // raid-lead change, or an Archive/Restore, always produces sync work (the
  // latter is how the bot notices it needs to move the Run's channel to/from
  // the archive category) even when nothing about the signup count/window/
  // status itself changed.
  return `${uniqueSignupCount}:${isSignupWindowOpen(run.status, run.signupsOpen)}:${run.status}:${desiredChannelNameFor(run)}:${Boolean(run.archivedAt)}`;
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
   * current BoostingHub state.
   *
   * The *first* signup post for a Run only happens while signup is actually
   * available (`isSignupWindowOpen` — OPEN or ROSTERING with `signupsOpen`
   * true), never merely because the Run left DRAFT: a Run the bot only sees
   * for the first time after it already reached PUBLISHED/COMPLETED/
   * CANCELLED (e.g. the bot was offline through its whole signup phase) must
   * not get a brand-new "Signups: 0" post for a phase that's already over.
   * Once a post exists, later updates are unconditional — the same message
   * keeps reflecting the Run's real state (including signups closing) all
   * the way through completion, which is deliberate informational
   * continuity, not a re-trigger of the creation gate.
   */
  async listSyncWork(): Promise<{ signups: SignupSyncWorkItem[]; roster: RosterSyncWorkItem[] }> {
    const runs = await runRepository.listManaged();
    const signups: SignupSyncWorkItem[] = [];
    const roster: RosterSyncWorkItem[] = [];

    for (const run of runs) {
      if (run.status === "DRAFT") continue;
      const post = await runDiscordPostRepository.findByRunId(run.id);

      const hasExistingSignupPost = Boolean(post?.signupMessageId);
      const canCreateSignupPost = isSignupWindowOpen(run.status, run.signupsOpen);
      if (hasExistingSignupPost || canCreateSignupPost) {
        const signature = signupSignature(run);
        if (!hasExistingSignupPost || post!.lastSignupSignature !== signature) {
          signups.push({
            runId: run.id,
            existingChannelId: post?.signupChannelId ?? null,
            existingMessageId: post?.signupMessageId ?? null,
            existingRunChannelId: post?.runChannelId ?? null,
            desiredChannelName: desiredChannelNameFor(run),
            archived: Boolean(run.archivedAt),
          });
        }
      }

      // A roster post reuses the Run's own channel — it never provisions one.
      // A Run whose roster was published without the bot ever having a
      // Discord presence for its signup phase (seeded/historical data, or
      // the bot being offline through the whole signup window) has nowhere
      // to legitimately post a roster embed, matching the same rule that
      // blocks a retroactive first signup post for a phase that's over.
      const hasAnyDiscordPresence = Boolean(post?.runChannelId) || Boolean(post?.signupChannelId);
      if (run.roster?.publishedAt && hasAnyDiscordPresence) {
        if (!post?.rosterMessageId || post.lastRosterVersion !== run.roster.version) {
          roster.push({
            runId: run.id,
            existingChannelId: post?.rosterChannelId ?? null,
            existingMessageId: post?.rosterMessageId ?? null,
            existingRunChannelId: post?.runChannelId ?? null,
            desiredChannelName: desiredChannelNameFor(run),
            archived: Boolean(run.archivedAt),
          });
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
        run.signups.filter((signup) => isActiveSignupOffer(signup.status)).map((signup) => signup.userId),
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

  /** Recorded immediately on channel creation, before any message is posted into it. */
  async recordRunChannel(input: { runId: string; channelId: string }): Promise<void> {
    await runDiscordPostRepository.recordRunChannel(input);
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
