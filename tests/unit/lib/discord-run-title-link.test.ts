import { describe, expect, it } from "vitest";
import { formatDiscordRunTitleLink } from "@/lib/discord-run-title-link";

describe("formatDiscordRunTitleLink", () => {
  const ZWSP = String.fromCharCode(0x200b);

  it("returns a Discord markdown link when the public origin is configured", () => {
    expect(
      formatDiscordRunTitleLink("Mon 19:30 HC VIP 7/9 Nyxara", "run-123", {
        BETTER_AUTH_URL: "https://example.test",
        NODE_ENV: "test",
      }),
    ).toBe("[Mon 19:30 HC VIP 7/9 Nyxara](https://example.test/runs/run-123)");
  });

  it("strips a trailing slash on the origin", () => {
    expect(
      formatDiscordRunTitleLink("Mon 19:30 HC VIP 7/9 Nyxara", "run-123", {
        BETTER_AUTH_URL: "https://example.test/",
        NODE_ENV: "test",
      }),
    ).toBe("[Mon 19:30 HC VIP 7/9 Nyxara](https://example.test/runs/run-123)");
  });

  it("falls back to the plain escaped title when the origin is missing", () => {
    expect(formatDiscordRunTitleLink("Mon 19:30 HC VIP 7/9 Nyxara", "run-123", { NODE_ENV: "production" })).toBe(
      "Mon 19:30 HC VIP 7/9 Nyxara",
    );
  });

  it("escapes markdown-sensitive titles so they cannot break the link label", () => {
    expect(
      formatDiscordRunTitleLink("Evil](https://evil.test) **Bold**", "run-123", {
        BETTER_AUTH_URL: "https://example.test",
        NODE_ENV: "test",
      }),
    ).toBe("[Evil\\](https://evil.test) \\*\\*Bold\\*\\*](https://example.test/runs/run-123)");
  });

  it("neutralises @everyone / @here in the link label", () => {
    const linked = formatDiscordRunTitleLink("@everyone Mon HC", "run-123", {
      BETTER_AUTH_URL: "https://example.test",
      NODE_ENV: "test",
    });
    expect(linked).toBe(`[@${ZWSP}everyone Mon HC](https://example.test/runs/run-123)`);
    expect(linked).not.toMatch(/@everyone/);
    expect(
      formatDiscordRunTitleLink("@here Mon HC", "run-123", {
        BETTER_AUTH_URL: "https://example.test",
        NODE_ENV: "test",
      }),
    ).not.toMatch(/@here/);
  });
});
