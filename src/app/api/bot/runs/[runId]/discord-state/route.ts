import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { discordSyncService } from "@/services/discord-sync.service";

const discordStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("channel"), channelId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("clear-channel") }),
  z.object({
    kind: z.literal("signup"),
    channelId: z.string().min(1).max(64),
    messageId: z.string().min(1).max(64),
    classEmojiFingerprint: z.string().max(4000).optional(),
  }),
  z.object({ kind: z.literal("roster"), channelId: z.string().min(1).max(64), messageId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("start"), channelId: z.string().min(1).max(64), messageId: z.string().min(1).max(64) }),
  z.object({
    kind: z.literal("archive-artifacts"),
    closeMessageId: z.string().min(1).max(64),
    transcriptMessageId: z.string().min(1).max(64),
    transcriptHtml: z.string().min(1).max(5_000_000),
    transcriptFilename: z.string().min(1).max(200),
  }),
  z.object({ kind: z.literal("raid-invite"), signupId: z.string().uuid() }),
]);

/**
 * PUT /api/bot/runs/:runId/discord-state
 *
 * Records Discord identity the bot just created or confirmed for a Run —
 * its dedicated channel, its signup message, its roster message, its
 * operational start roster message, or app-archive close/transcript message
 * ids — so the next sync pass reuses/edits that same identity instead of
 * creating a duplicate. Purely bookkeeping — never authoritative
 * Run/Signup state. `clear-channel` drops `runChannelId` after the bot
 * deletes an app-archived Run's Discord channel (transcript remains).
 * `raid-invite` appends a signup id to the Apex Raid Invite sent list.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { runId } = await params;
    const body = discordStateSchema.parse(await request.json());

    if (body.kind === "channel") {
      await discordSyncService.recordRunChannel({ runId, channelId: body.channelId });
    } else if (body.kind === "clear-channel") {
      await discordSyncService.clearRunChannel(runId);
    } else if (body.kind === "signup") {
      await discordSyncService.recordSignupPost({
        runId,
        channelId: body.channelId,
        messageId: body.messageId,
        classEmojiFingerprint: body.classEmojiFingerprint,
      });
    } else if (body.kind === "roster") {
      await discordSyncService.recordRosterPost({ runId, channelId: body.channelId, messageId: body.messageId });
    } else if (body.kind === "start") {
      await discordSyncService.recordStartPost({ runId, channelId: body.channelId, messageId: body.messageId });
    } else if (body.kind === "raid-invite") {
      await discordSyncService.recordRaidInviteSent({ runId, signupId: body.signupId });
    } else {
      await discordSyncService.recordArchiveArtifacts({
        runId,
        closeMessageId: body.closeMessageId,
        transcriptMessageId: body.transcriptMessageId,
        transcriptHtml: body.transcriptHtml,
        transcriptFilename: body.transcriptFilename,
      });
    }

    return botApiOk({ recorded: true });
  } catch (error) {
    return botApiError(error);
  }
}
