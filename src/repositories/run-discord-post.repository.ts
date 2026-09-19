import { orm } from "@/lib/prisma";
import { asNumberOrNull, asString, asStringOrNull } from "@/lib/persistence";

export type RunDiscordPostRecord = {
  runId: string;
  runChannelId: string | null;
  signupChannelId: string | null;
  signupMessageId: string | null;
  signupPostedAt: string | null;
  lastSignupSignature: string | null;
  rosterChannelId: string | null;
  rosterMessageId: string | null;
  rosterPostedAt: string | null;
  lastRosterVersion: number | null;
  startChannelId: string | null;
  startMessageId: string | null;
  startPostedAt: string | null;
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
    signupChannelId: asStringOrNull(row.signupChannelId),
    signupMessageId: asStringOrNull(row.signupMessageId),
    signupPostedAt: asStringOrNull(row.signupPostedAt),
    lastSignupSignature: asStringOrNull(row.lastSignupSignature),
    rosterChannelId: asStringOrNull(row.rosterChannelId),
    rosterMessageId: asStringOrNull(row.rosterMessageId),
    rosterPostedAt: asStringOrNull(row.rosterPostedAt),
    lastRosterVersion: asNumberOrNull(row.lastRosterVersion),
    startChannelId: asStringOrNull(row.startChannelId),
    startMessageId: asStringOrNull(row.startMessageId),
    startPostedAt: asStringOrNull(row.startPostedAt),
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

  async listAll(): Promise<RunDiscordPostRecord[]> {
    const rows = await orm.RunDiscordPost.all();
    return rows.map((row) => mapRow(row as Record<string, unknown>));
  },

  async recordSignupPost(input: {
    runId: string;
    signupChannelId: string;
    signupMessageId: string;
    lastSignupSignature: string;
  }): Promise<void> {
    await upsert(input.runId, {
      signupChannelId: input.signupChannelId,
      signupMessageId: input.signupMessageId,
      signupPostedAt: new Date().toISOString(),
      lastSignupSignature: input.lastSignupSignature,
    });
  },

  async recordRosterPost(input: {
    runId: string;
    rosterChannelId: string;
    rosterMessageId: string;
    lastRosterVersion: number;
  }): Promise<void> {
    await upsert(input.runId, {
      rosterChannelId: input.rosterChannelId,
      rosterMessageId: input.rosterMessageId,
      rosterPostedAt: new Date().toISOString(),
      lastRosterVersion: input.lastRosterVersion,
    });
  },

  async recordStartPost(input: {
    runId: string;
    startChannelId: string;
    startMessageId: string;
  }): Promise<void> {
    await upsert(input.runId, {
      startChannelId: input.startChannelId,
      startMessageId: input.startMessageId,
      startPostedAt: new Date().toISOString(),
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
