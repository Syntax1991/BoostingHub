import { afterEach, describe, expect, it, vi } from "vitest";
import { BotApiError } from "@/discord-bot/bot-api-client";
import {
  WCL_AUTO_AUDIT_INTERVAL_MS,
  WCL_CHANNEL_SCAN_INTERVAL_MS,
  WCL_FINAL_SCAN_MAX_DEFER_MS,
  WCL_LOG_CHANNEL_RETRY_HORIZON_MS,
  WCL_SCAN_MAX_PAGES_PER_PASS,
  WCL_SCAN_PAGE_SIZE,
  createReportScanState,
  findTrustedReportLinks,
  scanChannelFromCursor,
  scanReportChannels,
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
    vi.spyOn(console, "warn").mockImplementation(() => {});
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

  it("moves on past a permanent Bot API rejection (e.g. no longer this Run's channel), but retries 401/5xx", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const scan = (error: Error) =>
      scanChannelFromCursor({
        runId: "run-1",
        channelId: "chan-1",
        cursor: "999",
        trustedAuthorIds: trusted,
        fetchPage: fakeChannel(history(5, 2)).fetchPage,
        attach: vi.fn(async () => {
          throw error;
        }),
        maxPages: 5,
      });
    for (const status of [403, 404, 409]) {
      expect(await scan(new BotApiError(status, "NOT_AUTHORIZED", "refused"))).toEqual({
        cursor: "1004",
        reachedEnd: true,
        blocked: false,
      });
    }
    for (const status of [401, 429, 500]) {
      expect(await scan(new BotApiError(status, "INTERNAL", "try later"))).toEqual({
        cursor: "1001",
        reachedEnd: false,
        blocked: true,
      });
    }
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

describe("Warcraft Logs links and Discord Message Content access", () => {
  const trusted = new Set([LOG_BOT]);
  /** The log bot's post as REST returns it: with access, or with its restricted fields withheld. */
  const logBotPost = (id: string, where: "text" | "embed", access: boolean): ScannableMessage =>
    message({
      id,
      authorId: LOG_BOT,
      content: access && where === "text" ? `Syntax_gg started a new report ${URL_A}` : "",
      embeds: access && where === "embed" ? [{ title: "New report", url: URL_A, description: null, fields: [] }] : [],
    });

  it("visible text link and visible embed link from the trusted log bot are detected", () => {
    expect(findTrustedReportLinks([logBotPost("1", "text", true)], trusted).map((l) => l.reportCode)).toEqual(["FtwhWRvqjTbAx4NQ"]);
    expect(findTrustedReportLinks([logBotPost("2", "embed", true)], trusted).map((l) => l.reportCode)).toEqual(["FtwhWRvqjTbAx4NQ"]);
  });

  it("withheld content (no access) is no link — nothing is attached, the cursor moves past it, no retry", async () => {
    const channel = fakeChannel([logBotPost("1001", "text", false), logBotPost("1002", "embed", false), message({ id: "1003" })]);
    const attach = vi.fn(async () => ({ status: "ATTACHED" }));
    const result = await scanChannelFromCursor({
      runId: "run-1",
      channelId: "chan-1",
      cursor: "999",
      trustedAuthorIds: trusted,
      fetchPage: channel.fetchPage,
      attach,
      maxPages: 5,
    });
    expect(attach).not.toHaveBeenCalled();
    expect(result).toEqual({ cursor: "1003", reachedEnd: true, blocked: false });
  });

  it("an untrusted author's visible link stays ignored", () => {
    expect(findTrustedReportLinks([message({ id: "1", authorId: BOOSTER, content: URL_A })], trusted)).toEqual([]);
  });

  it("a retiring channel with withheld content finishes its final scan at once — archival is never held back", async () => {
    const channel = fakeChannel(Array.from({ length: 250 }, (_, i) => logBotPost(String(1000 + i), "text", false)));
    const saveCursor = vi.fn(async () => {});
    const deferred = await scanRunChannelsForReports({
      items: [{ runId: "run-9", channelId: "chan-9", scanWarcraftLogs: true, retireChannel: true, warcraftLogsScanCursor: "999" }],
      trustedAuthorIds: [LOG_BOT],
      fetchPage: channel.fetchPage,
      attach: vi.fn(async () => ({ status: "ATTACHED" })),
      saveCursor,
      state: createReportScanState(),
      now: 0,
    });
    expect(deferred).toEqual(new Set());
    expect(saveCursor).toHaveBeenCalledWith("run-9", "chan-9", "1249");
  });
});

describe("scanReportChannels — dedicated Warcraft Logs log channel", () => {
  // Modeled on production: a webhook ("Manawyrm Logging") posts every Run's report into one channel,
  // the report link only in an embed. Discord sets author.id to the webhook id.
  const LOG_CHANNEL = "1553838853834674226";
  const WEBHOOK = "1554176548435918910";
  const reportPost = (id: string, code: string): ScannableMessage =>
    message({ id, authorId: WEBHOOK, content: "", embeds: [{ title: "New report", url: `https://www.warcraftlogs.com/reports/${code}`, description: null, fields: [] }] });
  const channelHistory = () =>
    fakeChannel([
      message({ id: "1001", content: `someone else: ${URL_B}` }), // untrusted author — ignored
      reportPost("1002", "FtwhWRvqjTbAx4NQ"),
      message({ id: "1003", content: "chatter" }),
      reportPost("1004", "Kp3xZm9QwLr7Vt2N"),
    ]);
  const setup = (history = channelHistory()) => {
    type Link = { channelId: string; messageId: string; authorId: string; reportCode: string };
    const record = vi.fn<(link: Link) => Promise<{ status: string }>>(async () => ({ status: "RECORDED" }));
    const saveCursor = vi.fn<(channelId: string, messageId: string) => Promise<void>>(async () => {});
    const state = createReportScanState();
    const scan = (cursor = "999", now = 0, channels = [{ channelId: LOG_CHANNEL, cursor }]) =>
      scanReportChannels({ channels, trustedAuthorIds: [WEBHOOK], fetchPage: history.fetchPage, record, saveCursor, state, now });
    return { history, record, saveCursor, scan };
  };

  it("records every trusted embed link once, with the channel + message it came from, and saves the cursor", async () => {
    const { record, saveCursor, scan, history } = setup();
    await scan();
    expect(record.mock.calls.map(([input]) => input)).toEqual([
      { reportCode: "FtwhWRvqjTbAx4NQ", messageId: "1002", authorId: WEBHOOK, channelId: LOG_CHANNEL },
      { reportCode: "Kp3xZm9QwLr7Vt2N", messageId: "1004", authorId: WEBHOOK, channelId: LOG_CHANNEL },
    ]);
    expect(saveCursor).toHaveBeenCalledWith(LOG_CHANNEL, "1004");
    expect(history.calls).toHaveLength(1); // one bounded read, not one per Run
  });

  it("is read at most once a minute, and a restart continues after the durable cursor", async () => {
    const { record, scan, history } = setup();
    await scan("999", 0);
    await scan("999", WCL_CHANNEL_SCAN_INTERVAL_MS - 1);
    expect(history.calls).toHaveLength(1);
    // After a restart the server hands back the saved cursor: nothing is re-read or re-recorded.
    const restarted = setup(history);
    await restarted.scan("1004", 0);
    expect(restarted.record).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledTimes(2);
  });

  it("a repeat of the same message (already recorded) is fine and still moves the cursor", async () => {
    const { record, saveCursor, scan } = setup();
    record.mockResolvedValue({ status: "ALREADY_RECORDED" });
    await scan();
    expect(saveCursor).toHaveBeenCalledWith(LOG_CHANNEL, "1004");
  });

  it("untrusted authors and other channels are ignored; no trusted author means no read at all", async () => {
    const { record, history } = setup();
    await scanReportChannels({ channels: [{ channelId: LOG_CHANNEL, cursor: "999" }], trustedAuthorIds: [], fetchPage: history.fetchPage, record, saveCursor: vi.fn(), state: createReportScanState() });
    expect(history.calls).toHaveLength(0);
    const other = setup(fakeChannel([message({ id: "2001", authorId: BOOSTER, content: URL_A })]));
    await other.scan();
    expect(other.record).not.toHaveBeenCalled();
  });

  it("a transport error keeps the cursor before that message; a permanent rejection (403) moves on", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = setup();
    failing.record.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await failing.scan();
    expect(failing.saveCursor).toHaveBeenCalledWith(LOG_CHANNEL, "1001"); // stays before 1002, re-read next time
    expect(failing.record).toHaveBeenLastCalledWith(expect.objectContaining({ messageId: "1004" })); // later reports still delivered
    const rejected = setup();
    rejected.record.mockRejectedValue(new BotApiError(403, "NOT_AUTHORIZED", "not a configured log channel"));
    await rejected.scan();
    expect(rejected.saveCursor).toHaveBeenCalledWith(LOG_CHANNEL, "1004");
  });

  it.each([
    [400, "advance"], [403, "advance"], [404, "advance"], [409, "advance"], [422, "advance"],
    [401, "retry"], [429, "retry"], [500, "retry"], [503, "retry"],
  ] as const)("server %i on a trusted link → %s that message", async (status, expected) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { record, saveCursor, scan } = setup();
    record.mockImplementation(async (link) => {
      if (link.messageId === "1002") throw new BotApiError(status, "X", "refused");
      return { status: "RECORDED" };
    });
    await scan();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ messageId: "1004" }));
    expect(saveCursor).toHaveBeenCalledWith(LOG_CHANNEL, expected === "advance" ? "1004" : "1001");
  });

  it("one message that keeps failing never wedges the channel: later reports flow, and it is given up after the horizon", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { record, saveCursor, scan } = setup();
    record.mockImplementation(async (link) => {
      if (link.messageId === "1002") throw new BotApiError(500, "INTERNAL", "boom");
      return { status: "RECORDED" };
    });
    const posted = 1_420_070_400_000; // Discord epoch — the time encoded in these tiny test ids
    await scan("999", posted + 60_000);
    await scan("1001", posted + 5 * 60_000);
    expect(saveCursor.mock.calls).toEqual([[LOG_CHANNEL, "1001"]]); // held, not advanced past 1002
    expect(record.mock.calls.filter(([link]) => link.messageId === "1004")).toHaveLength(2);
    await scan("1001", posted + WCL_LOG_CHANNEL_RETRY_HORIZON_MS + 60_000);
    expect(saveCursor).toHaveBeenLastCalledWith(LOG_CHANNEL, "1004");
  });

  it("two reports in one message: if the second fails, the message is re-read and the first is only re-confirmed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const both = message({ id: "1002", authorId: WEBHOOK, content: `${URL_A}
${URL_B}` });
    const { record, saveCursor, scan } = setup(fakeChannel([both, message({ id: "1003" })]));
    const stored = new Set<string>();
    let failB = true;
    record.mockImplementation(async (link) => {
      if (link.reportCode === "AbCdEfGhIjKlMnOp" && failB) throw new Error("ECONNRESET");
      const already = stored.has(link.reportCode);
      stored.add(link.reportCode);
      return { status: already ? "ALREADY_RECORDED" : "RECORDED" };
    });
    await scan("999", 0);
    expect(saveCursor).not.toHaveBeenCalled(); // nothing fully processed before 1002
    failB = false;
    await scan("999", WCL_CHANNEL_SCAN_INTERVAL_MS);
    expect(record.mock.calls.map(([link]) => link.reportCode)).toEqual([
      "FtwhWRvqjTbAx4NQ", "AbCdEfGhIjKlMnOp", "FtwhWRvqjTbAx4NQ", "AbCdEfGhIjKlMnOp",
    ]);
    expect([...stored]).toEqual(["FtwhWRvqjTbAx4NQ", "AbCdEfGhIjKlMnOp"]);
    expect(saveCursor).toHaveBeenCalledWith(LOG_CHANNEL, "1003");
  });

  it("a Discord failure (e.g. rate limit) never breaks the sync loop and saves no cursor", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const record = vi.fn(async () => ({ status: "RECORDED" }));
    const saveCursor = vi.fn(async () => {});
    await expect(
      scanReportChannels({
        channels: [{ channelId: LOG_CHANNEL, cursor: "999" }],
        trustedAuthorIds: [WEBHOOK],
        fetchPage: async () => {
          throw Object.assign(new Error("You are being rate limited."), { status: 429 });
        },
        record,
        saveCursor,
        state: createReportScanState(),
      }),
    ).resolves.toBeUndefined();
    expect(saveCursor).not.toHaveBeenCalled();
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
