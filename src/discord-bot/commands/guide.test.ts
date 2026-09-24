import { describe, expect, it } from "vitest";
import { buildGuideReply, guideThreadUrl } from "@/discord-bot/commands/guide";

describe("guide command", () => {
  it("links to the booster guide thread in the given guild", () => {
    expect(guideThreadUrl("123")).toBe("https://discord.com/channels/123/1552698422677737694");
  });

  it("includes the thread link in the content and a link button", () => {
    const reply = buildGuideReply("123");
    expect(reply.content).toContain("https://discord.com/channels/123/1552698422677737694");
    const button = reply.components[0].toJSON().components[0] as { url?: string; style: number };
    expect(button.url).toBe("https://discord.com/channels/123/1552698422677737694");
  });
});
