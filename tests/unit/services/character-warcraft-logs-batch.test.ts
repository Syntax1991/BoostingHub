import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWarcraftLogsClientTokenCacheForTests } from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import {
  characterWarcraftLogsService,
  WARCRAFT_LOGS_AUTO_LINK_CONCURRENCY,
} from "@/services/character-warcraft-logs.service";

describe("characterWarcraftLogsService.tryAutoLinkManyIfMissing", () => {
  beforeEach(() => {
    resetWarcraftLogsClientTokenCacheForTests();
    vi.stubEnv("WARCRAFT_LOGS_CLIENT_ID", "wcl-client");
    vi.stubEnv("WARCRAFT_LOGS_CLIENT_SECRET", "wcl-secret");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetWarcraftLogsClientTokenCacheForTests();
  });

  it("returns immediately for empty input", async () => {
    const spy = vi.spyOn(characterWarcraftLogsService, "tryAutoLinkIfMissing");
    const summary = await characterWarcraftLogsService.tryAutoLinkManyIfMissing([]);
    expect(summary).toEqual({
      total: 0,
      attempted: 0,
      linked: 0,
      alreadyLinked: 0,
      notFound: 0,
      mismatch: 0,
      unsupportedRegion: 0,
      temporaryFailure: 0,
      skippedAfterFailure: 0,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("deduplicates Character IDs", async () => {
    const spy = vi
      .spyOn(characterWarcraftLogsService, "tryAutoLinkIfMissing")
      .mockResolvedValue({ status: "LINKED", warcraftLogsId: "1" });
    const summary = await characterWarcraftLogsService.tryAutoLinkManyIfMissing([
      "a",
      "b",
      "a",
      "b",
      "a",
    ]);
    expect(summary.total).toBe(2);
    expect(summary.attempted).toBe(2);
    expect(summary.linked).toBe(2);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.map((call) => call[0]).sort()).toEqual(["a", "b"]);
  });

  it("skips the batch immediately when WCL is not configured", async () => {
    vi.stubEnv("WARCRAFT_LOGS_CLIENT_ID", "");
    vi.stubEnv("WARCRAFT_LOGS_CLIENT_SECRET", "");
    const spy = vi.spyOn(characterWarcraftLogsService, "tryAutoLinkIfMissing");
    const summary = await characterWarcraftLogsService.tryAutoLinkManyIfMissing(["a", "b", "c"]);
    expect(summary.total).toBe(3);
    expect(summary.attempted).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("links multiple Characters successfully", async () => {
    vi.spyOn(characterWarcraftLogsService, "tryAutoLinkIfMissing").mockImplementation(async (id) => ({
      status: "LINKED",
      warcraftLogsId: `wcl-${id}`,
    }));
    const summary = await characterWarcraftLogsService.tryAutoLinkManyIfMissing(["c1", "c2", "c3"]);
    expect(summary).toMatchObject({
      total: 3,
      attempted: 3,
      linked: 3,
      skippedAfterFailure: 0,
    });
  });

  it("continues after NOT_FOUND and MISMATCH", async () => {
    vi.spyOn(characterWarcraftLogsService, "tryAutoLinkIfMissing").mockImplementation(async (id) => {
      if (id === "missing") return { status: "NOT_FOUND" };
      if (id === "mismatch") return { status: "MISMATCH", storedId: "1", discoveredId: "2" };
      return { status: "LINKED", warcraftLogsId: "9" };
    });
    const summary = await characterWarcraftLogsService.tryAutoLinkManyIfMissing([
      "missing",
      "ok",
      "mismatch",
      "ok2",
    ]);
    expect(summary).toMatchObject({
      total: 4,
      attempted: 4,
      linked: 2,
      notFound: 1,
      mismatch: 1,
      skippedAfterFailure: 0,
    });
  });

  it("trips a request-local circuit on TEMPORARY_FAILURE and skips remaining work", async () => {
    const started: string[] = [];
    const releases: Array<() => void> = [];

    vi.spyOn(characterWarcraftLogsService, "tryAutoLinkIfMissing").mockImplementation(async (id) => {
      started.push(id);
      if (id === "fail") {
        return { status: "TEMPORARY_FAILURE", message: "down" };
      }
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      return { status: "LINKED", warcraftLogsId: `wcl-${id}` };
    });

    const ids = ["a", "b", "c", "fail", "d", "e", "f", "g"];
    const pending = characterWarcraftLogsService.tryAutoLinkManyIfMissing(ids);

    // Let the first wave claim work (concurrency 4) and hit the failure.
    await Promise.resolve();
    await Promise.resolve();

    // Release any in-flight non-fail workers so the batch can settle.
    for (const release of releases) release();
    const summary = await pending;

    expect(summary.temporaryFailure).toBe(1);
    expect(summary.attempted).toBeLessThan(ids.length);
    expect(summary.skippedAfterFailure).toBe(ids.length - summary.attempted);
    expect(started).not.toContain("g");
    expect(started.length).toBe(summary.attempted);
  });

  it("never exceeds WARCRAFT_LOGS_AUTO_LINK_CONCURRENCY in flight", async () => {
    expect(WARCRAFT_LOGS_AUTO_LINK_CONCURRENCY).toBe(4);

    let inFlight = 0;
    let maxInFlight = 0;
    const releases: Array<() => void> = [];

    vi.spyOn(characterWarcraftLogsService, "tryAutoLinkIfMissing").mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      inFlight -= 1;
      return { status: "LINKED", warcraftLogsId: "1" };
    });

    const ids = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const pending = characterWarcraftLogsService.tryAutoLinkManyIfMissing(ids);

    // Allow workers to claim the first wave.
    await Promise.resolve();
    await Promise.resolve();
    expect(maxInFlight).toBeLessThanOrEqual(WARCRAFT_LOGS_AUTO_LINK_CONCURRENCY);
    expect(releases.length).toBe(WARCRAFT_LOGS_AUTO_LINK_CONCURRENCY);

    // Drain remaining waves.
    while (releases.length > 0) {
      const batch = releases.splice(0, releases.length);
      for (const release of batch) release();
      await Promise.resolve();
      await Promise.resolve();
    }

    const summary = await pending;
    expect(summary.attempted).toBe(12);
    expect(summary.linked).toBe(12);
    expect(maxInFlight).toBe(WARCRAFT_LOGS_AUTO_LINK_CONCURRENCY);
  });
});
