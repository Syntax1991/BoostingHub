import { afterEach, describe, expect, it, vi } from "vitest";
import { discordTimestamp } from "@/lib/discord-timestamp";
import {
  buildRunCancelledChannelEmbed,
  buildRunReactivatedChannelEmbed,
  buildRunRescheduledChannelEmbed,
} from "@/discord-bot/embeds/run-lifecycle-announcement";

describe("run lifecycle channel embeds", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("links reschedule embed title to the canonical run page", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("BETTER_AUTH_URL", "https://example.test");
    const oldIso = "2026-10-01T18:00:00.000Z";
    const newIso = "2026-10-01T20:00:00.000Z";
    const json = buildRunRescheduledChannelEmbed({
      runId: "run-123",
      productLabel: "Season 2 Bundle",
      previousScheduledStartAt: oldIso,
      scheduledStartAt: newIso,
      difficulty: "HEROIC",
      lootType: "VIP",
    }).toJSON();
    expect(json.title).toBe("📅 Run Rescheduled");
    expect(json.url).toBe("https://example.test/runs/run-123");
    expect(json.description).toContain(discordTimestamp(oldIso, "F"));
    expect(json.description).toContain(discordTimestamp(newIso, "F"));
  });

  it("links cancel embed title to the canonical run page", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("BETTER_AUTH_URL", "https://example.test");
    const when = "2026-10-02T19:00:00.000Z";
    const json = buildRunCancelledChannelEmbed({
      runId: "run-123",
      productLabel: "Season 2 Bundle",
      scheduledStartAt: when,
      difficulty: "HEROIC",
      lootType: "VIP",
    }).toJSON();
    expect(json.title).toBe("❌ Run Cancelled");
    expect(json.url).toBe("https://example.test/runs/run-123");
    expect(json.description).toContain("Season 2 Bundle");
    expect(json.description).toContain(discordTimestamp(when, "F"));
  });

  it("links reactivate embed title to the canonical run page", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("BETTER_AUTH_URL", "https://example.test");
    const when = "2026-10-03T19:00:00.000Z";
    const json = buildRunReactivatedChannelEmbed({
      runId: "run-123",
      productLabel: "Season 2 Bundle",
      scheduledStartAt: when,
      difficulty: "HEROIC",
      lootType: "VIP",
    }).toJSON();
    expect(json.title).toBe("✅ Run Reactivated");
    expect(json.url).toBe("https://example.test/runs/run-123");
    expect(json.description).toContain("Season 2 Bundle");
    expect(json.description).toContain(discordTimestamp(when, "F"));
  });

  it("still builds lifecycle embeds and omits the URL when production has no base URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_URL", "");
    const when = "2026-10-02T19:00:00.000Z";
    const cancelled = buildRunCancelledChannelEmbed({
      runId: "run-123",
      productLabel: "Season 2 Bundle",
      scheduledStartAt: when,
      difficulty: "HEROIC",
      lootType: "VIP",
    }).toJSON();
    expect(cancelled.title).toBe("❌ Run Cancelled");
    expect(cancelled.url).toBeUndefined();
  });
});
