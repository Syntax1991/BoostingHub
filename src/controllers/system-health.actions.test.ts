import { describe, expect, it, vi, beforeEach } from "vitest";
import { DomainError } from "@/lib/errors";

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

  it("records bulk refresh cooldown as WARNING (not ERROR / outage)", async () => {
    forceRefreshAll.mockRejectedValue(
      new DomainError("CHARACTER_BULK_REFRESH_COOLDOWN", "Try again later.", 429),
    );
    const result = await adminSystemForceRefreshAllAction();
    expect(result.ok).toBe(false);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "SYSTEM",
        operation: "ADMIN_FORCE_REFRESH_ALL",
        status: "WARNING",
        errorCode: "CHARACTER_BULK_REFRESH_COOLDOWN",
      }),
    );
  });

  it("records sync already running as WARNING", async () => {
    forceRefreshAll.mockRejectedValue(
      new DomainError("CHARACTER_SYNC_ALREADY_RUNNING", "Already running.", 409),
    );
    await adminSystemForceRefreshAllAction();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "WARNING",
        errorCode: "CHARACTER_SYNC_ALREADY_RUNNING",
      }),
    );
  });

  it("records authorization denial as WARNING (not SYSTEM DOWN telemetry)", async () => {
    requireAdmin.mockRejectedValue(new DomainError("NOT_AUTHORIZED", "Admin required.", 403));
    const result = await adminSystemForceRefreshAllAction();
    expect(result.ok).toBe(false);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "SYSTEM",
        status: "WARNING",
        errorCode: "NOT_AUTHORIZED",
      }),
    );
  });

  it("records unexpected non-domain failure as ERROR", async () => {
    forceRefreshAll.mockRejectedValue(new Error("disk exploded"));
    await adminSystemForceRefreshAllAction();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "SYSTEM",
        operation: "ADMIN_FORCE_REFRESH_ALL",
        status: "ERROR",
        errorCode: "ADMIN_ACTION_FAILED",
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

  it("WCL auto-audit already running records WARNING ALREADY_RUNNING", async () => {
    runDuePass.mockResolvedValue({ status: "SKIPPED_ALREADY_RUNNING" });
    const result = await adminSystemWclAutoAuditPassAction();
    expect(result.ok).toBe(true);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "SYSTEM",
        operation: "ADMIN_WCL_AUTO_AUDIT_PASS",
        status: "WARNING",
        errorCode: "ALREADY_RUNNING",
      }),
    );
  });
});
