import { describe, expect, it } from "vitest";
import { runDiscordChannelUrl } from "@/lib/discord-links";

const GUILD = "1526980319826280509";
const CHANNEL = "1553838853834674226";

describe("runDiscordChannelUrl", () => {
  it("links the Run channel inside the configured guild", () => {
    expect(runDiscordChannelUrl({ guildId: GUILD, runChannelId: CHANNEL, archivedAt: null })).toBe(
      `https://discord.com/channels/${GUILD}/${CHANNEL}`,
    );
  });

  it("returns null without a channel, without a guild, or once archived", () => {
    expect(runDiscordChannelUrl({ guildId: GUILD, runChannelId: null, archivedAt: null })).toBeNull();
    expect(runDiscordChannelUrl({ guildId: "", runChannelId: CHANNEL, archivedAt: null })).toBeNull();
    expect(runDiscordChannelUrl({ guildId: undefined, runChannelId: CHANNEL, archivedAt: null })).toBeNull();
    expect(
      runDiscordChannelUrl({ guildId: GUILD, runChannelId: CHANNEL, archivedAt: "2026-10-10T00:00:00.000Z" }),
    ).toBeNull();
  });

  it("never builds a link from non-snowflake ids", () => {
    expect(runDiscordChannelUrl({ guildId: GUILD, runChannelId: "../evil", archivedAt: null })).toBeNull();
    expect(runDiscordChannelUrl({ guildId: "guild", runChannelId: CHANNEL, archivedAt: null })).toBeNull();
  });
});
