import { describe, expect, it } from "vitest";
import { preflightCheckAction } from "@/components/runs/run-preflight-panel";

const RUN = "run-1";

describe("preflightCheckAction — existing warning → direct action", () => {
  it("maps each roster warning to its action on the Roster tab", () => {
    expect(preflightCheckAction({ id: "selected_lockouts", status: "WARNING" }, RUN)).toEqual({
      label: "Find replacements",
      href: "/runs/run-1#roster-attention",
    });
    expect(preflightCheckAction({ id: "selected_schedule_conflicts", status: "WARNING" }, RUN)?.label).toBe(
      "Find replacements",
    );
    expect(
      preflightCheckAction({ id: "composition:COMPOSITION_UNDER_TARGET:Healer composition is 2 / 3.", status: "WARNING" }, RUN)
        ?.label,
    ).toBe("Fill gaps");
    expect(preflightCheckAction({ id: "selected_blizzard_sync", status: "WARNING" }, RUN)?.label).toBe("Sync Characters");
    expect(preflightCheckAction({ id: "publish_blocker:CHARACTER_INACTIVE:s1", status: "WARNING" }, RUN)?.label).toBe(
      "Find replacement",
    );
    expect(preflightCheckAction({ id: "unpublished_changes", status: "ERROR" }, RUN)).toEqual({
      label: "Review & Update",
      href: "/runs/run-1",
    });
  });

  it("passing checks and checks without a natural action get none", () => {
    expect(preflightCheckAction({ id: "selected_lockouts", status: "PASS" }, RUN)).toBeNull();
    expect(
      preflightCheckAction({ id: "composition:COMPOSITION_OVER_TARGET:Healer composition is 4 / 3.", status: "WARNING" }, RUN),
    ).toBeNull();
    expect(preflightCheckAction({ id: "discord_channel", status: "WARNING" }, RUN)).toBeNull();
    expect(preflightCheckAction({ id: "raid_lead", status: "WARNING" }, RUN)).toBeNull();
  });
});
