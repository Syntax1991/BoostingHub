import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SCHEDULE_EMPTY_DESCRIPTION,
  SCHEDULE_MESSAGE_FORMAT_VERSION,
  buildScheduleDescription,
  buildScheduleEmbed,
  buildScheduleSignature,
  filterAndSortScheduleRuns,
  formatScheduleRunLine,
  isScheduleEligibleStatus,
  scheduleBucketForRun,
  scheduleTitle,
  sortScheduleRuns,
  type ScheduleRunRenderInput,
} from "@/lib/discord-schedule";

/** Thursday 2026-01-15 12:00 UTC — same winter fixture as wow-run-week.test.ts. */
const NOW = new Date("2026-01-15T12:00:00.000Z");
const CURRENT_AT = "2026-01-16T18:00:00.000Z"; // Fri CURRENT
const CURRENT_LATER = "2026-01-17T18:00:00.000Z"; // Sat CURRENT
const NEXT_AT = "2026-01-22T18:00:00.000Z"; // Thu NEXT week
const PAST_AT = "2026-01-13T18:00:00.000Z";
const FUTURE_AT = "2026-01-29T18:00:00.000Z";

function run(partial: Partial<ScheduleRunRenderInput> & Pick<ScheduleRunRenderInput, "runId" | "scheduledStartAt" | "status">): ScheduleRunRenderInput {
  return {
    difficulty: "HEROIC",
    lootType: "VIP",
    titleCoverage: "8/8",
    raidLeadDisplay: "UwE",
    runChannelId: null,
    ...partial,
  };
}

describe("discord-schedule — status eligibility", () => {
  it.each(["OPEN", "ROSTERING", "PUBLISHED", "IN_PROGRESS"] as const)("%s is eligible", (status) => {
    expect(isScheduleEligibleStatus(status)).toBe(true);
  });

  it.each(["DRAFT", "COMPLETED", "CANCELLED"] as const)("%s is excluded", (status) => {
    expect(isScheduleEligibleStatus(status)).toBe(false);
  });
});

describe("discord-schedule — week buckets (A–J)", () => {
  it("A–D: OPEN/ROSTERING/PUBLISHED/IN_PROGRESS CURRENT map to CURRENT", () => {
    for (const status of ["OPEN", "ROSTERING", "PUBLISHED", "IN_PROGRESS"] as const) {
      expect(scheduleBucketForRun({ scheduledStartAt: CURRENT_AT, status, now: NOW })).toBe("CURRENT");
    }
  });

  it("E: DRAFT excluded", () => {
    expect(scheduleBucketForRun({ scheduledStartAt: CURRENT_AT, status: "DRAFT", now: NOW })).toBeNull();
  });

  it("F: COMPLETED excluded immediately", () => {
    expect(scheduleBucketForRun({ scheduledStartAt: CURRENT_AT, status: "COMPLETED", now: NOW })).toBeNull();
  });

  it("G: CANCELLED excluded immediately", () => {
    expect(scheduleBucketForRun({ scheduledStartAt: CURRENT_AT, status: "CANCELLED", now: NOW })).toBeNull();
  });

  it("H: NEXT active Runs only in NEXT", () => {
    expect(scheduleBucketForRun({ scheduledStartAt: NEXT_AT, status: "OPEN", now: NOW })).toBe("NEXT");
    expect(filterAndSortScheduleRuns([run({ runId: "n1", scheduledStartAt: NEXT_AT, status: "OPEN" })], "CURRENT", NOW)).toHaveLength(0);
    expect(filterAndSortScheduleRuns([run({ runId: "n1", scheduledStartAt: NEXT_AT, status: "OPEN" })], "NEXT", NOW)).toHaveLength(1);
  });

  it("I: PAST excluded", () => {
    expect(scheduleBucketForRun({ scheduledStartAt: PAST_AT, status: "OPEN", now: NOW })).toBeNull();
  });

  it("J: FUTURE beyond NEXT excluded", () => {
    expect(scheduleBucketForRun({ scheduledStartAt: FUTURE_AT, status: "OPEN", now: NOW })).toBeNull();
  });
});

describe("discord-schedule — ordering (K–L)", () => {
  it("K: chronological by scheduledStartAt ASC", () => {
    const sorted = sortScheduleRuns([
      run({ runId: "b", scheduledStartAt: CURRENT_LATER, status: "OPEN" }),
      run({ runId: "a", scheduledStartAt: CURRENT_AT, status: "OPEN" }),
    ]);
    expect(sorted.map((r) => r.runId)).toEqual(["a", "b"]);
  });

  it("L: stable tie-break by run id", () => {
    const sorted = sortScheduleRuns([
      run({ runId: "run-z", scheduledStartAt: CURRENT_AT, status: "OPEN" }),
      run({ runId: "run-a", scheduledStartAt: CURRENT_AT, status: "OPEN" }),
    ]);
    expect(sorted.map((r) => r.runId)).toEqual(["run-a", "run-z"]);
  });
});

describe("discord-schedule — channel mention (M–N)", () => {
  it("M: Run without channel id still renders a line", () => {
    const line = formatScheduleRunLine(run({ runId: "r1", scheduledStartAt: CURRENT_AT, status: "OPEN", runChannelId: null }));
    expect(line).toContain("🟢 Open");
    expect(line).toContain("<t:");
    expect(line).toContain("Heroic VIP 8/8");
    expect(line).toContain("UwE");
    expect(line).not.toContain("<#");
  });

  it("N: Run with channel id shows channel mention", () => {
    const line = formatScheduleRunLine(
      run({ runId: "r1", scheduledStartAt: CURRENT_AT, status: "OPEN", runChannelId: "123456789012345678" }),
    );
    expect(line).toContain("<#123456789012345678>");
  });
});

