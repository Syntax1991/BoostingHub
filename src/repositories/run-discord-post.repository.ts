import { orm } from "@/lib/prisma";
import { or } from "@prisma/orm-postgres/orm-client";
import { asNumberOrNull, asString, asStringOrNull } from "@/lib/persistence";

export type RunDiscordPostRecord = {
  runId: string;
  runChannelId: string | null;
  /** Temporary GuildVoice channel while the Run is (or recently was) IN_PROGRESS. */
  voiceChannelId: string | null;
  signupChannelId: string | null;
  signupMessageId: string | null;
  signupPostedAt: string | null;
  lastSignupSignature: string | null;
  rosterChannelId: string | null;
  rosterMessageId: string | null;
  rosterPostedAt: string | null;
  lastRosterVersion: number | null;
  /** RunRoster.postRevision the bot last fulfilled with a NEW roster message; null = none yet (treated as 0). */
  lastRosterPostRevision: number | null;
  startChannelId: string | null;
  startMessageId: string | null;
  startPostedAt: string | null;
  /** RunRoster.version the posted Final Setup reflects; null for older posts. */
  lastStartRosterVersion: number | null;
  /** Voice channel the posted Final Setup links; null = no Voice line. */
  lastStartVoiceChannelId: string | null;
  archiveCloseMessageId: string | null;
  archiveTranscriptMessageId: string | null;
  archiveTranscriptHtml: string | null;
  archiveTranscriptFilename: string | null;
  /** JSON array of signup ids that already received a Raid Invite DM. */
  raidInviteSentSignupIds: string | null;
};

