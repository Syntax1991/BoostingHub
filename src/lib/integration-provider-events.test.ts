import { beforeEach, describe, expect, it, vi } from "vitest";

const { record } = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock("@/services/integration-event.service", () => ({
  integrationEventService: { record },
}));

import {
  recordRaiderIoApiOutcome,
  recordRaiderIoParseResult,
  recordWarcraftLogsOutcome,
} from "@/lib/integration-provider-events";

beforeEach(() => {
  record.mockReset();
  record.mockResolvedValue({});
});

describe("recordWarcraftLogsOutcome", () => {
  it("does not record SUCCESS lookups", async () => {
    await recordWarcraftLogsOutcome({ operation: "FIND_CHARACTER", status: "SUCCESS" });
    expect(record).not.toHaveBeenCalled();
  });

  it("records NOT_FOUND as WARNING and TEMPORARY_FAILURE as ERROR", async () => {
    await recordWarcraftLogsOutcome({ operation: "FIND_CHARACTER", status: "NOT_FOUND", region: "EU" });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "WARCRAFT_LOGS",
        status: "WARNING",
        errorCode: "NOT_FOUND",
      }),
    );

    record.mockClear();
    await recordWarcraftLogsOutcome({ operation: "FETCH_REPORT", status: "TEMPORARY_FAILURE" });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "WARCRAFT_LOGS",
        status: "ERROR",
        errorCode: "WCL_UNAVAILABLE",
      }),
    );
  });
});

describe("recordRaiderIoParseResult", () => {
  it("records PARSE_SUCCESS without storing the URL", async () => {
    await recordRaiderIoParseResult({
      ok: true,
      value: { region: "EU", realmSlug: "antonidas", characterName: "Synblast" },
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "RAIDER_IO",
        operation: "PARSE_URL",
        status: "SUCCESS",
        errorCode: "PARSE_SUCCESS",
      }),
    );
    const arg = record.mock.calls[0]![0] as Record<string, unknown>;
    expect(JSON.stringify(arg)).not.toMatch(/raider\.io|Synblast|antonidas/i);
  });

  it("records parse failure codes", async () => {
    await recordRaiderIoParseResult({
      ok: false,
      error: { code: "WRONG_HOST", message: "bad host" },
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "RAIDER_IO",
        errorCode: "WRONG_HOST",
        status: "WARNING",
      }),
    );
  });
});

describe("recordRaiderIoApiOutcome", () => {
  it("records TEMPORARY_FAILURE as WARNING without secrets", async () => {
    await recordRaiderIoApiOutcome({
      status: "TEMPORARY_FAILURE",
      region: "EU",
      durationMs: 40,
      reason: "Raider.IO HTTP 503",
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "RAIDER_IO",
        operation: "CHARACTER_EQUIPPED_ILVL",
        status: "WARNING",
        errorCode: "RAIDER_IO_UNAVAILABLE",
        region: "EU",
      }),
    );
    const arg = record.mock.calls[0]![0] as Record<string, unknown>;
    expect(JSON.stringify(arg)).not.toMatch(/access_key|Authorization|token/i);
  });

  it("records SUCCESS so health can recover after TEMPORARY_FAILURE", async () => {
    await recordRaiderIoApiOutcome({
      status: "SUCCESS",
      region: "EU",
      durationMs: 35,
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "RAIDER_IO",
        operation: "CHARACTER_EQUIPPED_ILVL",
        status: "SUCCESS",
        region: "EU",
      }),
    );
  });
});
