import { describe, expect, it, vi } from "vitest";
import { runAfterResponse } from "@/lib/after-response";

describe("runAfterResponse", () => {
  it("outside a request scope it never runs the task (no background work from tests / scripts)", async () => {
    const task = vi.fn(async () => {});
    const onSkipped = vi.fn();
    runAfterResponse(task, onSkipped);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(task).not.toHaveBeenCalled();
    expect(onSkipped).toHaveBeenCalledTimes(1);
  });
});
