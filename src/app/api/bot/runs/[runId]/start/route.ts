import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { DomainError } from "@/lib/errors";
import { discordSyncService } from "@/services/discord-sync.service";

/**
 * GET /api/bot/runs/:runId/start
 *
 * Discord-ready operational Run Start roster DTO (attendance snapshot +
 * immutable gold collectors). Null/404 when the Run has not started.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { runId } = await params;
    const data = await discordSyncService.getRunStartEmbedData(runId);
    if (!data) {
      throw new DomainError("NOT_FOUND", "This run has no start roster yet.", 404);
    }
    return botApiOk(data);
  } catch (error) {
    return botApiError(error);
  }
}
