import { describe, expect, it, vi } from "vitest";
import {
  reconcileChannels,
  reconcileExistingRunChannel,
  type ChannelFetcher,
  type ChannelReconciliationEnv,
  type ChannelReconciliationItem,
  type ReconcilableChannel,
} from "@/discord-bot/channel-reconciliation";

const ACTIVE_CATEGORY = "active-cat-1";
const ARCHIVE_CATEGORY = "archive-cat-1";

function fakeChannel(overrides: { id?: string; name?: string; parentId?: string | null } = {}) {
  return {
    id: overrides.id ?? "chan-1",
    name: overrides.name ?? "current-name",
    parentId: overrides.parentId ?? ACTIVE_CATEGORY,
    setName: vi.fn().mockResolvedValue(undefined),
    setParent: vi.fn().mockResolvedValue(undefined),
  };
}

function fetcherFor(channel: ReconcilableChannel | null): ChannelFetcher {
  return vi.fn().mockResolvedValue(channel);
}

function item(overrides: Partial<ChannelReconciliationItem> = {}): ChannelReconciliationItem {
  return {
    runId: "run-1",
    existingRunChannelId: "chan-1",
    desiredChannelName: "current-name",
    archived: false,
    ...overrides,
  };
}

const envBothConfigured: ChannelReconciliationEnv = {
  discordRunCategoryId: ACTIVE_CATEGORY,
  discordRunArchiveCategoryId: ARCHIVE_CATEGORY,
};

describe("reconcileExistingRunChannel", () => {
  it("archive move: moves the same channel to the archive category", async () => {
    const channel = fakeChannel({ parentId: ACTIVE_CATEGORY });
    const result = await reconcileExistingRunChannel(fetcherFor(channel), envBothConfigured, item({ archived: true }));

    expect(channel.setParent).toHaveBeenCalledWith(ARCHIVE_CATEGORY, { lockPermissions: false });
    expect(channel.setParent).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "ok", channelId: "chan-1" });
  });

  it("restore move: moves the same channel back to the active category", async () => {
    const channel = fakeChannel({ parentId: ARCHIVE_CATEGORY });
    await reconcileExistingRunChannel(fetcherFor(channel), envBothConfigured, item({ archived: false }));

    expect(channel.setParent).toHaveBeenCalledWith(ACTIVE_CATEGORY, { lockPermissions: false });
    expect(channel.setParent).toHaveBeenCalledTimes(1);
  });

  it("parent already correct: setParent is not called", async () => {
    const channel = fakeChannel({ parentId: ACTIVE_CATEGORY });
    await reconcileExistingRunChannel(fetcherFor(channel), envBothConfigured, item({ archived: false }));

    expect(channel.setParent).not.toHaveBeenCalled();
  });

  it("name drift: renames the same channel, never replaces it", async () => {
    const channel = fakeChannel({ name: "wrong-name", parentId: ACTIVE_CATEGORY });
    const result = await reconcileExistingRunChannel(
      fetcherFor(channel),
      envBothConfigured,
      item({ desiredChannelName: "sat-2200-hc-syntax", archived: false }),
    );

    expect(channel.setName).toHaveBeenCalledWith("sat-2200-hc-syntax");
    expect(channel.setName).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "ok", channelId: "chan-1" });
  });

  it("name already correct: setName is not called", async () => {
    const channel = fakeChannel({ name: "sat-2200-hc-syntax", parentId: ACTIVE_CATEGORY });
    await reconcileExistingRunChannel(
      fetcherFor(channel),
      envBothConfigured,
      item({ desiredChannelName: "sat-2200-hc-syntax", archived: false }),
    );

    expect(channel.setName).not.toHaveBeenCalled();
  });

  it("already fully correct: neither setName nor setParent is called (full idempotency)", async () => {
    const channel = fakeChannel({ name: "sat-2200-hc-syntax", parentId: ACTIVE_CATEGORY });
    await reconcileExistingRunChannel(
      fetcherFor(channel),
      envBothConfigured,
      item({ desiredChannelName: "sat-2200-hc-syntax", archived: false }),
    );

    expect(channel.setName).not.toHaveBeenCalled();
    expect(channel.setParent).not.toHaveBeenCalled();
  });

  it("archive category unset: no setParent call, no throw, a warning is logged", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const channel = fakeChannel({ parentId: ACTIVE_CATEGORY });
    const env: ChannelReconciliationEnv = { discordRunCategoryId: ACTIVE_CATEGORY, discordRunArchiveCategoryId: null };

    const result = await reconcileExistingRunChannel(fetcherFor(channel), env, item({ archived: true }));

    expect(channel.setParent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("DISCORD_RUN_ARCHIVE_CATEGORY_ID is unset"));
    expect(result).toEqual({ status: "ok", channelId: "chan-1" });
    warnSpy.mockRestore();
  });

  it("active category unset on restore: no setParent call, no throw, a warning is logged", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const channel = fakeChannel({ parentId: ARCHIVE_CATEGORY });
    const env: ChannelReconciliationEnv = { discordRunCategoryId: null, discordRunArchiveCategoryId: ARCHIVE_CATEGORY };

    const result = await reconcileExistingRunChannel(fetcherFor(channel), env, item({ archived: false }));

    expect(channel.setParent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("DISCORD_RUN_CATEGORY_ID is unset"));
    expect(result).toEqual({ status: "ok", channelId: "chan-1" });
    warnSpy.mockRestore();
  });

  it("missing/inaccessible channel: no throw, a warning is logged, status is 'missing'", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await reconcileExistingRunChannel(fetcherFor(null), envBothConfigured, item());

    expect(result).toEqual({ status: "missing" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("could not be resolved"));
    warnSpy.mockRestore();
  });

  it("a rename failure does not prevent the independent category move from being attempted", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const channel = fakeChannel({ name: "wrong-name", parentId: ACTIVE_CATEGORY });
    channel.setName.mockRejectedValueOnce(new Error("rename failed"));

    const result = await reconcileExistingRunChannel(
      fetcherFor(channel),
      envBothConfigured,
      item({ desiredChannelName: "new-name", archived: true }),
    );

    expect(channel.setParent).toHaveBeenCalledWith(ARCHIVE_CATEGORY, { lockPermissions: false });
    expect(result).toEqual({ status: "ok", channelId: "chan-1" });
    errorSpy.mockRestore();
  });
});

