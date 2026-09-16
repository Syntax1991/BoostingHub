import { describe, expect, it } from "vitest";
import { formatBulkWarcraftLogsDiscoveryMessage } from "@/lib/warcraft-logs/bulk-discovery-message";
import type { CharacterWarcraftLogsBatchSummary } from "@/services/character-warcraft-logs.service";

function summary(partial: Partial<CharacterWarcraftLogsBatchSummary>): CharacterWarcraftLogsBatchSummary {
  return {
    total: 0,
    attempted: 0,
    linked: 0,
    alreadyLinked: 0,
    notFound: 0,
    mismatch: 0,
    unsupportedRegion: 0,
    temporaryFailure: 0,
    skippedAfterFailure: 0,
    ...partial,
  };
}

describe("formatBulkWarcraftLogsDiscoveryMessage", () => {
  it("formats all-linked results", () => {
    expect(formatBulkWarcraftLogsDiscoveryMessage(summary({ linked: 3, total: 3, attempted: 3 }))).toBe(
      "3 Warcraft Logs characters linked.",
    );
    expect(formatBulkWarcraftLogsDiscoveryMessage(summary({ linked: 1, total: 1, attempted: 1 }))).toBe(
      "1 Warcraft Logs character linked.",
    );
  });

  it("formats mixed linked + not found", () => {
    expect(
      formatBulkWarcraftLogsDiscoveryMessage(summary({ linked: 3, notFound: 2, total: 5, attempted: 5 })),
    ).toBe("3 linked · 2 not found.");
  });

  it("formats temporary failure with skipped remainder", () => {
    expect(
      formatBulkWarcraftLogsDiscoveryMessage(
        summary({ linked: 2, temporaryFailure: 1, skippedAfterFailure: 5, total: 8, attempted: 3 }),
      ),
    ).toBe("2 linked before Warcraft Logs became unavailable · 5 skipped.");
  });

  it("includes mismatch in the mixed summary", () => {
    expect(
      formatBulkWarcraftLogsDiscoveryMessage(
        summary({ linked: 1, mismatch: 1, total: 2, attempted: 2 }),
      ),
    ).toBe("1 linked · 1 mismatch.");
  });

  it("falls back when nothing linked", () => {
    expect(formatBulkWarcraftLogsDiscoveryMessage(summary({ notFound: 2, total: 2, attempted: 2 }))).toBe(
      "2 not found.",
    );
  });
});
