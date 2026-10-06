import { describe, expect, it, vi, beforeEach } from "vitest";

const { requireAdmin, forceRefreshAll, runDuePass, record } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  forceRefreshAll: vi.fn(),
  runDuePass: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/auth/session", () => ({ requireAdmin }));
vi.mock("@/services/character-operations.service", () => ({
  characterOperationsService: { forceRefreshAll },
}));
vi.mock("@/services/run-consumable-auto-audit.service", () => ({
  runConsumableAutoAuditService: { runDuePass },
}));
vi.mock("@/services/integration-event.service", () => ({
  integrationEventService: { record },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  adminSystemForceRefreshAllAction,
  adminSystemWclAutoAuditPassAction,
} from "@/controllers/system-health.actions";

beforeEach(() => {
  requireAdmin.mockReset();
  forceRefreshAll.mockReset();
  runDuePass.mockReset();
  record.mockReset();
  requireAdmin.mockResolvedValue({ id: "admin", accountRole: "ADMIN" });
  record.mockResolvedValue({});
});

describe("system health admin actions", () => {
  it("force refresh all reuses characterOperationsService and records SYSTEM telemetry", async () => {
    forceRefreshAll.mockResolvedValue({
      eligible: 3,
      succeeded: 2,
      failed: 1,
      skipped: 0,
    });
    const result = await adminSystemForceRefreshAllAction();
    expect(result.ok).toBe(true);
    expect(forceRefreshAll).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "SYSTEM",
        operation: "ADMIN_FORCE_REFRESH_ALL",
        status: "WARNING",
      }),
    );
  });

  it("WCL auto-audit pass records SUCCESS summary", async () => {
    runDuePass.mockResolvedValue({
      status: "COMPLETED",
      due: 1,
      runs: [{ runId: "r1", status: "ANALYZED", fights: 2 }],
    });
    const result = await adminSystemWclAutoAuditPassAction();
    expect(result.ok).toBe(true);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "SYSTEM",
        operation: "ADMIN_WCL_AUTO_AUDIT_PASS",
        status: "SUCCESS",
      }),
    );
  });
});
