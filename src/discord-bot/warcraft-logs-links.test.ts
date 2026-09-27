import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WCL_AUTO_AUDIT_INTERVAL_MS,
  WCL_CHANNEL_SCAN_INTERVAL_MS,
  WCL_FINAL_SCAN_MAX_DEFER_MS,
  WCL_SCAN_MAX_PAGES_PER_PASS,
  WCL_SCAN_PAGE_SIZE,
  createReportScanState,
  findTrustedReportLinks,
  scanChannelFromCursor,
  scanRunChannelsForReports,
  startWarcraftLogsAutoAuditLoop,
  type FetchMessagePage,
  type ScannableMessage,
} from "@/discord-bot/warcraft-logs-links";

const LOG_BOT = "111111111111111111";
const BOOSTER = "222222222222222222";
const URL_A = "https://www.warcraftlogs.com/reports/FtwhWRvqjTbAx4NQ";
const URL_B = "https://www.warcraftlogs.com/reports/AbCdEfGhIjKlMnOp";

function message(overrides: Partial<ScannableMessage> & { id: string }): ScannableMessage {
  return { authorId: BOOSTER, content: "chatter", embeds: [], ...overrides };
}

/** A fake channel with snowflake-ordered history that serves pages like Discord's REST API. */
function fakeChannel(history: ScannableMessage[]) {
  const sorted = [...history].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  const calls: Array<{ after?: string; limit: number }> = [];
  const fetchPage: FetchMessagePage = async (_channelId, options) => {
    calls.push(options);
    if (!options.after) return sorted.slice(-options.limit).reverse(); // newest first, like Discord
    const after = BigInt(options.after);
    return sorted
      .filter((row) => BigInt(row.id) > after)
      .slice(0, options.limit)
      .reverse();
  };
  return { fetchPage, calls, append: (row: ScannableMessage) => sorted.push(row) };
}

