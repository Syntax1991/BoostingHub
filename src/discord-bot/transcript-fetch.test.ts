import { describe, expect, it, vi } from "vitest";
import { fetchChannelTranscript, type TranscriptSourceChannel } from "@/discord-bot/transcript-fetch";

type Msg = {
  id: string;
  createdTimestamp: number;
  author: { id: string; username: string; discriminator: string; displayName: string };
  content: string;
  embeds: [];
  attachments: Map<string, { name: string; url: string; size: number; contentType: string }>;
};

function message(i: number, withAttachment = false): Msg {
  return {
    id: `m${String(i).padStart(4, "0")}`,
    createdTimestamp: 1_700_000_000_000 + i * 1000,
    author: { id: "u1", username: "titan", discriminator: "0", displayName: "Titan" },
    content: `msg ${i}`,
    embeds: [],
    attachments: withAttachment
      ? new Map([["a1", { name: "proof.png", url: "https://cdn.discordapp.com/attachments/1/2/proof.png", size: 1234, contentType: "image/png" }]])
      : new Map(),
  };
}

/** Fake REST history: returns newest-first pages like Discord's `before` paging. */
function channelWith(total: number, withAttachments = false) {
  const all = Array.from({ length: total }, (_, i) => message(i, withAttachments));
  const fetch = vi.fn(async ({ limit, before }: { limit: number; before?: string }) => {
    const newestFirst = [...all].reverse();
    const start = before ? newestFirst.findIndex((m) => m.id === before) + 1 : 0;
    const page = newestFirst.slice(start, start + limit);
    return { size: page.length, values: () => page.values() };
  });
  return { channel: { messages: { fetch } } as unknown as TranscriptSourceChannel, fetch };
}

describe("fetchChannelTranscript", () => {
  it("returns messages oldest → newest", async () => {
    const { channel } = channelWith(150);
    const { messages } = await fetchChannelTranscript(channel);
    expect(messages.map((m) => m.content).slice(0, 2)).toEqual(["msg 0", "msg 1"]);
    expect(messages.at(-1)?.content).toBe("msg 149");
  });

  it("keeps the newest `cap` messages, pages ≤100 at a time, never copies attachments", async () => {
    const { channel, fetch } = channelWith(600, true);
    const { messages } = await fetchChannelTranscript(channel, { cap: 500 });
    expect(messages).toHaveLength(500);
    expect(messages.every((m) => !("attachments" in m))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(fetch.mock.calls.every(([options]) => options.limit <= 100)).toBe(true);
    // Newest 500 kept, like the original Run archive fetch.
    expect(messages[0].content).toBe("msg 100");
  });
});
