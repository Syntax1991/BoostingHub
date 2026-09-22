import type { RaidDifficulty, RunLootType } from "@/models/enums";
import {
  runCancelledChannelSourceKey,
  runDiscordAnnouncementRepository,
  runRescheduledChannelSourceKey,
  type RunDiscordAnnouncementRecord,
} from "@/repositories/run-discord-announcement.repository";

/**
 * Creates durable Run-channel lifecycle announcements.
 * Orthogonal to UserNotification / DM preferences.
 */
export const runDiscordAnnouncementService = {
  async enqueueRescheduled(input: {
    runId: string;
    scheduleRevision: number;
    previousScheduledStartAt: string;
    scheduledStartAt: string;
    productLabel: string;
    difficulty: RaidDifficulty;
    lootType: RunLootType;
  }): Promise<RunDiscordAnnouncementRecord | null> {
    return runDiscordAnnouncementRepository.createIgnoreDuplicate({
      runId: input.runId,
      type: "RUN_RESCHEDULED",
      sourceKey: runRescheduledChannelSourceKey(input.runId, input.scheduleRevision),
      previousScheduledStartAt: input.previousScheduledStartAt,
      scheduledStartAt: input.scheduledStartAt,
      productLabel: input.productLabel,
      difficulty: input.difficulty,
      lootType: input.lootType,
      status: "PENDING",
    });
  },

  async enqueueCancelled(input: {
    runId: string;
    scheduledStartAt: string;
    productLabel: string;
    difficulty: RaidDifficulty;
    lootType: RunLootType;
  }): Promise<RunDiscordAnnouncementRecord | null> {
    return runDiscordAnnouncementRepository.createIgnoreDuplicate({
      runId: input.runId,
      type: "RUN_CANCELLED",
      sourceKey: runCancelledChannelSourceKey(input.runId),
      previousScheduledStartAt: null,
      scheduledStartAt: input.scheduledStartAt,
      productLabel: input.productLabel,
      difficulty: input.difficulty,
      lootType: input.lootType,
      status: "PENDING",
    });
  },
};
