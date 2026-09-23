import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { discordSyncService } from "@/services/discord-sync.service";

/**
 * Body for PUT /api/bot/runs/:runId/discord-state.
 * Discriminant `kind` string values are a stable bot↔API wire contract — do not rename them.
 */
export const runDiscordStateUpdateSchema = z.discriminatedUnion("kind", [
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
  z.object({
    kind: z.literal("notification-dm"),
    notificationId: z.string().uuid(),
    result: z.enum(["SENT", "FAILED_PERMANENT"]),
  }),
  z.object({
    kind: z.literal("run-announcement"),
    announcementId: z.string().uuid(),
    result: z.enum(["SENT", "SKIPPED", "FAILED_PERMANENT"]),
  }),
]);

export type RunDiscordStateUpdate = z.infer<typeof runDiscordStateUpdateSchema>;

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
 * `notification-dm` updates UserNotification.discordDeliveryStatus (and on
 * SENT RAID_INVITE also appends the legacy raidInviteSentSignupIds list).
 * `run-announcement` updates RunDiscordAnnouncement delivery status.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { runId } = await params;
    const runDiscordStateUpdate = runDiscordStateUpdateSchema.parse(await request.json());

    if (runDiscordStateUpdate.kind === "channel") {
      await discordSyncService.recordRunChannel({ runId, channelId: runDiscordStateUpdate.channelId });
    } else if (runDiscordStateUpdate.kind === "clear-channel") {
      await discordSyncService.clearRunChannel(runId);
    } else if (runDiscordStateUpdate.kind === "signup") {
      await discordSyncService.recordSignupPost({
        runId,
        channelId: runDiscordStateUpdate.channelId,
        messageId: runDiscordStateUpdate.messageId,
        classEmojiFingerprint: runDiscordStateUpdate.classEmojiFingerprint,
      });
    } else if (runDiscordStateUpdate.kind === "roster") {
      await discordSyncService.recordRosterPost({
        runId,
        channelId: runDiscordStateUpdate.channelId,
        messageId: runDiscordStateUpdate.messageId,
      });
    } else if (runDiscordStateUpdate.kind === "start") {
      await discordSyncService.recordStartPost({
        runId,
        channelId: runDiscordStateUpdate.channelId,
        messageId: runDiscordStateUpdate.messageId,
      });
    } else if (runDiscordStateUpdate.kind === "raid-invite") {
      await discordSyncService.recordRaidInviteSent({ runId, signupId: runDiscordStateUpdate.signupId });
    } else if (runDiscordStateUpdate.kind === "notification-dm") {
      await discordSyncService.recordNotificationDmDelivery({
        notificationId: runDiscordStateUpdate.notificationId,
        result: runDiscordStateUpdate.result,
      });
    } else if (runDiscordStateUpdate.kind === "run-announcement") {
      await discordSyncService.recordRunAnnouncementDelivery({
        announcementId: runDiscordStateUpdate.announcementId,
        result: runDiscordStateUpdate.result,
      });
    } else {
      await discordSyncService.recordArchiveArtifacts({
        runId,
        closeMessageId: runDiscordStateUpdate.closeMessageId,
        transcriptMessageId: runDiscordStateUpdate.transcriptMessageId,
        transcriptHtml: runDiscordStateUpdate.transcriptHtml,
        transcriptFilename: runDiscordStateUpdate.transcriptFilename,
      });
    }

    return botApiOk({ recorded: true });
  } catch (error) {
    return botApiError(error);
  }
}
