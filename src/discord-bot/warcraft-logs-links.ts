import { BotApiError } from "@/discord-bot/bot-api-client";
import { compareSnowflakes } from "@/lib/discord-snowflake";
import { extractWarcraftLogsReportCodes } from "@/lib/warcraft-logs";

/**
 * Auto-link Warcraft Logs reports posted by a trusted log bot (e.g.
 * "PhoenixStar Logs: <user> started a new report <url>") in a Run's own
 * Discord channel. Reads channel history over REST — no extra gateway intent.
 * The bot only filters; the Bot API re-checks author, channel and Run status.
 *
 * Lossless by construction: every message after a durable per-channel cursor
 * (RunDiscordPost.warcraftLogsScanCursor, seeded from the Run start) is read
 * oldest → newest, page by page. The cursor only advances past messages that
 * were fully processed, never past a trusted link whose attach must be retried,
 * and a retiring channel is scanned to its end before it may be deleted.
 */

/** Minimum spacing between routine scans of one Run channel. */
export const WCL_CHANNEL_SCAN_INTERVAL_MS = 60_000;
/** Discord's maximum page size for channel history. */
export const WCL_SCAN_PAGE_SIZE = 100;
/** Routine scans stop after this many pages (1 000 messages) and continue next pass. */
export const WCL_SCAN_MAX_PAGES_PER_PASS = 10;
/** The final scan before channel deletion may read further in one go. */
export const WCL_FINAL_SCAN_MAX_PAGES = 50;
/** Upper bound for holding back a channel deletion because its final scan cannot finish. */
export const WCL_FINAL_SCAN_MAX_DEFER_MS = 30 * 60_000;
/** Cadence of the post-completion auto-audit trigger. */
export const WCL_AUTO_AUDIT_INTERVAL_MS = 5 * 60_000;

export type ScannableMessage = {
  id: string;
  authorId: string;
  content: string;
  embeds: Array<{
    title?: string | null;
    description?: string | null;
    url?: string | null;
    fields?: Array<{ name?: string | null; value?: string | null }> | null;
  }>;
};

export type TrustedReportLink = { reportCode: string; messageId: string; authorId: string };

/** Report links from trusted authors only, oldest message first, one per report code. */
export function findTrustedReportLinks(
  messages: ScannableMessage[],
  trustedAuthorIds: ReadonlySet<string>,
): TrustedReportLink[] {
  const links: TrustedReportLink[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (!trustedAuthorIds.has(message.authorId)) continue;
    const text = [
      message.content,
      ...message.embeds.flatMap((embed) => [
        embed.title ?? "",
        embed.description ?? "",
        embed.url ?? "",
        ...(embed.fields ?? []).flatMap((field) => [field.name ?? "", field.value ?? ""]),
      ]),
    ].join("\n");
    for (const reportCode of extractWarcraftLogsReportCodes(text)) {
      if (seen.has(reportCode)) continue;
      seen.add(reportCode);
      links.push({ reportCode, messageId: message.id, authorId: message.authorId });
    }
  }
  return links;
}

/** One page of channel history: newest page without `after`, else the page right after it. */
export type FetchMessagePage = (
  channelId: string,
  options: { after?: string; limit: number },
) => Promise<ScannableMessage[]>;

export type AttachReport = (
  runId: string,
  input: { reportCode: string; channelId: string; messageId: string; authorId: string },
) => Promise<{ status: string; retryable?: boolean }>;

/**
 * The Bot API refused the link for a reason a retry cannot change (untrusted
 * author, not this Run's channel, Run not found / not running or completed,
 * invalid body). Anything else — transport errors, 401 (token), 429, 5xx —
 * is retried so no link is lost.
 */
function isPermanentRejection(error: unknown): boolean {
  return error instanceof BotApiError && [400, 403, 404, 409, 422].includes(error.status);
}

export type SaveScanCursor = (runId: string, channelId: string, messageId: string) => Promise<void>;

export type ChannelScanResult = {
  /** Newest fully processed message id (unchanged when nothing new). */
  cursor: string | null;
  /** Read up to the newest message in the channel. */
  reachedEnd: boolean;
  /** Stopped at a trusted link whose attach must be retried. */
  blocked: boolean;
};

/**
 * Process one channel from `cursor` onwards. Without a cursor (Run start
 * unknown) only the newest page is read and becomes the starting point.
 */
