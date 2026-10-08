import { describe, expect, it } from "vitest";
import { projectRunContentLockouts } from "@/lib/run-content-lockouts";
import { TIDEBOUND_GROTTO_RAID_ID, VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import type { RunLootType } from "@/models/enums";
import type { SignupRaidSaveInfo } from "@/models/records";
import type { CharacterScheduleConflict } from "@/services/character-schedule-conflict";
import {
  classifyRosterSelectionRisk,
  formatWarningContentProgress,
  lockoutAttentionWarning,
  unacknowledgedWarnings,
} from "@/services/roster-selection-risk";

/**
 * The shared CLEAN / WARNING / BLOCKED classifier is a pure composition of the
 * existing lockout-label authority (via projectRunContentLockouts) and the
 * schedule-conflict projection. These tests feed it REAL label projections so
 * the loot-type semantics under test are the canonical ones, not a re-statement.
 */

const RESET = "2026-W41";

const venomous = { raidId: VENOMOUS_ABYSS_RAID_ID, raidName: "The Venomous Abyss", sortOrder: 2, plannedBossCount: 8, totalBossCount: 8 };
const tidebound = { raidId: TIDEBOUND_GROTTO_RAID_ID, raidName: "The Tidebound Grotto", sortOrder: 1, plannedBossCount: 1, totalBossCount: 1 };

function save(raidId: string, bossesDefeated: number, totalBossCount: number): SignupRaidSaveInfo {
  return {
    raidId,
    difficulty: "HEROIC",
    resetIdentifier: RESET,
    bossesDefeated,
    totalBossCount,
    isComplete: bossesDefeated >= totalBossCount,
  };
}

function contentSaves(
  saves: Record<string, SignupRaidSaveInfo | null>,
  options: { lootType?: RunLootType; contents?: Array<typeof venomous> } = {},
) {
  return projectRunContentLockouts({
    contents: options.contents ?? [venomous],
    difficulty: "HEROIC",
    lootType: options.lootType ?? "UNSAVED",
    findSave: (content) => saves[content.raidId] ?? null,
  });
}

const reservation: CharacterScheduleConflict = {
  source: "RUN_RESERVATION",
  conflictingRunId: "run-b",
  conflictingRunTitle: "Other Run",
  conflictingScheduledStartAt: "2026-10-09T18:00:00.000Z",
  message: "Another Manawyrm Hub Run: Other Run",
};

const weeklyUnavailable: CharacterScheduleConflict = {
  source: "WEEKLY_UNAVAILABLE",
  resetIdentifier: RESET,
  difficulty: "HEROIC",
  message: "Marked unavailable.",
};

describe("classifyRosterSelectionRisk", () => {
  it("verified unsaved (0/8) is CLEAN", () => {
    const risk = classifyRosterSelectionRisk({
      scheduleConflicts: [],
      contentSaves: contentSaves({ [VENOMOUS_ABYSS_RAID_ID]: save(VENOMOUS_ABYSS_RAID_ID, 0, 8) }),
    });
    expect(risk).toEqual({ level: "CLEAN", blockers: [], warnings: [] });
  });

  it("unknown lockout (no verified row) is CLEAN for confirmation purposes, even though the label stays attention-yellow", () => {
    const saves = contentSaves({});
    // The existing UI authority still marks Unknown as attention on a fresh-loot Run…
    expect(saves[0]!.label.kind).toBe("unknown");
    expect(saves[0]!.label.attention).toBe(true);
    // …but it never requires a confirmation.
    const risk = classifyRosterSelectionRisk({ scheduleConflicts: [], contentSaves: saves });
    expect(risk.level).toBe("CLEAN");
    expect(risk.warnings).toHaveLength(0);
  });

  it("saved (6/8) on a fresh-loot Run is WARNING with the affected content", () => {
    const risk = classifyRosterSelectionRisk({
      scheduleConflicts: [],
      contentSaves: contentSaves({ [VENOMOUS_ABYSS_RAID_ID]: save(VENOMOUS_ABYSS_RAID_ID, 6, 8) }),
    });
    expect(risk.level).toBe("WARNING");
    expect(risk.blockers).toHaveLength(0);
    expect(risk.warnings).toHaveLength(1);
    expect(risk.warnings[0]!.type).toBe("LOCKOUT_ATTENTION");
    expect(risk.warnings[0]!.contents).toEqual([
      {
        raidId: VENOMOUS_ABYSS_RAID_ID,
        raidName: "The Venomous Abyss",
        sortOrder: 2,
        kind: "saved",
        bossesDefeated: 6,
        totalBossCount: 8,
        labelText: "HC 6/8 · Saved",
      },
    ]);
    expect(formatWarningContentProgress(risk.warnings[0]!.contents[0]!)).toBe("6/8 saved");
  });

  it("fully saved (8/8) on a fresh-loot Run is WARNING", () => {
    const risk = classifyRosterSelectionRisk({
      scheduleConflicts: [],
      contentSaves: contentSaves({ [VENOMOUS_ABYSS_RAID_ID]: save(VENOMOUS_ABYSS_RAID_ID, 8, 8) }),
    });
    expect(risk.level).toBe("WARNING");
    expect(risk.warnings[0]!.contents[0]!.kind).toBe("fully_saved");
    expect(formatWarningContentProgress(risk.warnings[0]!.contents[0]!)).toBe("8/8 fully saved");
  });

  it.each(["UNSAVED", "VIP", "COMMUNITY"] as const)("%s Runs warn on existing progress", (lootType) => {
    const risk = classifyRosterSelectionRisk({
      scheduleConflicts: [],
      contentSaves: contentSaves({ [VENOMOUS_ABYSS_RAID_ID]: save(VENOMOUS_ABYSS_RAID_ID, 3, 8) }, { lootType }),
    });
    expect(risk.level).toBe("WARNING");
  });

  it("a SAVED loot-type Run follows the existing attention semantics: progress is expected, never a warning", () => {
    for (const bossesDefeated of [3, 8]) {
      const risk = classifyRosterSelectionRisk({
        scheduleConflicts: [],
        contentSaves: contentSaves(
          { [VENOMOUS_ABYSS_RAID_ID]: save(VENOMOUS_ABYSS_RAID_ID, bossesDefeated, 8) },
          { lootType: "SAVED" },
        ),
      });
      expect(risk.level).toBe("CLEAN");
      expect(risk.warnings).toHaveLength(0);
    }
  });

  it("BLOCKED wins: a schedule conflict plus a saved lockout is BLOCKED, and keeps the conflict as the blocker", () => {
    const risk = classifyRosterSelectionRisk({
      scheduleConflicts: [reservation],
      contentSaves: contentSaves({ [VENOMOUS_ABYSS_RAID_ID]: save(VENOMOUS_ABYSS_RAID_ID, 6, 8) }),
    });
    expect(risk.level).toBe("BLOCKED");
    expect(risk.blockers).toEqual([reservation]);
  });

  it("weekly unavailability is BLOCKED like a cross-Run reservation", () => {
    const risk = classifyRosterSelectionRisk({
      scheduleConflicts: [weeklyUnavailable],
      contentSaves: contentSaves({ [VENOMOUS_ABYSS_RAID_ID]: save(VENOMOUS_ABYSS_RAID_ID, 0, 8) }),
    });
    expect(risk.level).toBe("BLOCKED");
  });

  it("Bundle: every saved RunRaidContent is its own warning content, in content order — never summed to 7/9", () => {
    const risk = classifyRosterSelectionRisk({
      scheduleConflicts: [],
      contentSaves: contentSaves(
        {
          [TIDEBOUND_GROTTO_RAID_ID]: save(TIDEBOUND_GROTTO_RAID_ID, 1, 1),
          [VENOMOUS_ABYSS_RAID_ID]: save(VENOMOUS_ABYSS_RAID_ID, 6, 8),
        },
        { contents: [venomous, tidebound] },
      ),
    });
    expect(risk.level).toBe("WARNING");
    expect(risk.warnings).toHaveLength(1);
    expect(
      risk.warnings[0]!.contents.map((content) => `${content.raidName} · ${formatWarningContentProgress(content)}`),
    ).toEqual(["The Tidebound Grotto · 1/1 fully saved", "The Venomous Abyss · 6/8 saved"]);
  });

  it("multi-content mixed state: only the known-saved content warns (unsaved and unknown contents are left out)", () => {
    const unsavedTide = classifyRosterSelectionRisk({
      scheduleConflicts: [],
      contentSaves: contentSaves(
        {
          [TIDEBOUND_GROTTO_RAID_ID]: save(TIDEBOUND_GROTTO_RAID_ID, 0, 1),
          [VENOMOUS_ABYSS_RAID_ID]: save(VENOMOUS_ABYSS_RAID_ID, 6, 8),
        },
        { contents: [tidebound, venomous] },
      ),
    });
    expect(unsavedTide.warnings[0]!.contents.map((content) => content.raidId)).toEqual([VENOMOUS_ABYSS_RAID_ID]);

    const unknownVenomous = classifyRosterSelectionRisk({
      scheduleConflicts: [],
      contentSaves: contentSaves(
        { [TIDEBOUND_GROTTO_RAID_ID]: save(TIDEBOUND_GROTTO_RAID_ID, 1, 1) },
        { contents: [tidebound, venomous] },
      ),
    });
    expect(unknownVenomous.level).toBe("WARNING");
    expect(unknownVenomous.warnings[0]!.contents.map((content) => content.raidId)).toEqual([TIDEBOUND_GROTTO_RAID_ID]);

    const nothingKnownSaved = classifyRosterSelectionRisk({
      scheduleConflicts: [],
      contentSaves: contentSaves(
        { [TIDEBOUND_GROTTO_RAID_ID]: save(TIDEBOUND_GROTTO_RAID_ID, 0, 1) },
        { contents: [tidebound, venomous] },
      ),
    });
    expect(nothingKnownSaved.level).toBe("CLEAN");
  });
});

describe("warning fingerprint and acknowledgement", () => {
  const sixOfEight = lockoutAttentionWarning(
    contentSaves({ [VENOMOUS_ABYSS_RAID_ID]: save(VENOMOUS_ABYSS_RAID_ID, 6, 8) }),
  )!;

  it("is stable for the same lockout state", () => {
    const again = lockoutAttentionWarning(
      contentSaves({ [VENOMOUS_ABYSS_RAID_ID]: save(VENOMOUS_ABYSS_RAID_ID, 6, 8) }),
    )!;
    expect(again.fingerprint).toBe(sixOfEight.fingerprint);
  });

  it("changes when progress changes, when a saved raid is added, and across resets", () => {
    const sevenOfEight = lockoutAttentionWarning(
      contentSaves({ [VENOMOUS_ABYSS_RAID_ID]: save(VENOMOUS_ABYSS_RAID_ID, 7, 8) }),
    )!;
    const withTide = lockoutAttentionWarning(
      contentSaves(
        {
          [TIDEBOUND_GROTTO_RAID_ID]: save(TIDEBOUND_GROTTO_RAID_ID, 1, 1),
          [VENOMOUS_ABYSS_RAID_ID]: save(VENOMOUS_ABYSS_RAID_ID, 6, 8),
        },
        { contents: [tidebound, venomous] },
      ),
    )!;
    const otherReset = lockoutAttentionWarning(
      contentSaves({
        [VENOMOUS_ABYSS_RAID_ID]: { ...save(VENOMOUS_ABYSS_RAID_ID, 6, 8), resetIdentifier: "2026-W42" },
      }),
    )!;
    const fingerprints = new Set([
      sixOfEight.fingerprint,
      sevenOfEight.fingerprint,
      withTide.fingerprint,
      otherReset.fingerprint,
    ]);
    expect(fingerprints.size).toBe(4);
  });

  it("an exact acknowledgement covers the warning; a missing, stale or foreign one does not", () => {
    const risk = classifyRosterSelectionRisk({
      scheduleConflicts: [],
      contentSaves: contentSaves({ [VENOMOUS_ABYSS_RAID_ID]: save(VENOMOUS_ABYSS_RAID_ID, 6, 8) }),
    });
    expect(unacknowledgedWarnings(risk, [])).toHaveLength(1);
    expect(
      unacknowledgedWarnings(risk, [{ type: "LOCKOUT_ATTENTION", fingerprint: sixOfEight.fingerprint }]),
    ).toHaveLength(0);
    // Acknowledged at 5/8, now 6/8 → must be confirmed again.
    const stale = lockoutAttentionWarning(
      contentSaves({ [VENOMOUS_ABYSS_RAID_ID]: save(VENOMOUS_ABYSS_RAID_ID, 5, 8) }),
    )!;
    expect(unacknowledgedWarnings(risk, [{ type: "LOCKOUT_ATTENTION", fingerprint: stale.fingerprint }])).toHaveLength(1);
  });

  it("acknowledgements for a state that is now CLEAN are simply ignored", () => {
    const clean = classifyRosterSelectionRisk({
      scheduleConflicts: [],
      contentSaves: contentSaves({ [VENOMOUS_ABYSS_RAID_ID]: save(VENOMOUS_ABYSS_RAID_ID, 0, 8) }),
    });
    expect(
      unacknowledgedWarnings(clean, [{ type: "LOCKOUT_ATTENTION", fingerprint: sixOfEight.fingerprint }]),
    ).toHaveLength(0);
  });
});
