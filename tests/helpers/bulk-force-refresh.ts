import { orm } from "@/lib/prisma";
import { activityRepository } from "@/repositories/activity.repository";
import { BULK_FORCE_REFRESH_COOLDOWN_MS, BULK_FORCE_REFRESH_STARTED_EVENT } from "@/services/character-operations.service";
import { assertIsolatedTestDatabase } from "@tests/fixtures/db-fixtures";

/**
 * Force refresh all has one community-wide cooldown, read from the newest
 * BULK_FORCE_REFRESH_STARTED event of any admin. Suites start bulk runs with
 * their own admin and remove only that admin's markers, so they never delete
 * a marker someone else wrote.
 */

/** Fails, naming the marker, when any admin's bulk run is still inside the cooldown. */
export async function expectBulkRefreshCooldownElapsed(): Promise<void> {
  const latest = await activityRepository.findLatestByType(BULK_FORCE_REFRESH_STARTED_EVENT);
  if (latest && Date.now() - Date.parse(latest.occurredAt) < BULK_FORCE_REFRESH_COOLDOWN_MS) {
    throw new Error(
      `Force refresh all marker ${latest.id} from ${latest.occurredAt} is inside the cooldown. ` +
        "A suite that wrote it did not remove it; this suite does not delete markers it did not write.",
    );
  }
}

/** Removes the markers `adminId`'s bulk runs wrote, ending the cooldown they started. */
export async function deleteBulkRefreshMarkers(adminId: string): Promise<void> {
  assertIsolatedTestDatabase();
  await orm.ActivityEvent.where({ type: BULK_FORCE_REFRESH_STARTED_EVENT, userId: adminId }).deleteAndCount();
}
