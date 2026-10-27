import "dotenv/config";
import { db } from "@/lib/prisma";
import { isDomainError } from "@/lib/errors";
import { characterOperationsService } from "@/services/character-operations.service";

/**
 * One-shot "Link Battle.net matches" pass — the same exact-match backfill as
 * the Manage → Characters button, run by boostinghub-battlenet-links.timer.
 *
 * Usage:
 *   npm run reconcile:battlenet-links
 */
async function main() {
  const result = await characterOperationsService.runBattleNetLinkReconcile(null);
  console.info(
    `[reconcile:battlenet-links] completed in ${result.durationMs}ms — ` +
      `connections=${result.connections} reconciled=${result.reconciled} linked=${result.linked} ` +
      `already=${result.alreadyLinked} skipped=${result.skipped} failed=${result.failed} ` +
      `noSnapshot=${result.noSnapshot} errors=${result.connectionErrors}`,
  );
}

main()
  .catch((error: unknown) => {
    if (isDomainError(error)) {
      console.error(`[reconcile:battlenet-links] ${error.code}: ${error.message}`);
    } else {
      console.error(
        "[reconcile:battlenet-links] unrecoverable error:",
        error instanceof Error ? error.message : error,
      );
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