/** Messages with ids 1000…1000+n; the trusted link sits at `linkAt` if given. */
function history(n: number, linkAt?: number, url = URL_A): ScannableMessage[] {
  return Array.from({ length: n }, (_, i) =>
    i === linkAt
      ? message({ id: String(1000 + i), authorId: LOG_BOT, content: `Syntax_gg started a new report ${url}` })
      : message({ id: String(1000 + i) }),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("findTrustedReportLinks", () => {
  it("reads PhoenixStar-style posts from content and embeds of trusted authors only", () => {
    const links = findTrustedReportLinks(
      [
        message({ id: "1", authorId: LOG_BOT, content: `Syntax_gg started a new report ${URL_A}` }),
        message({ id: "2", content: "https://www.warcraftlogs.com/reports/ZzZzZzZzZzZzZzZz" }),
        message({ id: "3", authorId: LOG_BOT, content: "", embeds: [{ title: "New report", url: `${URL_B}#fight=last` }] }),
        message({ id: "4", authorId: LOG_BOT, content: "", embeds: [{ fields: [{ name: "Log", value: `<${URL_A}>` }] }] }),
        message({ id: "5", authorId: LOG_BOT, content: "https://classic.warcraftlogs.com/reports/QqQqQqQqQqQqQqQq" }),
      ],
      new Set([LOG_BOT]),
    );
    expect(links).toEqual([
      { reportCode: "FtwhWRvqjTbAx4NQ", messageId: "1", authorId: LOG_BOT },
      { reportCode: "AbCdEfGhIjKlMnOp", messageId: "3", authorId: LOG_BOT },
    ]);
  });
});

describe("scanChannelFromCursor", () => {
  const trusted = new Set([LOG_BOT]);

  it("never misses a link even with far more than one page between scans", async () => {
    // 350 messages after the cursor; the log-bot post is the 10th of them.
    const channel = fakeChannel(history(351, 10));
    const attach = vi.fn(async () => ({ status: "ATTACHED" }));
    const result = await scanChannelFromCursor({
      runId: "run-1",
      channelId: "chan-1",
      cursor: "1000",
      trustedAuthorIds: trusted,
      fetchPage: channel.fetchPage,
      attach,
      maxPages: WCL_SCAN_MAX_PAGES_PER_PASS,
    });
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledWith("run-1", expect.objectContaining({ reportCode: "FtwhWRvqjTbAx4NQ", messageId: "1010" }));
    expect(result).toEqual({ cursor: "1350", reachedEnd: true, blocked: false });
    expect(channel.calls.map((call) => call.after)).toEqual(["1000", "1100", "1200", "1300"]);
    expect(channel.calls.every((call) => call.limit === WCL_SCAN_PAGE_SIZE)).toBe(true);
  });

  it("stays bounded per pass and continues from where it stopped", async () => {
    const channel = fakeChannel(history(301, 250));
    const attach = vi.fn(async () => ({ status: "ATTACHED" }));
    const first = await scanChannelFromCursor({
      runId: "run-1",
      channelId: "chan-1",
      cursor: "1000",
      trustedAuthorIds: trusted,
      fetchPage: channel.fetchPage,
      attach,
      maxPages: 2,
    });
    expect(first).toEqual({ cursor: "1200", reachedEnd: false, blocked: false });
    expect(attach).not.toHaveBeenCalled();
    const second = await scanChannelFromCursor({
      runId: "run-1",
      channelId: "chan-1",
      cursor: first.cursor,
      trustedAuthorIds: trusted,
      fetchPage: channel.fetchPage,
      attach,
      maxPages: 2,
    });
    expect(second).toEqual({ cursor: "1300", reachedEnd: true, blocked: false });
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it("does not advance past a link whose attach must be retried, and retries it next time", async () => {
    const channel = fakeChannel(history(50, 20));
    const attach = vi
      .fn()
      .mockResolvedValueOnce({ status: "FAILED", retryable: true })
      .mockResolvedValueOnce({ status: "ATTACHED" });
    const common = { runId: "run-1", channelId: "chan-1", trustedAuthorIds: trusted, fetchPage: channel.fetchPage, attach, maxPages: 5 };

    const failed = await scanChannelFromCursor({ ...common, cursor: "1005" });
    expect(failed).toEqual({ cursor: "1019", reachedEnd: false, blocked: true });
    const retried = await scanChannelFromCursor({ ...common, cursor: failed.cursor });
    expect(retried).toEqual({ cursor: "1049", reachedEnd: true, blocked: false });
    expect(attach).toHaveBeenCalledTimes(2);
    expect(attach.mock.calls[1]![1]).toMatchObject({ messageId: "1020" });
  });

  it("treats a Bot API transport error like a retryable failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const channel = fakeChannel(history(5, 2));
    const result = await scanChannelFromCursor({
      runId: "run-1",
      channelId: "chan-1",
      cursor: "999",
      trustedAuthorIds: trusted,
      fetchPage: channel.fetchPage,
      attach: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
      maxPages: 5,
    });
    expect(result).toEqual({ cursor: "1001", reachedEnd: false, blocked: true });
  });

  it("moves on past a final (non-retryable) failure such as a private report", async () => {
    const channel = fakeChannel(history(5, 2));
    const result = await scanChannelFromCursor({
      runId: "run-1",
      channelId: "chan-1",
      cursor: "999",
      trustedAuthorIds: trusted,
      fetchPage: channel.fetchPage,
      attach: vi.fn(async () => ({ status: "FAILED", retryable: false })),
      maxPages: 5,
    });
    expect(result).toEqual({ cursor: "1004", reachedEnd: true, blocked: false });
  });

  it("without a cursor (Run start unknown) starts from the newest page", async () => {
    const channel = fakeChannel(history(250, 240));
    const attach = vi.fn(async () => ({ status: "ATTACHED" }));
    const result = await scanChannelFromCursor({
      runId: "run-1",
      channelId: "chan-1",
      cursor: null,
      trustedAuthorIds: trusted,
      fetchPage: channel.fetchPage,
      attach,
      maxPages: 5,
    });
    expect(channel.calls).toEqual([{ limit: WCL_SCAN_PAGE_SIZE }]);
    expect(result).toEqual({ cursor: "1249", reachedEnd: true, blocked: false });
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it("repeated links (duplicate log-bot posts) are sent once per message and stay idempotent server-side", async () => {
    const channel = fakeChannel([
      message({ id: "2000", authorId: LOG_BOT, content: `${URL_A} ${URL_A}` }),
      message({ id: "2001", authorId: LOG_BOT, content: URL_A }),
    ]);
    const attach = vi.fn().mockResolvedValueOnce({ status: "ATTACHED" }).mockResolvedValue({ status: "ALREADY_ATTACHED" });
    const result = await scanChannelFromCursor({
      runId: "run-1",
      channelId: "chan-1",
      cursor: "1999",
      trustedAuthorIds: trusted,
      fetchPage: channel.fetchPage,
      attach,
      maxPages: 5,
    });
    expect(attach).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ cursor: "2001", reachedEnd: true, blocked: false });
  });
});

describe("scanRunChannelsForReports", () => {
  it("throttles routine scans, saves the advanced cursor, and skips unflagged channels", async () => {
    const channel = fakeChannel(history(30, 12));
    const attach = vi.fn(async () => ({ status: "ATTACHED" }));
    const saveCursor = vi.fn(async () => {});
    const state = createReportScanState();
    const items = [
      { runId: "run-1", channelId: "chan-1", scanWarcraftLogs: true, retireChannel: false, warcraftLogsScanCursor: "999" },
      { runId: "run-2", channelId: "chan-2", scanWarcraftLogs: false, retireChannel: false, warcraftLogsScanCursor: null },
      { runId: "run-3", channelId: null, scanWarcraftLogs: true, retireChannel: false, warcraftLogsScanCursor: null },
    ];
    const run = (now: number, cursor = "999") =>
      scanRunChannelsForReports({
        items: items.map((item) => (item.runId === "run-1" ? { ...item, warcraftLogsScanCursor: cursor } : item)),
        trustedAuthorIds: [LOG_BOT],
        fetchPage: channel.fetchPage,
        attach,
        saveCursor,
        state,
        now,
      });

    expect(await run(1_000_000)).toEqual(new Set());
    expect(saveCursor).toHaveBeenCalledWith("run-1", "chan-1", "1029");
    expect(attach).toHaveBeenCalledTimes(1);
    await run(1_000_000 + WCL_CHANNEL_SCAN_INTERVAL_MS - 1, "1029");
    expect(channel.calls).toHaveLength(1);
    await run(1_000_000 + WCL_CHANNEL_SCAN_INTERVAL_MS, "1029");
    expect(channel.calls).toHaveLength(2);
    expect(saveCursor).toHaveBeenCalledTimes(1); // nothing new → no write
  });

  it("gives a retiring channel an unthrottled final scan and holds back deletion while it cannot finish", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const channel = fakeChannel(history(10, 5));
    const state = createReportScanState();
    const attach = vi.fn(async (): Promise<{ status: string; retryable?: boolean }> => ({ status: "FAILED", retryable: true }));
    const item = { runId: "run-9", channelId: "chan-9", scanWarcraftLogs: true, retireChannel: true, warcraftLogsScanCursor: "999" };
    const common = { items: [item], trustedAuthorIds: [LOG_BOT], fetchPage: channel.fetchPage, attach, saveCursor: vi.fn(async () => {}), state };

    expect(await scanRunChannelsForReports({ ...common, now: 0 })).toEqual(new Set(["run-9"]));
    expect(await scanRunChannelsForReports({ ...common, now: 1_000 })).toEqual(new Set(["run-9"]));
    // Bounded: after the maximum hold-back the channel may be retired anyway.
    expect(await scanRunChannelsForReports({ ...common, now: WCL_FINAL_SCAN_MAX_DEFER_MS })).toEqual(new Set());

    attach.mockResolvedValue({ status: "ATTACHED" });
    const fresh = createReportScanState();
    expect(await scanRunChannelsForReports({ ...common, state: fresh, now: 0 })).toEqual(new Set());
  });

  it("holds back deletion when Discord history cannot be read for the final scan", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const deferred = await scanRunChannelsForReports({
      items: [{ runId: "run-9", channelId: "chan-9", scanWarcraftLogs: true, retireChannel: true, warcraftLogsScanCursor: "999" }],
      trustedAuthorIds: [LOG_BOT],
      fetchPage: async () => {
        throw new Error("Missing Access");
      },
      attach: vi.fn(),
      saveCursor: vi.fn(),
      state: createReportScanState(),
      now: 0,
    });
    expect(deferred).toEqual(new Set(["run-9"]));
  });

  it("does nothing when no log bot is trusted", async () => {
    const fetchPage = vi.fn();
    expect(
      await scanRunChannelsForReports({
        items: [{ runId: "run-1", channelId: "chan-1", scanWarcraftLogs: true, retireChannel: true }],
        trustedAuthorIds: [],
        fetchPage,
        attach: vi.fn(),
        saveCursor: vi.fn(),
        state: createReportScanState(),
      }),
    ).toEqual(new Set());
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

describe("startWarcraftLogsAutoAuditLoop", () => {
  it("ticks the API on its interval and never overlaps calls", async () => {
    vi.useFakeTimers();
    let resolve: () => void = () => {};
    const api = {
      runWarcraftLogsAutoAudit: vi.fn(
        () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      ),
    };
    const timer = startWarcraftLogsAutoAuditLoop(api);
    await vi.advanceTimersByTimeAsync(WCL_AUTO_AUDIT_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(WCL_AUTO_AUDIT_INTERVAL_MS);
    expect(api.runWarcraftLogsAutoAudit).toHaveBeenCalledTimes(1);
    resolve();
    await vi.advanceTimersByTimeAsync(WCL_AUTO_AUDIT_INTERVAL_MS);
    expect(api.runWarcraftLogsAutoAudit).toHaveBeenCalledTimes(2);
    clearInterval(timer);
  });
});
