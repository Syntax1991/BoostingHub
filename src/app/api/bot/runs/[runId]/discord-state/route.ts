import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { discordSyncService } from "@/services/discord-sync.service";

const discordStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("channel"), channelId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("signup"), channelId: z.string().min(1).max(64), messageId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("roster"), channelId: z.string().min(1).max(64), messageId: z.string().min(1).max(64) }),
]);

/**
 * PUT /api/bot/runs/:runId/discord-state
 *
 * Records Discord identity the bot just created or confirmed for a Run —
 * its dedicated channel, its signup message, or its roster message — so the
 * next sync pass reuses/edits that same identity instead of creating a
 * duplicate. Purely bookkeeping — never authoritative Run/Signup state.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { runId } = await params;
    const body = discordStateSchema.parse(await request.json());

    if (body.kind === "channel") {
      await discordSyncService.recordRunChannel({ runId, channelId: body.channelId });
    } else if (body.kind === "signup") {
      await discordSyncService.recordSignupPost({ runId, channelId: body.channelId, messageId: body.messageId });
    } else {
      await discordSyncService.recordRosterPost({ runId, channelId: body.channelId, messageId: body.messageId });
    }

    return botApiOk({ recorded: true });
  } catch (error) {
    return botApiError(error);
  }
}
