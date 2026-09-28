import { describe, expect, it } from "vitest";
import { buildArchiveTranscriptHtml, transcriptMessageContent } from "@/discord-bot/archive-transcript";
import { fetchChannelTranscript, type TranscriptSourceChannel } from "@/discord-bot/transcript-fetch";
import type { MessageContentStatus } from "@/discord-bot/message-content";

/**
 * A Run channel modeled on the production transcript that showed "(no text)"
 * for most members: the Manawyrm Hub bot's own posts, members' text, a log
 * bot's report embed, an attachment, a sticker, a pin notice and hostile HTML.
 */
const APP = "900000000000000001";
const LOG_BOT = "900000000000000002";
const HOSTILE = `<script>alert(1)</script> & "quoted" 'single' <img src=x onerror="alert(2)"> </div><div>`;

type Raw = {
  id: string;
  authorId: string;
  name: string;
  content: string;
  embeds?: Array<{ title?: string | null; description?: string | null }>;
  attachments?: Array<{ name: string; size: number }>;
  stickers?: string[];
  components?: unknown[];
  system?: boolean;
  mentionsApp?: boolean;
  edited?: boolean;
};

const CHANNEL: Raw[] = [
  { id: "1001", authorId: APP, name: "Manawyrm Hub", content: "", embeds: [{ title: "Raidboost Announce", description: "HC VIP — see channel name" }] },
  { id: "1002", authorId: "700000000000000001", name: "Kael", content: "Can I join as healer?" },
  { id: "1003", authorId: "700000000000000002", name: "Mira", content: "line one\nline two", edited: true },
  { id: "1004", authorId: "700000000000000002", name: "Mira", content: "log: https://www.warcraftlogs.com/reports/FtwhWRvqjTbAx4NQ" },
  { id: "1005", authorId: LOG_BOT, name: "PhoenixStar Logs", content: "", embeds: [{ title: "Syntax started a new report", description: "https://www.warcraftlogs.com/reports/AbCdEfGhIjKlMnOp" }] },
  { id: "1006", authorId: "700000000000000001", name: "Kael", content: "", attachments: [{ name: `proof${HOSTILE}.png`, size: 2048 }] },
  { id: "1007", authorId: "700000000000000003", name: "Thorne", content: "", stickers: ["gg <b>wp</b>"] },
  { id: "1008", authorId: APP, name: "Manawyrm Hub", content: "Final Setup\nTanks: Kael, Thorne", components: [{}] },
  { id: "1009", authorId: "700000000000000003", name: "Thorne", content: "", system: true },
  { id: "1010", authorId: "700000000000000004", name: `Evil${HOSTILE}`, content: HOSTILE },
  { id: "1011", authorId: "700000000000000004", name: "Sylva", content: "@Manawyrm Hub are we starting?", mentionsApp: true },
];

/**
 * What Discord's REST history returns. Without Message Content access the
 * restricted fields (content, embeds, attachments, components, poll) of other
 * authors' messages come back empty — except messages that mention the app.
 * Stickers and system messages are not message content.
 */
function restChannel(access: boolean): TranscriptSourceChannel {
  const payload = CHANNEL.map((raw, index) => {
    const exempt = raw.authorId === APP || raw.mentionsApp === true;
    const visible = access || exempt;
    return {
      id: raw.id,
      createdTimestamp: Date.parse("2026-09-26T18:00:00Z") + index * 60_000,
      editedTimestamp: raw.edited ? Date.parse("2026-09-26T18:30:00Z") : null,
      author: { id: raw.authorId, username: raw.name.toLowerCase().slice(0, 12), discriminator: "0", displayName: raw.name },
      content: visible ? raw.content : "",
      embeds: visible ? (raw.embeds ?? []) : [],
      attachments: new Map(visible ? (raw.attachments ?? []).map((a, i) => [String(i), a] as const) : []),
      stickers: new Map((raw.stickers ?? []).map((name, i) => [String(i), { name }] as const)),
      components: visible ? (raw.components ?? []) : [],
      poll: null,
      system: raw.system === true,
      mentions: { users: new Set(raw.mentionsApp ? [APP] : []) },
    };
  });
  return {
    messages: {
      fetch: async ({ limit, before }) => {
        const newestFirst = [...payload].reverse();
        const start = before ? newestFirst.findIndex((m) => m.id === before) + 1 : 0;
        const page = newestFirst.slice(start, start + limit);
        return { size: page.length, values: () => page.values() };
      },
    },
  };
}

async function transcript(access: boolean, status: MessageContentStatus) {
  const { messages, messageContent } = await fetchChannelTranscript(restChannel(access), { appUserId: APP, messageContent: status });
  const html = buildArchiveTranscriptHtml({
    serverName: `Manawyrm ${HOSTILE}`,
    serverId: "800000000000000001",
    channelName: "closed-sat-1930-hc-vip",
    channelId: "800000000000000002",
    runId: "run-1",
    messages,
    messageContent: messageContent.capability,
  });
  const byId = new Map(messages.map((message) => [message.id, message]));
  return { messages, byId, messageContent, html };
}

const AVAILABLE: MessageContentStatus = { capability: "AVAILABLE", source: "APPLICATION_FLAGS" };
const UNAVAILABLE: MessageContentStatus = { capability: "UNAVAILABLE", source: "APPLICATION_FLAGS" };

