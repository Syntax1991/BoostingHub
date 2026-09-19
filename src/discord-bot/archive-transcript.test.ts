import { describe, expect, it } from "vitest";
import {
  ARCHIVE_TRANSCRIPT_MESSAGE_CAP,
  buildArchiveServerInfoContent,
  buildArchiveTranscriptFilename,
  buildArchiveTranscriptHtml,
  summarizeTranscriptUsers,
} from "@/discord-bot/archive-transcript";

const BASE_MSG = {
  id: "m1",
  createdAt: "2026-09-12T20:00:00.000Z",
  authorDisplayName: "Titan",
  authorUsername: "titan",
  authorDiscriminator: "0",
  authorId: "u1",
  content: "Hello <world>",
  embeds: [{ title: "Signup", description: "Open now" }],
};

describe("buildArchiveTranscriptFilename", () => {
  it("prefixes transcript- and sanitizes the channel name", () => {
    expect(buildArchiveTranscriptFilename("closed-0337")).toBe("transcript-closed-0337.html");
    expect(buildArchiveTranscriptFilename("closed-sat-2200-hc-vip-7of9-titan")).toBe(
      "transcript-closed-sat-2200-hc-vip-7of9-titan.html",
    );
  });
});

describe("buildArchiveServerInfoContent", () => {
  it("matches Ticket Tool Server-Info layout posted above the file", () => {
    const text = buildArchiveServerInfoContent({
      serverName: "Phoenix Star",
      serverId: "1156899738508079134",
      channelName: "closed-0337",
      channelId: "1549448946466951189",
      messageCount: 21,
    });
    expect(text).toBe(
      [
        "```xml",
        "<Server-Info>",
        "  Server: Phoenix Star (1156899738508079134)",
        "  Channel: closed-0337 (1549448946466951189)",
        "  Messages: 21",
        "  Attachments Saved: 0",
        "  Attachments Skipped: 0 (due maximum file size limits.)",
        "```",
      ].join("\n"),
    );
  });
});

describe("summarizeTranscriptUsers", () => {
  it("aggregates message counts descending like Ticket Tool User-Info", () => {
    const stats = summarizeTranscriptUsers([
      BASE_MSG,
      { ...BASE_MSG, id: "m2", authorId: "u2", authorUsername: "other", authorDisplayName: "Other" },
      { ...BASE_MSG, id: "m3" },
    ]);
    expect(stats[0]).toMatchObject({ authorId: "u1", messageCount: 2, tag: "titan#0" });
    expect(stats[1]).toMatchObject({ authorId: "u2", messageCount: 1 });
  });
});

describe("buildArchiveTranscriptHtml", () => {
  it("starts with Ticket Tool Server-Info / User-Info / Base-Transcript headers", () => {
    const html = buildArchiveTranscriptHtml({
      serverName: "Phoenix Star",
      serverId: "g1",
      channelName: "closed-0337",
      channelId: "c1",
      runId: "run-1",
      messages: [BASE_MSG],
    });

    expect(html.startsWith("<Server-Info>")).toBe(true);
    expect(html).toContain("Server: Phoenix Star (g1)");
    expect(html).toContain("Channel: closed-0337 (c1)");
    expect(html).toContain("<User-Info>");
    expect(html).toContain("1 - titan#0 (u1)");
    expect(html).toContain("<Base-Transcript>");
    expect(html).toContain("Hello &lt;world&gt;");
    expect(html).toContain("Signup");
    expect(html).not.toContain("tickettool.xyz");
  });

  it("caps message count at the hard limit", () => {
    const messages = Array.from({ length: ARCHIVE_TRANSCRIPT_MESSAGE_CAP + 10 }, (_, i) => ({
      ...BASE_MSG,
      id: `m${i}`,
      content: `msg ${i}`,
    }));
    const html = buildArchiveTranscriptHtml({
      serverName: "S",
      serverId: "g",
      channelName: "ch",
      channelId: "c",
      runId: "r",
      messages,
    });
    expect(html).toContain(`Messages: ${ARCHIVE_TRANSCRIPT_MESSAGE_CAP}`);
    expect(html).not.toContain(`msg ${ARCHIVE_TRANSCRIPT_MESSAGE_CAP}`);
  });
});