export async function scanChannelFromCursor(input: {
  runId: string;
  channelId: string;
  cursor: string | null;
  trustedAuthorIds: ReadonlySet<string>;
  fetchPage: FetchMessagePage;
  attach: AttachReport;
  maxPages: number;
}): Promise<ChannelScanResult> {
  let cursor = input.cursor;
  for (let page = 0; page < input.maxPages; page += 1) {
    const batch = await input.fetchPage(
      input.channelId,
      cursor ? { after: cursor, limit: WCL_SCAN_PAGE_SIZE } : { limit: WCL_SCAN_PAGE_SIZE },
    );
    const ordered = [...batch].sort((a, b) => compareSnowflakes(a.id, b.id));
    for (const message of ordered) {
      if (cursor && compareSnowflakes(message.id, cursor) <= 0) continue;
      for (const link of findTrustedReportLinks([message], input.trustedAuthorIds)) {
        const context = {
          runId: input.runId,
          channelId: input.channelId,
          messageId: link.messageId,
          authorId: link.authorId,
          reportCode: link.reportCode,
        };
        let retry: boolean;
        try {
          const result = await input.attach(input.runId, { ...link, channelId: input.channelId });
          retry = result.status === "FAILED" && result.retryable !== false;
          const outcome =
            result.status === "ATTACHED"
              ? "attached"
              : result.status === "ALREADY_ATTACHED"
                ? "already-attached"
                : retry
                  ? "retry"
                  : "failed";
          console.log("[discord-bot] warcraft-logs link", { ...context, result: outcome });
        } catch (error) {
          retry = !isPermanentRejection(error);
          const code = error instanceof BotApiError ? error.code : undefined;
          console.warn("[discord-bot] warcraft-logs link", { ...context, result: retry ? "retry" : "rejected", code });
        }
        // Keep the cursor before this message so it is read again next time.
        if (retry) return { cursor, reachedEnd: false, blocked: true };
      }
      cursor = message.id;
    }
    // No cursor: the newest page is the starting point by definition.
    if (!input.cursor && page === 0) return { cursor, reachedEnd: true, blocked: false };
    if (batch.length < WCL_SCAN_PAGE_SIZE) return { cursor, reachedEnd: true, blocked: false };
  }
  return { cursor, reachedEnd: false, blocked: false };
}

/** Per-process memory: routine-scan throttle and how long a final scan has been failing. */
export type ReportScanState = {
  lastScanAt: Map<string, number>;
  finalScanFailingSince: Map<string, number>;
};

export function createReportScanState(): ReportScanState {
  return { lastScanAt: new Map(), finalScanFailingSince: new Map() };
}

/**
 * Scan every flagged Run channel. Routine scans are throttled per channel;
 * a retiring channel gets an unthrottled final scan to its end. Returns the
 * Runs whose channel deletion must wait because that final scan could not
 * finish (bounded by WCL_FINAL_SCAN_MAX_DEFER_MS).
 */
export async function scanRunChannelsForReports(input: {
  items: Array<{
    runId: string;
    channelId: string | null;
    scanWarcraftLogs?: boolean;
    retireChannel: boolean;
    warcraftLogsScanCursor?: string | null;
  }>;
  trustedAuthorIds: readonly string[];
  fetchPage: FetchMessagePage;
  attach: AttachReport;
  saveCursor: SaveScanCursor;
  state: ReportScanState;
  now?: number;
}): Promise<Set<string>> {
  const deferRetirement = new Set<string>();
  if (input.trustedAuthorIds.length === 0) return deferRetirement;
  const trusted = new Set(input.trustedAuthorIds);
  const now = input.now ?? Date.now();

  for (const item of input.items) {
    if (!item.scanWarcraftLogs || !item.channelId) continue;
    const final = item.retireChannel;
    if (!final) {
      const last = input.state.lastScanAt.get(item.runId);
      if (last !== undefined && now - last < WCL_CHANNEL_SCAN_INTERVAL_MS) continue;
      input.state.lastScanAt.set(item.runId, now);
    }

    const startCursor = item.warcraftLogsScanCursor ?? null;
    let complete = false;
    try {
      const result = await scanChannelFromCursor({
        runId: item.runId,
        channelId: item.channelId,
        cursor: startCursor,
        trustedAuthorIds: trusted,
        fetchPage: input.fetchPage,
        attach: input.attach,
        maxPages: final ? WCL_FINAL_SCAN_MAX_PAGES : WCL_SCAN_MAX_PAGES_PER_PASS,
      });
      if (result.cursor && result.cursor !== startCursor) {
        try {
          await input.saveCursor(item.runId, item.channelId, result.cursor);
        } catch (error) {
          // Harmless: the next pass re-reads from the old cursor; attaching is idempotent.
          console.warn(`[discord-bot] could not save Warcraft Logs scan cursor for run ${item.runId}`, error);
        }
      }
      complete = result.reachedEnd && !result.blocked;
    } catch (error) {
      console.warn(`[discord-bot] could not read run ${item.runId} channel for Warcraft Logs links`, error);
    }

    if (!final) continue;
    if (complete) {
      input.state.finalScanFailingSince.delete(item.runId);
      continue;
    }
    const since = input.state.finalScanFailingSince.get(item.runId) ?? now;
    input.state.finalScanFailingSince.set(item.runId, since);
    if (now - since < WCL_FINAL_SCAN_MAX_DEFER_MS) {
      deferRetirement.add(item.runId);
    } else {
      console.warn(
        `[discord-bot] final Warcraft Logs scan for run ${item.runId} kept failing — no longer holding back channel retirement`,
      );
    }
  }
  return deferRetirement;
}

/**
 * Periodically ask the API to run due post-completion Consumables Audits.
 * The API decides what is due (delay, attempts, lock); the bot only ticks.
 */
export function startWarcraftLogsAutoAuditLoop(api: {
  runWarcraftLogsAutoAudit(): Promise<unknown>;
}): NodeJS.Timeout {
  let inFlight = false;
  return setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    api
      .runWarcraftLogsAutoAudit()
      .catch((error) => console.error("[discord-bot] Warcraft Logs auto audit trigger failed", error))
      .finally(() => {
        inFlight = false;
      });
  }, WCL_AUTO_AUDIT_INTERVAL_MS);
}