describe("run transcript — Message Content AVAILABLE", () => {
  it("keeps every member's text, multiline text, links, bot posts, embeds and attachment metadata", async () => {
    const { byId, html } = await transcript(true, AVAILABLE);
    expect([...byId.values()].map((m) => [m.id, m.contentState])).toEqual([
      ["1001", "NON_TEXT"],
      ["1002", "TEXT"],
      ["1003", "TEXT"],
      ["1004", "TEXT"],
      ["1005", "NON_TEXT"],
      ["1006", "NON_TEXT"],
      ["1007", "NON_TEXT"],
      ["1008", "TEXT"],
      ["1009", "NON_TEXT"],
      ["1010", "TEXT"],
      ["1011", "TEXT"],
    ]);
    expect(html).toContain("Can I join as healer?");
    expect(html).toContain("line one\nline two");
    expect(html).toContain("(edited 2026-09-26 18:30:00 UTC)");
    expect(html).toContain("https://www.warcraftlogs.com/reports/FtwhWRvqjTbAx4NQ");
    expect(html).toContain("Final Setup\nTanks: Kael, Thorne");
    expect(html).toContain('<div class="embed-title">Raidboost Announce</div>');
    expect(html).toContain('<div class="embed-title">Syntax started a new report</div>');
    expect(html).toContain("Attachment: proof&lt;script&gt;");
    expect(html).toContain("(2.0 KB)");
    expect(html).toContain("Sticker: gg &lt;b&gt;wp&lt;/b&gt;");
    expect(html).toContain("<em>(system message)</em>");
    expect(html).toContain("Message Content: AVAILABLE");
    expect(html).toContain('<meta name="manawyrm-message-content" content="AVAILABLE">');
    expect(html).not.toContain("message content unavailable");
    expect(html).not.toContain('class="notice"');
  });
});

describe("run transcript — Message Content UNAVAILABLE (the production pattern)", () => {
  it("marks withheld member messages unavailable — never '(no text)' — and keeps what Discord still delivers", async () => {
    const { byId, html } = await transcript(false, UNAVAILABLE);
    // Members' text, the log bot's embed and the withheld attachment are unavailable — not "empty".
    for (const id of ["1002", "1003", "1004", "1005", "1006", "1010"]) {
      expect(byId.get(id)?.contentState).toBe("UNAVAILABLE");
    }
    // The app's own posts (text + embed), a message mentioning the app, a sticker and a pin notice are still real.
    expect(byId.get("1001")?.contentState).toBe("NON_TEXT");
    expect(byId.get("1008")?.contentState).toBe("TEXT");
    expect(byId.get("1011")?.contentState).toBe("TEXT");
    expect(byId.get("1007")?.contentState).toBe("NON_TEXT");
    expect(byId.get("1009")?.contentState).toBe("NON_TEXT");

    expect(html.match(/\(message content unavailable\)/g)).toHaveLength(6);
    expect(html).not.toContain("Can I join as healer?");
    expect(html).toContain('<div class="embed-title">Raidboost Announce</div>'); // own embed still visible
    expect(html).not.toContain("Syntax started a new report"); // a foreign embed is withheld, not shown as empty
    expect(html).toContain("Final Setup\nTanks: Kael, Thorne");
    expect(html).toContain("@Manawyrm Hub are we starting?");
    expect(html).toContain("Sticker: gg &lt;b&gt;wp&lt;/b&gt;");
    expect(html).not.toMatch(/<div class="content"><em>\(no text\)<\/em><\/div>\s*<\/div>/); // no silent "(no text)" for withheld messages
  });

  it("says so for the whole transcript: notice + PARTIAL metadata (some content was delivered)", async () => {
    const { messages, html } = await transcript(false, UNAVAILABLE);
    expect(transcriptMessageContent(messages, "UNAVAILABLE")).toEqual({ state: "PARTIAL", unavailable: 6, unknown: 0 });
    expect(html).toContain("Message Content: PARTIAL");
    expect(html).toContain('<meta name="manawyrm-message-content" content="PARTIAL">');
    expect(html).toContain("Some message text could not be archived because Discord Message Content access was unavailable to Manawyrm Hub.");
    expect(html).toContain("6 messages from other members");
  });

  it("a transcript of only withheld messages is UNAVAILABLE; unknown access with empty member messages is UNKNOWN", () => {
    expect(transcriptMessageContent([{ contentState: "UNAVAILABLE" }], "UNAVAILABLE").state).toBe("UNAVAILABLE");
    expect(transcriptMessageContent([{ contentState: "UNKNOWN" }, { contentState: "TEXT" }], "UNKNOWN").state).toBe("UNKNOWN");
    expect(transcriptMessageContent([{ contentState: "TEXT" }], "UNAVAILABLE").state).toBe("AVAILABLE");
  });

  it("unknown access that the channel itself proves (a member's text delivered) is treated as available", async () => {
    const { messageContent, byId } = await transcript(true, { capability: "UNKNOWN", source: "NONE" });
    expect(messageContent).toEqual({ capability: "AVAILABLE", source: "OBSERVED" });
    expect(byId.get("1009")?.contentState).toBe("NON_TEXT");
  });
});

describe("run transcript — HTML safety", () => {
  it("escapes every server- and user-controlled value; nothing becomes markup", async () => {
    for (const access of [true, false]) {
      const { html } = await transcript(access, access ? AVAILABLE : UNAVAILABLE);
      expect(html).not.toContain("<script>");
      expect(html).not.toContain("<img");
      expect(html).not.toContain('onerror="');
      expect(html).not.toContain("<b>wp");
      expect(html).toContain("Server: Manawyrm &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot; &#39;single&#39;");
      expect(html).toContain("<strong>Evil&lt;script&gt;");
    }
    const { html } = await transcript(true, AVAILABLE);
    expect(html).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot; &#39;single&#39; &lt;img src=x onerror=&quot;alert(2)&quot;&gt; &lt;/div&gt;&lt;div&gt;",
    );
  });
});
