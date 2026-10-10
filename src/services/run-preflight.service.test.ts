import { describe, expect, it } from "vitest";
import {
  buildRunPreflight,
  summarizePreflightChecks,
  type PreflightCheck,
  type RunPreflightContext,
} from "@/services/run-preflight.service";
import type { RosterManagementView } from "@/services/roster.service";

function check(status: PreflightCheck["status"], id: string = status): PreflightCheck {
  return { id, label: id, status, summary: id };
}

describe("summarizePreflightChecks", () => {
  it("returns READY when all checks pass", () => {
    expect(summarizePreflightChecks([check("PASS"), check("PASS")])).toEqual({
      overall: "READY",
      attentionCount: 0,
    });
  });

  it("returns ATTENTION for warnings without errors", () => {
    expect(summarizePreflightChecks([check("PASS"), check("WARNING")])).toEqual({
      overall: "ATTENTION",
      attentionCount: 1,
    });
  });

  it("returns BLOCKED when any ERROR is present", () => {
    expect(summarizePreflightChecks([check("WARNING"), check("ERROR"), check("PASS")])).toEqual({
      overall: "BLOCKED",
      attentionCount: 2,
    });
  });

  it("counts every non-PASS check when blocked", () => {
    expect(
      summarizePreflightChecks([check("ERROR", "a"), check("ERROR", "b"), check("WARNING", "c")]).attentionCount,
    ).toBe(3);
  });
});

const NOW = new Date("2026-10-10T18:00:00.000Z");
const FRESH = "2026-10-10T17:00:00.000Z";
const STALE = "2026-10-09T10:00:00.000Z";

type BoosterFixture = {
  id: string;
  name: string;
  draftSelected?: boolean;
  status?: string;
  lastSyncedAt?: string | null;
  lastSyncErrorAt?: string | null;
  conflicted?: boolean;
  savedLabel?: string;
};

function booster(input: BoosterFixture) {
  return {
    id: input.id,
    userName: input.name,
    status: input.status ?? "SELECTED",
    draftSelected: input.draftSelected ?? true,
    character: {
      name: input.name,
      realm: "Antonidas",
      lastSyncedAt: input.lastSyncedAt === undefined ? FRESH : input.lastSyncedAt,
      lastSyncErrorAt: input.lastSyncErrorAt ?? null,
    },
    scheduleConflicts: input.conflicted ? [{ type: "RESERVED" }] : [],
    selectionRisk: {
      level: input.savedLabel ? "WARNING" : "CLEAN",
      blockers: [],
      warnings: input.savedLabel
        ? [{ type: "LOCKOUT_ATTENTION", fingerprint: "f", contents: [{ labelText: input.savedLabel }] }]
        : [],
    },
  };
}

function slot(selected: number, target: number) {
  return { selected, target, delta: selected - target };
}

type ContextOverrides = {
  status?: RunPreflightContext["run"]["status"];
  raidLeadId?: string | null;
  publishedAt?: string | null;
  needsPublishSeed?: boolean;
  hasUnpublishedChanges?: boolean;
  publishedSelectedCount?: number;
  blockers?: Array<{ code: string; message: string; signupId?: string }>;
};

function context(boosters: ReturnType<typeof booster>[], overrides: ContextOverrides = {}): RunPreflightContext {
  const manager = {
    run: { publishedSelectedCount: overrides.publishedSelectedCount ?? boosters.length },
    roster: {
      publishedAt: overrides.publishedAt === undefined ? "2026-10-09T12:00:00.000Z" : overrides.publishedAt,
      needsPublishSeed: overrides.needsPublishSeed ?? false,
      hasUnpublishedChanges: overrides.hasUnpublishedChanges ?? false,
      externalBoosters: [],
    },
    validation: {
      composition: {
        tanks: slot(0, 0),
        healers: slot(0, 0),
        dps: slot(boosters.length, boosters.length),
        lootbuddies: slot(0, 0),
        boosterTotal: boosters.length,
        total: boosters.length,
      },
      blockers: overrides.blockers ?? [],
      warnings: [],
    },
    boosters,
  } as unknown as RosterManagementView;
  return {
    runId: "run-1",
    run: {
      status: overrides.status ?? "PUBLISHED",
      raidLeadId: overrides.raidLeadId === undefined ? "lead-1" : overrides.raidLeadId,
      raidLeadName: "Lead",
      signupsOpen: false,
    },
    manager,
    discordPost: { runChannelId: "c", signupMessageId: "m" },
    recentDiscordHasError: false,
    now: NOW,
    syncStaleMinutes: 120,
  };
}

function find(result: ReturnType<typeof buildRunPreflight>, id: string) {
  return result.checks.find((item) => item.id === id);
}

