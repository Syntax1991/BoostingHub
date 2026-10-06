import "dotenv/config";
import { db } from "@/lib/prisma";
import { isDomainError } from "@/lib/errors";
import { communityScheduleMaterializationService } from "@/services/community-schedule-materialization.service";

/**
 * One-shot community schedule DRAFT materialization pass.
 *
 * Usage:
 *   npm run materialize:community-schedule
 */
async function main() {
  const result = await communityScheduleMaterializationService.runPass();
  if (result.status === "SKIPPED_ALREADY_RUNNING") {
    console.info("[materialize:community-schedule] another pass is already running. Skipped.");
    return;
  }

  console.info(
    `[materialize:community-schedule] completed in ${result.durationMs}ms — ` +
      `slots=${result.slots} considered=${result.occurrencesConsidered} created=${result.created} ` +
      `already=${result.alreadyCreated} skippedPast=${result.skippedPast} ` +
      `skippedInactive=${result.skippedInactive} skippedNoTemplate=${result.skippedNoTemplate} ` +
      `skippedTemplateUnusable=${result.skippedTemplateUnusable} failed=${result.failed}`,
  );
}

main()
  .catch((error: unknown) => {
    if (isDomainError(error)) {
      console.error(`[materialize:community-schedule] ${error.code}: ${error.message}`);
    } else {
      console.error(
        "[materialize:community-schedule] unrecoverable error:",
        error instanceof Error ? error.message : error,
      );
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
