import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { WARCRAFT_LOGS_REPORT_CODE } from "@/lib/warcraft-logs";
import { runWarcraftLogsService } from "@/services/run-warcraft-logs.service";

const snowflake = z.string().regex(/^\d{15,25}$/);

/** Body for POST /api/bot/runs/:runId/warcraft-logs (stable bot↔API wire contract). */
export const botAttachWarcraftLogsSchema = z.object({
  reportCode: z.string().regex(WARCRAFT_LOGS_REPORT_CODE),
  channelId: snowflake,
  messageId: snowflake,
  authorId: snowflake,
});

/**
 * POST /api/bot/runs/:runId/warcraft-logs
 *
 * A trusted log bot posted a Warcraft Logs report link in this Run's Discord
 * channel. System action (no acting User): the service re-checks the author
 * allowlist, that the message came from this Run's own channel, and the Run
 * status. Idempotent — an already-linked report returns ALREADY_ATTACHED
 * without a Warcraft Logs request.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    assertBotServiceAuthorized(request);
    const { runId } = await params;
    const body = botAttachWarcraftLogsSchema.parse(await request.json());
    const result = await runWarcraftLogsService.attachFromDiscord({ runId, ...body });
    return botApiOk(result);
  } catch (error) {
    return botApiError(error);
  }
}