describe("buildRunPreflight selected Character checks", () => {
  it("is READY when selected Characters are clean and freshly synced", () => {
    const result = buildRunPreflight(context([booster({ id: "s1", name: "Synmist" })]));
    expect(result.overall).toBe("READY");
    expect(find(result, "selected_schedule_conflicts")?.status).toBe("PASS");
    expect(find(result, "selected_lockouts")?.status).toBe("PASS");
    expect(find(result, "selected_blizzard_sync")?.status).toBe("PASS");
  });

  it("warns about schedule conflicts without blocking", () => {
    const result = buildRunPreflight(context([booster({ id: "s1", name: "Synmist", conflicted: true })]));
    const item = find(result, "selected_schedule_conflicts");
    expect(item?.status).toBe("WARNING");
    expect(item?.summary).toContain("Synmist-Antonidas");
    expect(result.overall).toBe("ATTENTION");
  });

  it("warns about saved lockouts with the canonical label", () => {
    const result = buildRunPreflight(context([booster({ id: "s1", name: "Synmist", savedLabel: "HC 6/8 · Saved" })]));
    const item = find(result, "selected_lockouts");
    expect(item?.status).toBe("WARNING");
    expect(item?.summary).toContain("Synmist-Antonidas (HC 6/8 · Saved)");
  });

  it("warns about stale, never-synced and failed Blizzard syncs", () => {
    const result = buildRunPreflight(
      context([
        booster({ id: "s1", name: "Stale", lastSyncedAt: STALE }),
        booster({ id: "s2", name: "Never", lastSyncedAt: null }),
        booster({ id: "s3", name: "Failed", lastSyncedAt: STALE, lastSyncErrorAt: FRESH }),
        booster({ id: "s4", name: "Fresh" }),
      ]),
    );
    const item = find(result, "selected_blizzard_sync");
    expect(item?.status).toBe("WARNING");
    expect(item?.summary).toContain("3 selected Character(s)");
    expect(item?.summary).not.toContain("Fresh-Antonidas");
  });

  it("ignores unselected and withdrawn signups", () => {
    const result = buildRunPreflight(
      context([
        booster({ id: "s1", name: "Clean" }),
        booster({ id: "s2", name: "Bench", draftSelected: false, status: "NOT_SELECTED", conflicted: true }),
        booster({ id: "s3", name: "Gone", status: "WITHDRAWN", savedLabel: "HC 8/8 · Saved" }),
      ]),
    );
    expect(result.overall).toBe("READY");
  });

  it("truncates long name lists", () => {
    const result = buildRunPreflight(
      context(
        Array.from({ length: 7 }, (_, index) => booster({ id: `s${index}`, name: `C${index}`, lastSyncedAt: null })),
      ),
    );
    expect(find(result, "selected_blizzard_sync")?.summary).toContain("+2 more");
  });
});

describe("buildRunPreflight ERROR mirrors server Start rules only", () => {
  const clean = () => [booster({ id: "s1", name: "Synmist" })];
  const errorIds = (result: ReturnType<typeof buildRunPreflight>) =>
    result.checks.filter((item) => item.status === "ERROR").map((item) => item.id);

  it("blocks a Run that is not PUBLISHED", () => {
    expect(errorIds(buildRunPreflight(context(clean(), { status: "ROSTERING" })))).toContain("run_status");
  });

  it("blocks without a published roster", () => {
    expect(errorIds(buildRunPreflight(context(clean(), { publishedAt: null })))).toContain("roster_published");
  });

  it("blocks with unpublished roster changes", () => {
    expect(errorIds(buildRunPreflight(context(clean(), { hasUnpublishedChanges: true })))).toEqual([
      "unpublished_changes",
    ]);
  });

  it("blocks without a published selected participant", () => {
    expect(errorIds(buildRunPreflight(context([], { publishedSelectedCount: 0 })))).toEqual(["selected_entries"]);
  });

  it("only warns for missing Raid Lead, unseeded draft and draft publish blockers", () => {
    const result = buildRunPreflight(
      context(clean(), {
        raidLeadId: null,
        needsPublishSeed: true,
        blockers: [{ code: "CHARACTER_INACTIVE", message: "Synmist is inactive.", signupId: "s1" }],
      }),
    );
    expect(errorIds(result)).toEqual([]);
    expect(result.overall).toBe("ATTENTION");
    expect(find(result, "raid_lead")?.status).toBe("WARNING");
    expect(find(result, "roster_published")?.status).toBe("WARNING");
    expect(find(result, "publish_blocker:CHARACTER_INACTIVE:s1")?.status).toBe("WARNING");
  });
});
