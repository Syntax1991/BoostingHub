import { describe, expect, it } from "vitest";
import { pruneUnavailableRuns } from "@/lib/community-schedule-form";

const row = (attachRunId: string | null) => ({ key: attachRunId ?? "none", attachRunId });

describe("pruneUnavailableRuns (existing-Run candidate refresh)", () => {
  it("keeps a still-eligible basis Run and additional Runs (same references)", () => {
    const slots = [row("run-b"), row(null)];
    const result = pruneUnavailableRuns({ basisRunId: "run-a", slots }, new Set(["run-a", "run-b"]));
    expect(result.basisRunId).toBe("run-a");
    expect(result.slots).toBe(slots);
  });

  it("clears the basis only when the server no longer lists it", () => {
    const slots = [row("run-b")];
    const result = pruneUnavailableRuns({ basisRunId: "run-a", slots }, new Set(["run-b"]));
    expect(result.basisRunId).toBeNull();
    expect(result.slots).toBe(slots);
  });

  it("an additional time's Run becoming ineligible never touches the basis", () => {
    const result = pruneUnavailableRuns({ basisRunId: "run-a", slots: [row("run-b"), row("run-c")] }, new Set(["run-a", "run-c"]));
    expect(result.basisRunId).toBe("run-a");
    expect(result.slots.map((slot) => slot.attachRunId)).toEqual([null, "run-c"]);
  });

  it("removing / adding additional attachments is independent of the basis", () => {
    const withB = pruneUnavailableRuns({ basisRunId: "run-a", slots: [row("run-b")] }, new Set(["run-a", "run-b"]));
    const withoutB = pruneUnavailableRuns({ basisRunId: withB.basisRunId, slots: [] }, new Set(["run-a", "run-b"]));
    expect(withoutB.basisRunId).toBe("run-a");
  });
});
