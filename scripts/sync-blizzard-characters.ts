import "dotenv/config";
import { db } from "@/lib/prisma";
import { isDomainError } from "@/lib/errors";
import { scheduledCharacterSyncService } from "@/services/scheduled-character-sync.service";

/**
 * One-shot scheduled Blizzard character sync entrypoint. One invocation =
 * one sync cycle, then the process exits. External schedulers should tick
 * about every ~15 minutes; Characters become sync candidates only after the
 * ~120-minute stale threshold (BLIZZARD_SYNC_STALE_MINUTES). The app never
 * owns a timer. See docs/features/scheduled-character-sync.md.
 *
 * Usage:
 *   npm run sync:characters
 *   npm run sync:characters -- --dry-run
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) {
    const result = await scheduledCharacterSyncService.dryRun();
    if (result.status === "SKIPPED_ALREADY_RUNNING") {
      console.info("[sync:characters] dry run: another sync cycle is already running. Skipped.");
      return;
    }
    console.info(
      `[sync:characters] dry run: ${result.totalCandidates} candidate(s) across ` +
        `${result.distinctUsers} user(s) and ${result.distinctConnections} connection(s). ` +
        `By region: ${JSON.stringify(result.byRegion)}`,
    );
    return;
  }

  const result = await scheduledCharacterSyncService.runOnce();
  if (result.status === "SKIPPED_ALREADY_RUNNING") {
    console.info("[sync:characters] another sync cycle is already running. Skipped.");
    return;
  }

  console.info(
    `[sync:characters] completed in ${result.durationMs}ms — ` +
      `${result.refreshed}/${result.totalCandidates} refreshed, ` +
      `${result.lockoutsVerified} lockouts verified, ${result.lockoutsUnavailable} lockouts unavailable, ` +
      `${result.failed} failed (${result.profileUnavailable} Blizzard profile unavailable), ${result.rateLimited} rate-limited, ` +
      `${result.connectionsUpdated} connection(s) marked synced.`,
  );
}

main()
  .catch((error: unknown) => {
    if (isDomainError(error)) {
      console.error(`[sync:characters] ${error.code}: ${error.message}`);
    } else {
      console.error("[sync:characters] unrecoverable error:", error instanceof Error ? error.message : error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
