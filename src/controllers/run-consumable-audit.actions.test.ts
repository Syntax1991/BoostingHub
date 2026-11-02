import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

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
import { runDetailPath } from "@/lib/run-routes";
import { SEED_IDS } from "@/prisma/seed-ids";
import { testActor } from "@/test/actors";
import { assertIsolatedTestDatabase } from "@/test/db-fixtures";

/**
 * The seeded completed Run (Raid Lead Thorne). The seed attaches no reports or
 * audits to it, so the cleanup below removes only rows these tests wrote.
 */
const RUN_ID = SEED_IDS.runs.largeCompleted;
const REPORT = "AbCdEfGhIjKlMnOp";
const booster = testActor(SEED_IDS.users.kael, "USER");
const runRaidLead = testActor(SEED_IDS.users.thorne, "RAID_LEAD");
const admin = testActor(SEED_IDS.users.aelira, "ADMIN");

describe("Warcraft Logs / Consumables Audit server actions", () => {
  let metadataSpy: MockInstance<typeof warcraftLogsApiClient.fetchReportMetadata>;
  let eventsSpy: MockInstance<typeof warcraftLogsApiClient.fetchReportConsumableEvents>;

  beforeAll(() => {
    assertIsolatedTestDatabase();
  });

  beforeEach(() => {
    requireUser.mockReset();
    revalidatePath.mockReset();
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
    requireUser.mockResolvedValue(booster);
    const results = [
      await attachRunWarcraftLogsReportAction({ runId: RUN_ID, report: `https://www.warcraftlogs.com/reports/${REPORT}` }),
      await rescanRunWarcraftLogsAction({ runId: RUN_ID }),
      await detachRunWarcraftLogsReportAction({ runId: RUN_ID, reportCode: REPORT }),
      await decideRunWarcraftLogsFightAction({
        runId: RUN_ID,
        fightId: crypto.randomUUID(),
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
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("validates the report link", async () => {
    requireUser.mockResolvedValue(admin);
    await expect(attachRunWarcraftLogsReportAction({ runId: RUN_ID, report: "not a report" })).resolves.toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(metadataSpy).not.toHaveBeenCalled();
  });

  it("maps a missing report to a safe message for the run's Raid Lead", async () => {
    requireUser.mockResolvedValue(runRaidLead);
    const result = await attachRunWarcraftLogsReportAction({ runId: RUN_ID, report: REPORT });
    expect(result).toEqual({
      ok: false,
      code: "CONSUMABLE_AUDIT_REPORT_NOT_FOUND",
      message: "That Warcraft Logs report was not found or is private.",
    });
    expect(metadataSpy).toHaveBeenCalledWith(REPORT);
    expect(revalidatePath).toHaveBeenCalledWith(runDetailPath(RUN_ID));
  });

  it("asks for a report before re-analysis", async () => {
    requireUser.mockResolvedValue(admin);
    await expect(analyzeRunConsumablesAction({ runId: RUN_ID })).resolves.toMatchObject({
      ok: false,
      code: "CONSUMABLE_AUDIT_REPORT_REQUIRED",
    });
  });
});
