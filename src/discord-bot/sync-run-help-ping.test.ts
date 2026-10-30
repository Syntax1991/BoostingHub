import { Collection, type Client } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type { BotApiClient } from "@/discord-bot/bot-api-client";
import { syncRunAnnouncement } from "@/discord-bot/sync-loop";
import type { CustomPing } from "@/lib/late-fill-help";

/**
 * The real bot path of a Ping roles request: delivery authority → the Run
 * channel from the work item → exactly one message → delivery report.
 */

const pingRoleIds = { TANK: "900", HEALER: "901", DPS: "902" };
const guildRoles = new Collection(
  [
    { id: "902", name: "DPS", managed: false },
    { id: "950", name: "Warlock", managed: false },
    { id: "960", name: "Lootbuddy", managed: false },
    { id: "970", name: "Booster", managed: false },
    { id: "951", name: "Mage", managed: false },
    { id: "952", name: "Mage", managed: false },
  ].map((role) => [role.id, role]),
);

function harness(options: { deliver?: boolean; send?: () => Promise<unknown>; fetchError?: unknown } = {}) {
  const send = vi.fn(options.send ?? (async () => ({})));
  const fetch = vi.fn(async (id: string) => {
    if (options.fetchError) throw options.fetchError;
    return { id, isTextBased: () => true, send, guild: { roles: { cache: guildRoles } } };
  });
  const recordDiscordState = vi.fn(async () => undefined);
  const api = {
    confirmRunAnnouncementDelivery: vi.fn(async () => ({ deliver: options.deliver ?? true })),
    recordDiscordState,
  } as unknown as BotApiClient;
  return { client: { channels: { fetch } } as unknown as Client, api, send, fetch, recordDiscordState };
}

function item(overrides: { helpCustom?: CustomPing | null; announcementId?: string; helpClasses?: Array<"WARLOCK">; helpRoles?: Array<{ role: "DPS"; missing: number }> } = {}) {
  return {
    announcementId: overrides.announcementId ?? crypto.randomUUID(),
    runId: "run-1",
    type: "LATE_FILL_HELP" as const,
    runChannelId: "run-channel-1",
    previousScheduledStartAt: null,
    helpRoles: overrides.helpRoles ?? [{ role: "DPS" as const, missing: 3 }],
    helpClasses: overrides.helpClasses ?? [],
    helpCustom: overrides.helpCustom ?? null,
    scheduledStartAt: "2026-11-01T18:00:00.000Z",
    productLabel: "Coiled Altar",
    difficulty: "HEROIC" as const,
    lootType: "SAVED" as const,
  };
}

const custom: CustomPing = { text: "Need 1 LB for Coiled Altar", roles: ["LOOTBUDDY"] };
const sent = (id: string) => ({ kind: "run-announcement", announcementId: id, result: "SENT" });

describe("Ping roles bot delivery", () => {
  it("a custom request: one message in the Run channel, only the chosen role, reported SENT", async () => {
    const h = harness();
    const work = item({ helpCustom: custom });
    await syncRunAnnouncement(h.client, h.api, work, new Map(), pingRoleIds);

    expect(h.fetch).toHaveBeenCalledWith("run-channel-1");
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith({
      content: "**Need 1 LB for Coiled Altar** <@&960>",
      allowedMentions: { parse: [], roles: ["960"], users: [], repliedUser: false },
      nonce: work.announcementId.replace(/-/g, "").slice(0, 25),
      enforceNonce: true,
    });
    expect(h.recordDiscordState).toHaveBeenCalledTimes(1);
    expect(h.recordDiscordState).toHaveBeenCalledWith("run-1", sent(work.announcementId));
  });

  it("an automatic request still posts its usual message, unchanged", async () => {
    const h = harness();
    const work = item({ helpClasses: ["WARLOCK"] });
    await syncRunAnnouncement(h.client, h.api, work, new Map(), pingRoleIds);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "**3 more DPS needed here** <@&902>\n**Missing class buffs: Warlock** <@&950>",
        allowedMentions: { parse: [], roles: ["902", "950"], users: [], repliedUser: false },
      }),
    );
  });

  it("automatic with only missing class buffs: one message pinging only that class, reported SENT", async () => {
    const h = harness();
    const work = item({ helpRoles: [], helpClasses: ["WARLOCK"] });
    await syncRunAnnouncement(h.client, h.api, work, new Map(), pingRoleIds);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "**Missing class buffs: Warlock** <@&950>",
        allowedMentions: { parse: [], roles: ["950"], users: [], repliedUser: false },
      }),
    );
    expect(h.recordDiscordState).toHaveBeenCalledWith("run-1", sent(work.announcementId));
  });

  it("no chosen role resolves any more (missing or ambiguous): nothing is posted, reported SKIPPED", async () => {
    const h = harness();
    const work = item({ helpCustom: { text: "Need a Mage", roles: ["MAGE", "DRUID"] } });
    await syncRunAnnouncement(h.client, h.api, work, new Map(), pingRoleIds);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.recordDiscordState).toHaveBeenCalledWith("run-1", { kind: "run-announcement", announcementId: work.announcementId, result: "SKIPPED" });
  });

  it("the Run can no longer take players: not posted", async () => {
    const h = harness({ deliver: false });
    await syncRunAnnouncement(h.client, h.api, item({ helpCustom: custom }), new Map(), pingRoleIds);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("a transient Discord error stays PENDING and propagates for the next pass", async () => {
    const h = harness({ send: async () => Promise.reject(new Error("503")) });
    await expect(syncRunAnnouncement(h.client, h.api, item({ helpCustom: custom }), new Map(), pingRoleIds)).rejects.toThrow("503");
    expect(h.recordDiscordState).not.toHaveBeenCalled();
  });

  it("missing access to the channel is permanent: reported, not retried", async () => {
    const h = harness({ send: async () => Promise.reject(Object.assign(new Error("Missing Access"), { code: 50001 })) });
    const work = item({ helpCustom: custom });
    await syncRunAnnouncement(h.client, h.api, work, new Map(), pingRoleIds);
    expect(h.recordDiscordState).toHaveBeenCalledWith("run-1", {
      kind: "run-announcement",
      announcementId: work.announcementId,
      result: "FAILED_PERMANENT",
    });
  });

  it("posted but the SENT report failed: the next pass only reports, it never pings twice", async () => {
    const h = harness();
    h.recordDiscordState.mockRejectedValueOnce(new Error("API down"));
    const work = item({ helpCustom: custom });
    await expect(syncRunAnnouncement(h.client, h.api, work, new Map(), pingRoleIds)).rejects.toThrow("API down");
    await syncRunAnnouncement(h.client, h.api, work, new Map(), pingRoleIds);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.recordDiscordState).toHaveBeenLastCalledWith("run-1", sent(work.announcementId));
  });
});
