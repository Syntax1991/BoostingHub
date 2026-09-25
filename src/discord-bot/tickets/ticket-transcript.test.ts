import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "@/discord-bot/archive-transcript";
import { buildTicketTranscriptFilename, buildTicketTranscriptHtml } from "@/discord-bot/tickets/ticket-transcript";
import { CREATOR_ID, REPORTED_ID, TICKET_CHANNEL_ID, ticketFixture } from "@/discord-bot/tickets/ticket-test-fixtures";

const MESSAGES: TranscriptMessage[] = [
  {
    id: "m1",
    createdAt: "2026-09-25T10:01:00.000Z",
    authorDisplayName: "Syntax",
    authorUsername: "syntax",
    authorDiscriminator: "0",
    authorId: CREATOR_ID,
    content: "Here is my proof <script>alert(1)</script>",
    attachments: [
      { name: "proof.png", url: "https://cdn.discordapp.com/attachments/1/2/proof.png", size: 2048 },
      { name: "evil.html", url: "javascript:alert(1)" },
    ],
  },
  {
    id: "m2",
    createdAt: "2026-09-25T10:02:00.000Z",
    authorDisplayName: "Staff",
    authorUsername: "staff",
    authorDiscriminator: "0",
    authorId: "400000000000000050",
    content: "Thanks, checking.",
    embeds: [{ title: "Note", description: "Embed body" }],
  },
];

function build(overrides: Partial<Parameters<typeof buildTicketTranscriptHtml>[0]> = {}) {
  return buildTicketTranscriptHtml({
    ticket: ticketFixture(),
    guildName: "Guild",
    guildId: "300000000000000001",
    channelName: "ticket-0042-syntax",
    channelId: TICKET_CHANNEL_ID,
    closedAt: "2026-09-25T12:00:00.000Z",
    closedByDiscordUserId: "400000000000000050",
    messages: MESSAGES,
    truncated: false,
    ...overrides,
  });
}

describe("buildTicketTranscriptHtml", () => {
  it("contains the ticket header fields", () => {
    const html = build();
    for (const text of [
      "Ticket #0042 — Raid Support",
      "#0042",
      "Raid Support",
      `Syntax (${CREATOR_ID})`,
      "ticket-0042-syntax",
      "2026-09-25 10:00:00 UTC",
      "2026-09-25 12:00:00 UTC",
      "400000000000000050",
      "Loot question",
      "Sat 22:00 HC",
    ]) {
      expect(html).toContain(text);
    }
  });

  it("renders messages oldest → newest with author, id, timestamp, content and embeds", () => {
    const html = build();
    expect(html.indexOf("Here is my proof")).toBeLessThan(html.indexOf("Thanks, checking."));
    expect(html).toContain(`(${CREATOR_ID})`);
    expect(html).toContain("2026-09-25 10:01:00 UTC");
    expect(html).toContain("Embed body");
  });

  it("escapes message content", () => {
    const html = build();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("represents attachments as name + Discord link only; unsafe URLs are not linked", () => {
    const html = build();
    expect(html).toContain('<a href="https://cdn.discordapp.com/attachments/1/2/proof.png"');
    expect(html).toContain("proof.png</a>");
    expect(html).toContain("2048 bytes");
    expect(html).toContain("<li>evil.html</li>");
    expect(html).not.toContain("javascript:alert");
    expect(html).not.toContain("data:image");
  });

  it("says clearly when the transcript is truncated", () => {
    expect(build()).not.toContain("Transcript truncated");
    expect(build({ truncated: true })).toContain("Transcript truncated");
  });

  it("Report a Booster includes the reported Booster", () => {
    const html = build({
      ticket: ticketFixture({ type: "REPORT_BOOSTER", reportedDiscordUserId: REPORTED_ID, reportedBoosterLabel: "Titanpal" }),
    });
    expect(html).toContain("Reported Booster");
    expect(html).toContain(`Titanpal (${REPORTED_ID})`);
  });

  it("uses a safe transcript filename", () => {
    expect(buildTicketTranscriptFilename("ticket-0042-syntax")).toBe("transcript-ticket-0042-syntax.html");
  });
});
