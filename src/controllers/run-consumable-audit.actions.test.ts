import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const requireUser = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

import {
  analyzeRunConsumablesAction,
  attachRunWarcraftLogsReportAction,
  decideRunWarcraftLogsFightAction,
  detachRunWarcraftLogsReportAction,
  rescanRunWarcraftLogsAction,
} from "@/controllers/run-consumable-audit.actions";
import { warcraftLogsApiClient } from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import { DomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";

const RUN_ID = "r9999996-9996-4996-8996-999999999996";
const REPORT = "AbCdEfGhIjKlMnOp";

const user = (id: string, accountRole: "USER" | "RAID_LEAD" | "ADMIN") => ({
  id,
  name: accountRole,
  email: null,
  image: null,
  discordUserId: null,
  discordUsername: null,
  accountRole,
  accountStatus: "ACTIVE" as const,
});

describe("Warcraft Logs / Consumables Audit server actions", () => {
  let metadataSpy: MockInstance<typeof warcraftLogsApiClient.fetchReportMetadata>;
  let eventsSpy: MockInstance<typeof warcraftLogsApiClient.fetchReportConsumableEvents>;

  beforeEach(async () => {
    requireUser.mockReset();
    revalidatePath.mockReset();
    await orm.RunConsumableAudit.where({ runId: RUN_ID }).deleteAndCount();
    await orm.RunWarcraftLogsReport.where({ runId: RUN_ID }).deleteAndCount();
    vi.spyOn(warcraftLogsApiClient, "isConfigured").mockReturnValue(true);
    metadataSpy = vi.spyOn(warcraftLogsApiClient, "fetchReportMetadata").mockResolvedValue({ status: "NOT_FOUND" });
    eventsSpy = vi.spyOn(warcraftLogsApiClient, "fetchReportConsumableEvents");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await orm.RunConsumableAudit.where({ runId: RUN_ID }).deleteAndCount();
    await orm.RunWarcraftLogsReport.where({ runId: RUN_ID }).deleteAndCount();
    await orm.WarcraftLogsReport.where({ code: REPORT }).deleteAndCount();
  });

  it("returns the normal authorization response to a USER for every action and never reaches Warcraft Logs", async () => {
    requireUser.mockResolvedValue(user("11111111-1111-4111-8111-111111111111", "USER"));
    const results = [
      await attachRunWarcraftLogsReportAction({ runId: RUN_ID, report: `https://www.warcraftlogs.com/reports/${REPORT}` }),
      await rescanRunWarcraftLogsAction({ runId: RUN_ID }),
      await detachRunWarcraftLogsReportAction({ runId: RUN_ID, reportCode: REPORT }),
      await decideRunWarcraftLogsFightAction({
        runId: RUN_ID,
        fightId: "ca000003-0000-4000-8000-00000000c0a3",
        assign: true,
      }),
      await analyzeRunConsumablesAction({ runId: RUN_ID }),
    ];
    for (const result of results) expect(result).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
    expect(metadataSpy).not.toHaveBeenCalled();
    expect(eventsSpy).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await orm.RunWarcraftLogsReport.where({ runId: RUN_ID }).first()).toBeNull();
  });

  it("rejects an unauthenticated caller", async () => {
    requireUser.mockRejectedValue(new DomainError("NOT_AUTHENTICATED", "Sign in is required.", 401));
    await expect(attachRunWarcraftLogsReportAction({ runId: RUN_ID, report: REPORT })).resolves.toMatchObject({
      ok: false,
      code: "NOT_AUTHENTICATED",
    });
    expect(metadataSpy).not.toHaveBeenCalled();
  });

  it("validates the report link", async () => {
    requireUser.mockResolvedValue(user("44444444-4444-4444-8444-444444444444", "ADMIN"));
    await expect(attachRunWarcraftLogsReportAction({ runId: RUN_ID, report: "not a report" })).resolves.toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(metadataSpy).not.toHaveBeenCalled();
  });

  it("maps a missing report to a safe message for the run's Raid Lead", async () => {
    requireUser.mockResolvedValue(user("33333333-3333-4333-8333-333333333333", "RAID_LEAD"));
    const result = await attachRunWarcraftLogsReportAction({ runId: RUN_ID, report: REPORT });
    expect(result).toEqual({
      ok: false,
      code: "CONSUMABLE_AUDIT_REPORT_NOT_FOUND",
      message: "That Warcraft Logs report was not found or is private.",
    });
    expect(metadataSpy).toHaveBeenCalledWith(REPORT);
    expect(revalidatePath).toHaveBeenCalledWith(`/runs/${RUN_ID}`);
  });

  it("asks for a report before re-analysis", async () => {
    requireUser.mockResolvedValue(user("44444444-4444-4444-8444-444444444444", "ADMIN"));
    await expect(analyzeRunConsumablesAction({ runId: RUN_ID })).resolves.toMatchObject({
      ok: false,
      code: "CONSUMABLE_AUDIT_REPORT_REQUIRED",
    });
  });
});