describe("reconcileChannels — channel-only pass and failure isolation", () => {
  it("channel-only pass: reconciles a Run's channel with no message send/edit involved", async () => {
    const channel = fakeChannel({ name: "wrong-name", parentId: ACTIVE_CATEGORY });
    const resolved = await reconcileChannels(fetcherFor(channel), envBothConfigured, [
      item({ runId: "run-a", desiredChannelName: "right-name" }),
    ]);

    expect(channel.setName).toHaveBeenCalledWith("right-name");
    expect(resolved.get("run-a")).toBe("chan-1");
  });

  it("one bad channel does not stop the rest from reconciling", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const goodChannel = fakeChannel({ id: "chan-good", parentId: ACTIVE_CATEGORY });
    const fetcher: ChannelFetcher = vi.fn(async (channelId: string) => {
      if (channelId === "chan-bad") throw new Error("Discord API unavailable");
      if (channelId === "chan-missing") return null;
      return goodChannel;
    });

    const resolved = await reconcileChannels(fetcher, envBothConfigured, [
      item({ runId: "run-bad", existingRunChannelId: "chan-bad" }),
      item({ runId: "run-missing", existingRunChannelId: "chan-missing" }),
      item({ runId: "run-good", existingRunChannelId: "chan-good", archived: true }),
    ]);

    expect(resolved.has("run-bad")).toBe(false);
    expect(resolved.has("run-missing")).toBe(false);
    expect(resolved.get("run-good")).toBe("chan-good");
    expect(goodChannel.setParent).toHaveBeenCalledWith(ARCHIVE_CATEGORY, { lockPermissions: false });

    vi.restoreAllMocks();
  });
});
