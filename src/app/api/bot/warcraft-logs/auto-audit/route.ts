import type { NextRequest } from "next/server";
import { assertBotServiceAuthorized } from "@/auth/bot-auth";
import { botApiError, botApiOk } from "@/lib/bot-api-result";
import { runConsumableAutoAuditService } from "@/services/run-consumable-auto-audit.service";
import { warcraftLogsDiscoveryService } from "@/services/warcraft-logs-discovery.service";

/**
 * POST /api/bot/warcraft-logs/auto-audit
 *
 * The bot's ~5 min Warcraft Logs tick: first one bounded pass matching
 * reports found in dedicated log channels to Runs (so a report linked now is
 * audited in the same tick), then one bounded pass of the automatic
 * post-completion Consumables Audit. Each pass has its own advisory lock;
 * overlapping passes are skipped.
 */
export async function POST(request: NextRequest) {
  try {
    assertBotServiceAuthorized(request);
    const discovery = await warcraftLogsDiscoveryService.runDuePass();
    const audit = await runConsumableAutoAuditService.runDuePass();
    return botApiOk({ discovery, audit });
  } catch (error) {
    return botApiError(error);
  }
}
