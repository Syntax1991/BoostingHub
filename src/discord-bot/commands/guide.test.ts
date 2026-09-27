import type { ChatInputCommandInteraction } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { buildGuideReply, handleGuideCommand } from "@/discord-bot/commands/guide";
import { GUIDE_CHANNEL_IDS, guideChannelUrl } from "@/discord-bot/guide-channels";

const OLD_BOOSTER_THREAD_ID = "1552698422677737694";
const OLD_RAIDLEAD_THREAD_ID = "1552709968879292546";

function buttonUrl(reply: ReturnType<typeof buildGuideReply>) {
  return (reply.components[0].toJSON().components[0] as { url?: string }).url;
}

function fakeInteraction(subcommand: string, guildId: string | null = "999") {
  const reply = vi.fn().mockResolvedValue(undefined);
  const interaction = {
    guildId,
    options: { getSubcommand: () => subcommand },
    reply,
  } as unknown as ChatInputCommandInteraction;
  return { interaction, reply };
}

describe("guide channels", () => {
  it("are the plain guide channels, never the old guide threads", () => {
    expect(GUIDE_CHANNEL_IDS).toEqual({ booster: "1552712971543650425", raidlead: "1553768153572708514" });
    expect(Object.values(GUIDE_CHANNEL_IDS)).not.toContain(OLD_BOOSTER_THREAD_ID);
    expect(Object.values(GUIDE_CHANNEL_IDS)).not.toContain(OLD_RAIDLEAD_THREAD_ID);
  });

  it("builds a Discord channel URL in the given guild", () => {
    expect(guideChannelUrl("123", "booster")).toBe("https://discord.com/channels/123/1552712971543650425");
    expect(guideChannelUrl("123", "raidlead")).toBe("https://discord.com/channels/123/1553768153572708514");
  });
});

describe("guide command", () => {
  it("/guide booster links to the Booster guide channel, in the content and as a link button", () => {
    const reply = buildGuideReply("123", "booster");
    const url = "https://discord.com/channels/123/1552712971543650425";
    expect(reply.content).toContain("Booster Guide");
    expect(reply.content).toContain(url);
    expect(buttonUrl(reply)).toBe(url);
    expect(JSON.stringify(reply.components.map((row) => row.toJSON()))).not.toContain(OLD_BOOSTER_THREAD_ID);
    expect(reply.content).not.toContain(OLD_BOOSTER_THREAD_ID);
  });

  it("/guide raidlead links to the Raid Lead guide channel", () => {
    const reply = buildGuideReply("123", "raidlead");
    const url = "https://discord.com/channels/123/1553768153572708514";
    expect(reply.content).toContain("Raid Lead Guide");
    expect(reply.content).toContain(url);
    expect(buttonUrl(reply)).toBe(url);
    expect(reply.content).not.toContain(OLD_RAIDLEAD_THREAD_ID);
  });

  it("replies ephemerally with the interaction's guild, falling back to the configured guild", async () => {
    const inGuild = fakeInteraction("booster", "999");
    await handleGuideCommand(inGuild.interaction, "111");
    expect(inGuild.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeral: true,
        content: expect.stringContaining("https://discord.com/channels/999/1552712971543650425"),
      }),
    );

    const noGuild = fakeInteraction("raidlead", null);
    await handleGuideCommand(noGuild.interaction, "111");
    expect(noGuild.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("https://discord.com/channels/111/1553768153572708514") }),
    );
  });

  it("ignores an unknown subcommand, as before", async () => {
    const unknown = fakeInteraction("toString");
    await handleGuideCommand(unknown.interaction, "111");
    expect(unknown.reply).not.toHaveBeenCalled();
  });
});
