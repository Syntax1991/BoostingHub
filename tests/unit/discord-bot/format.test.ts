import { describe, expect, it } from "vitest";
import { characterLabel, discordTimestamp, mentionOrCharacter, pluralize } from "@/discord-bot/format";

describe("format helpers", () => {
  it("formats a Discord full-date timestamp tag", () => {
    const iso = "2026-09-24T20:00:00.000Z";
    expect(discordTimestamp(iso)).toBe(`<t:${Math.floor(new Date(iso).getTime() / 1000)}:F>`);
  });

  it("joins character name and realm", () => {
    expect(characterLabel("Stormhowl", "Twisting Nether")).toBe("Stormhowl-Twisting Nether");
    expect(characterLabel("Stormhowl", "")).toBe("Stormhowl");
  });

  it("mentions the Discord user when linked, falling back to Character-Realm", () => {
    expect(mentionOrCharacter("123", "Stormhowl", "Twisting Nether")).toBe("<@123> — Stormhowl-Twisting Nether");
    expect(mentionOrCharacter(null, "Stormhowl", "Twisting Nether")).toBe("Stormhowl-Twisting Nether");
  });

  it("pluralizes a count", () => {
    expect(pluralize(1, "signup")).toBe("1 signup");
    expect(pluralize(0, "signup")).toBe("0 signups");
    expect(pluralize(5, "signup")).toBe("5 signups");
  });
});
