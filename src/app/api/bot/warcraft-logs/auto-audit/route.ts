import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { runConsumableAutoAuditService } from "@/services/run-consumable-auto-audit.service";

/**
 * POST /api/bot/warcraft-logs/auto-audit
 *
 * One bounded pass of the automatic post-completion Consumables Audit,
 * triggered by the Discord bot's timer. Overlapping passes are skipped by an
 * advisory lock; per-Run delay/attempt limits live in the service.
 */
export async function POST(request: NextRequest) {
  try {
    assertBotServiceAuthorized(request);
    return botApiOk(await runConsumableAutoAuditService.runDuePass());
  } catch (error) {
    return botApiError(error);
  }
}