describe("discord-schedule — reschedule / bucket moves (O–R)", () => {
  const base = [
    run({ runId: "move", scheduledStartAt: CURRENT_AT, status: "OPEN" }),
    run({ runId: "other", scheduledStartAt: CURRENT_LATER, status: "OPEN" }),
  ];

  it("O: same-bucket reschedule reorders", () => {
    const before = filterAndSortScheduleRuns(base, "CURRENT", NOW).map((r) => r.runId);
    expect(before).toEqual(["move", "other"]);
    const after = filterAndSortScheduleRuns(
      [
        run({ runId: "move", scheduledStartAt: "2026-01-18T18:00:00.000Z", status: "OPEN" }),
        run({ runId: "other", scheduledStartAt: CURRENT_LATER, status: "OPEN" }),
      ],
      "CURRENT",
      NOW,
    ).map((r) => r.runId);
    expect(after).toEqual(["other", "move"]);
  });

  it("P: CURRENT → NEXT moves correctly", () => {
    const moved = run({ runId: "move", scheduledStartAt: NEXT_AT, status: "OPEN" });
    expect(filterAndSortScheduleRuns([moved], "CURRENT", NOW)).toHaveLength(0);
    expect(filterAndSortScheduleRuns([moved], "NEXT", NOW).map((r) => r.runId)).toEqual(["move"]);
  });

  it("Q: NEXT → CURRENT moves correctly", () => {
    const moved = run({ runId: "move", scheduledStartAt: CURRENT_AT, status: "OPEN" });
    expect(filterAndSortScheduleRuns([moved], "NEXT", NOW)).toHaveLength(0);
    expect(filterAndSortScheduleRuns([moved], "CURRENT", NOW).map((r) => r.runId)).toEqual(["move"]);
  });

  it("R: moving outside both buckets removes Run", () => {
    const past = run({ runId: "move", scheduledStartAt: PAST_AT, status: "OPEN" });
    const future = run({ runId: "move", scheduledStartAt: FUTURE_AT, status: "OPEN" });
    expect(filterAndSortScheduleRuns([past], "CURRENT", NOW)).toHaveLength(0);
    expect(filterAndSortScheduleRuns([past], "NEXT", NOW)).toHaveLength(0);
    expect(filterAndSortScheduleRuns([future], "CURRENT", NOW)).toHaveLength(0);
    expect(filterAndSortScheduleRuns([future], "NEXT", NOW)).toHaveLength(0);
  });
});

describe("discord-schedule — embed / signature (U–Z)", () => {
  it("empty bucket description is the empty state (U)", () => {
    const embed = buildScheduleEmbed({ bucket: "CURRENT", runs: [] });
    expect(embed.title).toBe(scheduleTitle("CURRENT"));
    expect(embed.description).toBe(SCHEDULE_EMPTY_DESCRIPTION);
    expect(buildScheduleDescription([])).toBe(SCHEDULE_EMPTY_DESCRIPTION);
  });

  it("V: unchanged signature is stable", () => {
    const runs = [run({ runId: "a", scheduledStartAt: CURRENT_AT, status: "OPEN" })];
    expect(buildScheduleSignature({ bucket: "CURRENT", runs })).toBe(
      buildScheduleSignature({ bucket: "CURRENT", runs: [...runs] }),
    );
  });

  it("W: changed fields change the signature", () => {
    const a = buildScheduleSignature({
      bucket: "CURRENT",
      runs: [run({ runId: "a", scheduledStartAt: CURRENT_AT, status: "OPEN" })],
    });
    const b = buildScheduleSignature({
      bucket: "CURRENT",
      runs: [run({ runId: "a", scheduledStartAt: CURRENT_AT, status: "ROSTERING" })],
    });
    expect(a).not.toBe(b);
  });

  it("Y: CURRENT and NEXT titles differ; one embed each", () => {
    expect(scheduleTitle("CURRENT")).toBe("📅 Current Raid ID — Schedule");
    expect(scheduleTitle("NEXT")).toBe("📅 Next Raid ID — Schedule");
    expect(SCHEDULE_MESSAGE_FORMAT_VERSION).toBe("v1");
  });

  it("Z: format-version bump changes the signature once", () => {
    const runs = [run({ runId: "a", scheduledStartAt: CURRENT_AT, status: "OPEN", runChannelId: "c1" })];
    const current = buildScheduleSignature({ bucket: "CURRENT", runs });
    const bumpedPayload = {
      v: "v2",
      bucket: "CURRENT",
      runs: runs.map((r) => ({
        runId: r.runId,
        scheduledStartAt: r.scheduledStartAt,
        status: r.status,
        difficulty: r.difficulty,
        lootType: r.lootType,
        titleCoverage: r.titleCoverage,
        raidLeadDisplay: r.raidLeadDisplay,
        runChannelId: r.runChannelId,
      })),
    };
    const bumped = createHash("sha256").update(JSON.stringify(bumpedPayload)).digest("hex").slice(0, 32);
    expect(current).not.toBe(bumped);
  });

  it("realistic weekly volume stays under Discord embed description limit", () => {
    const runs = Array.from({ length: 40 }, (_, i) =>
      run({
        runId: `run-${String(i).padStart(2, "0")}`,
        scheduledStartAt: new Date(Date.parse(CURRENT_AT) + i * 3_600_000).toISOString(),
        status: "OPEN",
        runChannelId: `chan-${i}`,
        raidLeadDisplay: `Lead${i}`,
      }),
    );
    const description = buildScheduleDescription(runs);
    expect(description.length).toBeLessThan(4096);
  });
});
