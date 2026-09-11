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
};

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

  /**
   * Recorded as soon as the Run's dedicated channel is created — before any
   * message is posted into it — so a crash between creation and posting
   * never causes a retry to create a second channel.
   */
  async recordRunChannel(input: { runId: string; channelId: string }): Promise<void> {
    await upsert(input.runId, { runChannelId: input.channelId });
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
    ...patch,
    createdAt: now,
    updatedAt: now,
  });
}
