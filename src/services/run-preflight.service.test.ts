import { describe, expect, it } from "vitest";
import { summarizePreflightChecks, type PreflightCheck } from "@/services/run-preflight.service";

function check(status: PreflightCheck["status"], id = status): PreflightCheck {
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
});
