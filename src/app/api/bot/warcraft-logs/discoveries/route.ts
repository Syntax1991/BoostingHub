import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { WARCRAFT_LOGS_REPORT_CODE } from "@/lib/warcraft-logs";
import { warcraftLogsDiscoveryService } from "@/services/warcraft-logs-discovery.service";

const snowflake = z.string().regex(/^\d{15,25}$/);

/** Body for POST /api/bot/warcraft-logs/discoveries (stable bot↔API wire contract). */
export const botWarcraftLogsDiscoverySchema = z.object({
  channelId: snowflake,
  messageId: snowflake,
  authorId: snowflake,
  reportCode: z.string().regex(WARCRAFT_LOGS_REPORT_CODE),
});

/**
 * POST /api/bot/warcraft-logs/discoveries
 *
 * The trusted log bot posted a Warcraft Logs report link in a dedicated log
 * channel. The server re-checks that the channel is configured and the author
 * trusted, then records the link durably (idempotent per message + report).
 * Matching it to Runs happens on the server's own discovery pass.
 */
export async function POST(request: NextRequest) {
  try {
    assertBotServiceAuthorized(request);
    const body = botWarcraftLogsDiscoverySchema.parse(await request.json());
    return botApiOk(await warcraftLogsDiscoveryService.record(body));
  } catch (error) {
    return botApiError(error);
  }
}
