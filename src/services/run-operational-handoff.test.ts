import { describe, expect, it } from "vitest";
import {
  formatOperationalAttentionHint,
  projectRunOperationalHandoff,
} from "@/services/run-operational-handoff";
import { emptyRunCapabilities, getRunLifecycleCapabilities } from "@/services/run-state";

function caps(status: Parameters<typeof getRunLifecycleCapabilities>[0]["status"], actorIsAdmin = false) {
  return getRunLifecycleCapabilities({
    status,
    signupsOpen: status === "OPEN" || status === "ROSTERING" || status === "PUBLISHED",
    actorIsAdmin,
    archivedAt: null,
  });
}

describe("projectRunOperationalHandoff", () => {
  it("preserves DRAFT manage action", () => {
    const handoff = projectRunOperationalHandoff({
      status: "DRAFT",
      hasRoster: false,
      publishedAt: null,
      draftSelectedCount: 0,
      capabilities: caps("DRAFT"),
      attendance: null,
    });
    expect(handoff.nextAction.kind).toBe("MANAGE");
    expect(handoff.nextAction.label).toBe("Manage");
    expect(handoff.attention).toBe("NONE");
  });

  it("preserves OPEN build roster action", () => {
    const handoff = projectRunOperationalHandoff({
      status: "OPEN",
      hasRoster: false,
      publishedAt: null,
      draftSelectedCount: 0,
      capabilities: caps("OPEN"),
      attendance: null,
    });
    expect(handoff.nextAction.kind).toBe("BUILD_ROSTER");
    expect(handoff.nextAction.tab).toBe("roster");
  });

  it("preserves OPEN continue roster when draft selections exist", () => {
    const handoff = projectRunOperationalHandoff({
      status: "OPEN",
      hasRoster: true,
      publishedAt: null,
      draftSelectedCount: 3,
      capabilities: caps("OPEN"),
      attendance: null,
    });
    expect(handoff.nextAction.kind).toBe("CONTINUE_ROSTER");
  });

  it("preserves ROSTERING continue roster", () => {
    const handoff = projectRunOperationalHandoff({
      status: "ROSTERING",
      hasRoster: true,
      publishedAt: null,
      draftSelectedCount: 2,
      capabilities: caps("ROSTERING"),
      attendance: null,
    });
    expect(handoff.nextAction.kind).toBe("CONTINUE_ROSTER");
    expect(handoff.nextAction.label).toBe("Continue Roster");
  });

  it("publishes Start Run when canStart", () => {
    const handoff = projectRunOperationalHandoff({
      status: "PUBLISHED",
      hasRoster: true,
      publishedAt: "2026-01-01T00:00:00.000Z",
      draftSelectedCount: 5,
      capabilities: caps("PUBLISHED"),
      attendance: null,
    });
    expect(handoff.nextAction.kind).toBe("START");
    expect(handoff.nextAction.mode).toBe("dialog-start");
  });

  it("IN_PROGRESS with unmarked rows needs attendance", () => {
    const handoff = projectRunOperationalHandoff({
      status: "IN_PROGRESS",
      hasRoster: true,
      publishedAt: "2026-01-01T00:00:00.000Z",
      draftSelectedCount: 5,
      capabilities: caps("IN_PROGRESS"),
      attendance: { total: 5, unmarkedCount: 3 },
    });
    expect(handoff.attention).toBe("NEEDS_ATTENDANCE");
    expect(handoff.nextAction.kind).toBe("ATTENDANCE");
    expect(handoff.nextAction.tab).toBe("attendance");
    expect(handoff.attendance.unmarkedCount).toBe(3);
    expect(formatOperationalAttentionHint(handoff)).toBe("3 unmarked");
  });

  it("IN_PROGRESS with zero unmarked is ready to complete", () => {
    const handoff = projectRunOperationalHandoff({
      status: "IN_PROGRESS",
      hasRoster: true,
      publishedAt: "2026-01-01T00:00:00.000Z",
      draftSelectedCount: 5,
      capabilities: caps("IN_PROGRESS"),
      attendance: { total: 5, unmarkedCount: 0 },
    });
    expect(handoff.attention).toBe("READY_TO_COMPLETE");
    expect(handoff.nextAction.kind).toBe("COMPLETE");
    expect(handoff.nextAction.mode).toBe("dialog-complete");
  });

  it("COMPLETED is done: no attention and a plain View action (no financial follow-up)", () => {
    for (const actorIsAdmin of [false, true]) {
      const handoff = projectRunOperationalHandoff({
        status: "COMPLETED",
        hasRoster: true,
        publishedAt: "2026-01-01T00:00:00.000Z",
        draftSelectedCount: 5,
        capabilities: caps("COMPLETED", actorIsAdmin),
        attendance: { total: 5, unmarkedCount: 0 },
      });
      expect(handoff.attention).toBe("NONE");
      expect(handoff.nextAction).toEqual({ kind: "VIEW", label: "View", mode: "link", tab: "overview" });
      expect(formatOperationalAttentionHint(handoff)).toBeNull();
    }
  });

  it("does not invent actions from empty capabilities alone", () => {
    const handoff = projectRunOperationalHandoff({
      status: "PUBLISHED",
      hasRoster: true,
      publishedAt: "2026-01-01T00:00:00.000Z",
      draftSelectedCount: 1,
      capabilities: emptyRunCapabilities(),
      attendance: null,
    });
    expect(handoff.nextAction.kind).toBe("VIEW_ROSTER");
  });
});