export function parseRaidInviteSentSignupIds(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

function mapRow(row: Record<string, unknown>): RunDiscordPostRecord {
  return {
    runId: asString(row.runId),
    runChannelId: asStringOrNull(row.runChannelId),
    voiceChannelId: asStringOrNull(row.voiceChannelId),
    signupChannelId: asStringOrNull(row.signupChannelId),
    signupMessageId: asStringOrNull(row.signupMessageId),
    signupPostedAt: asStringOrNull(row.signupPostedAt),
    lastSignupSignature: asStringOrNull(row.lastSignupSignature),
    rosterChannelId: asStringOrNull(row.rosterChannelId),
    rosterMessageId: asStringOrNull(row.rosterMessageId),
    rosterPostedAt: asStringOrNull(row.rosterPostedAt),
    lastRosterVersion: asNumberOrNull(row.lastRosterVersion),
    lastRosterPostRevision: asNumberOrNull(row.lastRosterPostRevision),
    startChannelId: asStringOrNull(row.startChannelId),
    startMessageId: asStringOrNull(row.startMessageId),
    startPostedAt: asStringOrNull(row.startPostedAt),
    lastStartRosterVersion: asNumberOrNull(row.lastStartRosterVersion),
    lastStartVoiceChannelId: asStringOrNull(row.lastStartVoiceChannelId),
    archiveCloseMessageId: asStringOrNull(row.archiveCloseMessageId),
    archiveTranscriptMessageId: asStringOrNull(row.archiveTranscriptMessageId),
    archiveTranscriptHtml: asStringOrNull(row.archiveTranscriptHtml),
    archiveTranscriptFilename: asStringOrNull(row.archiveTranscriptFilename),
    raidInviteSentSignupIds: asStringOrNull(row.raidInviteSentSignupIds),
  };
}

/**
 * Discord message identity per Run. Presentation-only integration state: the
 * bot's own record of which message it already posted, never a second source
 * of truth for Run/Signup/Roster data.
 */
export const runDiscordPostRepository = {
  async findByRunId(runId: string): Promise<RunDiscordPostRecord | null> {
    const row = await orm.RunDiscordPost.where({ runId }).first();
    return row ? mapRow(row as Record<string, unknown>) : null;
  },

  /** One query for many Runs, keyed by runId. Runs without a row are absent. */
  async listByRunIds(runIds: readonly string[]): Promise<Map<string, RunDiscordPostRecord>> {
    const uniqueIds = [...new Set(runIds)];
    const byRunId = new Map<string, RunDiscordPostRecord>();
    if (uniqueIds.length === 0) return byRunId;
    const rows = await orm.RunDiscordPost.where((post) => post.runId.in(uniqueIds)).all();
    for (const row of rows) {
      const record = mapRow(row as Record<string, unknown>);
      byRunId.set(record.runId, record);
    }
    return byRunId;
  },

  /**
   * Run ids whose Discord identity can still produce sync work: a live Run
   * channel (reconcile/retire), a Voice channel (reconcile/retire-if-empty),
   * or a signup post identity (updates; the roster and Final Setup lanes also
   * target the Run channel, falling back to the signup channel). A retired
   * channel's leftover signup identity stays here until the bot confirms the
   * channel gone (`clearDeletedChannelIdentity`). Roster/start message markers,
   * archive transcripts and Raid Invite history alone are history, not work.
   * Selects runId only — never transcript HTML.
   */
  async listLiveIdentityRunIds(): Promise<string[]> {
    const rows = await orm.RunDiscordPost.where((post) =>
      or(
        post.runChannelId.isNotNull(),
        post.voiceChannelId.isNotNull(),
        post.signupChannelId.isNotNull(),
        post.signupMessageId.isNotNull(),
      ),
    )
      .select("runId")
      .all();
    return rows.map((row) => asString((row as Record<string, unknown>).runId));
  },

  async listAll(): Promise<RunDiscordPostRecord[]> {
    const rows = await orm.RunDiscordPost.all();
    return rows.map((row) => mapRow(row as Record<string, unknown>));
  },

  async recordSignupPost(input: {
    runId: string;
    signupChannelId: string;
    signupMessageId: string;
    lastSignupSignature: string;
    /** When set, also stamps dedicated runChannelId (same channel while live). */
    runChannelId?: string;
  }): Promise<void> {
    await upsert(input.runId, {
      signupChannelId: input.signupChannelId,
      signupMessageId: input.signupMessageId,
      signupPostedAt: new Date().toISOString(),
      lastSignupSignature: input.lastSignupSignature,
      ...(input.runChannelId ? { runChannelId: input.runChannelId } : {}),
    });
  },

  /**
   * The current roster message (edited or newly sent). `lastRosterPostRevision`
   * is given only when the bot fulfilled an explicit Publish (a NEW message);
   * refreshes and missing-message recovery leave it unchanged.
   */
  async recordRosterPost(input: {
    runId: string;
    rosterChannelId: string;
    rosterMessageId: string;
    lastRosterVersion: number;
    lastRosterPostRevision?: number;
  }): Promise<void> {
    await upsert(input.runId, {
      rosterChannelId: input.rosterChannelId,
      rosterMessageId: input.rosterMessageId,
      rosterPostedAt: new Date().toISOString(),
      lastRosterVersion: input.lastRosterVersion,
      ...(input.lastRosterPostRevision !== undefined ? { lastRosterPostRevision: input.lastRosterPostRevision } : {}),
    });
  },

  async recordStartPost(input: {
    runId: string;
    startChannelId: string;
    startMessageId: string;
    /** Roster version the posted content was rendered from. */
    lastStartRosterVersion: number | null;
    /** Voice channel id the posted content links; null when it has no Voice line. */
    lastStartVoiceChannelId: string | null;
  }): Promise<void> {
    await upsert(input.runId, {
      startChannelId: input.startChannelId,
      startMessageId: input.startMessageId,
      startPostedAt: new Date().toISOString(),
      lastStartRosterVersion: input.lastStartRosterVersion,
      lastStartVoiceChannelId: input.lastStartVoiceChannelId,
    });
  },

  /**
   * Recorded as soon as the Run's dedicated channel is created — before any
   * message is posted into it — so a crash between creation and posting
   * never causes a retry to create a second channel.
   */
  async recordRunChannel(input: { runId: string; channelId: string }): Promise<void> {
    await upsert(input.runId, { runChannelId: input.channelId });
  },

  /**
   * Recorded immediately after the bot creates the Run's temporary voice
   * channel, so a retry never creates a second one. Touches no other field.
   */
  async recordRunVoiceChannel(input: { runId: string; channelId: string }): Promise<void> {
    await upsert(input.runId, { voiceChannelId: input.channelId });
  },

  /**
   * Clears the voice channel identity only while it still equals `channelId`
   * (checked by the UPDATE itself), so a stale report can never erase a
   * newer voice channel. Idempotent.
   */
  async clearRunVoiceChannel(input: { runId: string; channelId: string }): Promise<void> {
    await orm.RunDiscordPost.where({ runId: input.runId, voiceChannelId: input.channelId }).update({
      voiceChannelId: null,
      updatedAt: new Date().toISOString(),
    });
  },

  /**
   * Close/transcript Discord message ids plus the HTML body for website download.
   * HTML is required so already-posted Discord artifacts can backfill without re-sending.
   */
  async recordArchiveArtifacts(input: {
    runId: string;
    archiveCloseMessageId: string;
    archiveTranscriptMessageId: string;
    archiveTranscriptHtml: string;
    archiveTranscriptFilename: string;
  }): Promise<void> {
    await upsert(input.runId, {
      archiveCloseMessageId: input.archiveCloseMessageId,
      archiveTranscriptMessageId: input.archiveTranscriptMessageId,
      archiveTranscriptHtml: input.archiveTranscriptHtml,
      archiveTranscriptFilename: input.archiveTranscriptFilename,
    });
  },

  /** Cleared on restore so a later re-archive can post artifacts again. */
  async clearArchiveArtifacts(runId: string): Promise<void> {
    const existing = await orm.RunDiscordPost.where({ runId }).first();
    if (!existing) return;
    await orm.RunDiscordPost.where({ runId }).update({
      archiveCloseMessageId: null,
      archiveTranscriptMessageId: null,
      archiveTranscriptHtml: null,
      archiveTranscriptFilename: null,
      updatedAt: new Date().toISOString(),
    });
  },

  /**
   * Cleared after an app-archived Run's Discord channel is deleted — the
   * lasting record is the archive-log transcript + persisted HTML, not a
   * moved `closed-*` channel.
   */
  async clearRunChannel(runId: string): Promise<void> {
    const existing = await orm.RunDiscordPost.where({ runId }).first();
    if (!existing) return;
    await orm.RunDiscordPost.where({ runId }).update({
      runChannelId: null,
      updatedAt: new Date().toISOString(),
    });
  },

  /**
   * Discord confirmed `channelId` is deleted (Unknown Channel) and the bot may
   * not replace it. Drops only the live identity that lives in that channel —
   * run channel, signup post, roster post — so sync work stops re-targeting
   * it every poll. Fields pointing at any other channel (e.g. a replacement
   * recorded meanwhile) are untouched. The start post marker, archive
   * artifacts/transcript and Raid Invite history are kept as history.
   *
   * Each group is cleared by its own UPDATE whose WHERE clause requires the
   * stored channel id to still equal `channelId` at write time — never a
   * read-then-write — so a stale report can never erase a replacement channel
   * recorded concurrently. Idempotent: a non-matching group updates no rows.
   */
  async clearDeletedChannelIdentity(runId: string, channelId: string): Promise<void> {
    const updatedAt = new Date().toISOString();
    await orm.RunDiscordPost.where({ runId, runChannelId: channelId }).update({
      runChannelId: null,
      updatedAt,
    });
    await orm.RunDiscordPost.where({ runId, signupChannelId: channelId }).update({
      signupChannelId: null,
      signupMessageId: null,
      lastSignupSignature: null,
      updatedAt,
    });
    await orm.RunDiscordPost.where({ runId, rosterChannelId: channelId }).update({
      rosterChannelId: null,
      rosterMessageId: null,
      lastRosterVersion: null,
      updatedAt,
    });
  },

  /**
   * Appends a signup id to the Raid Invite sent list (idempotent).
   * Closed-DM failures still record so the bot does not retry forever.
   */
  async recordRaidInviteSent(input: { runId: string; signupId: string }): Promise<void> {
    const existing = await orm.RunDiscordPost.where({ runId: input.runId }).first();
    const current = parseRaidInviteSentSignupIds(
      existing ? asStringOrNull((existing as Record<string, unknown>).raidInviteSentSignupIds) : null,
    );
    if (current.includes(input.signupId)) {
      if (!existing) {
        await upsert(input.runId, { raidInviteSentSignupIds: JSON.stringify([input.signupId]) });
      }
      return;
    }
    await upsert(input.runId, {
      raidInviteSentSignupIds: JSON.stringify([...current, input.signupId]),
    });
  },
};

async function upsert(runId: string, patch: Record<string, unknown>): Promise<void> {
  const now = new Date().toISOString();
  const existing = await orm.RunDiscordPost.where({ runId }).first();
  if (existing) {
    await orm.RunDiscordPost.where({ runId }).update({ ...patch, updatedAt: now });
    return;
  }
  await orm.RunDiscordPost.create({
    id: crypto.randomUUID(),
    runId,
    runChannelId: null,
    voiceChannelId: null,
    signupChannelId: null,
    signupMessageId: null,
    signupPostedAt: null,
    lastSignupSignature: null,
    rosterChannelId: null,
    rosterMessageId: null,
    rosterPostedAt: null,
    lastRosterVersion: null,
    startChannelId: null,
    startMessageId: null,
    startPostedAt: null,
    lastStartRosterVersion: null,
    archiveCloseMessageId: null,
    archiveTranscriptMessageId: null,
    archiveTranscriptHtml: null,
    archiveTranscriptFilename: null,
    raidInviteSentSignupIds: null,
    ...patch,
    createdAt: now,
    updatedAt: now,
  });
}
