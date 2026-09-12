import { describe, expect, it, vi } from "vitest";
import {
  reconcileChannels,
  reconcileExistingRunChannel,
  type ChannelFetcher,
  type ChannelReconciliationEnv,
  type ChannelReconciliationItem,
  type ReconcilableChannel,
} from "@/discord-bot/channel-reconciliation";

const CURRENT_CATEGORY = "current-cat-1";
const NEXT_CATEGORY = "next-cat-1";
const ARCHIVE_CATEGORY = "archive-cat-1";

function fakeChannel(overrides: { id?: string; name?: string; parentId?: string | null } = {}) {
  return {
    id: overrides.id ?? "chan-1",
    name: overrides.name ?? "current-name",
    parentId: overrides.parentId ?? CURRENT_CATEGORY,
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
    targetBucket: "CURRENT",
    ...overrides,
  };
}

const envAllConfigured: ChannelReconciliationEnv = {
  discordRunCurrentCategoryId: CURRENT_CATEGORY,
  discordRunNextCategoryId: NEXT_CATEGORY,
  discordRunArchiveCategoryId: ARCHIVE_CATEGORY,
};

describe("reconcileExistingRunChannel — category movement", () => {
  it("CURRENT no-op: channel already in CURRENT, setParent is not called", async () => {
    const channel = fakeChannel({ parentId: CURRENT_CATEGORY });
    await reconcileExistingRunChannel(fetcherFor(channel), envAllConfigured, item({ targetBucket: "CURRENT" }));

    expect(channel.setParent).not.toHaveBeenCalled();
  });

  it("NEXT no-op: channel already in NEXT, setParent is not called", async () => {
    const channel = fakeChannel({ parentId: NEXT_CATEGORY });
    await reconcileExistingRunChannel(fetcherFor(channel), envAllConfigured, item({ targetBucket: "NEXT" }));

    expect(channel.setParent).not.toHaveBeenCalled();
  });

  it("reconcile NEXT -> CURRENT: same channel id, setParent(CURRENT, { lockPermissions: false })", async () => {
    const channel = fakeChannel({ parentId: NEXT_CATEGORY });
    const result = await reconcileExistingRunChannel(fetcherFor(channel), envAllConfigured, item({ targetBucket: "CURRENT" }));

    expect(channel.setParent).toHaveBeenCalledWith(CURRENT_CATEGORY, { lockPermissions: false });
    expect(channel.setParent).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "ok", channelId: "chan-1" });
  });

  it("reconcile CURRENT -> NEXT: same channel id, setParent(NEXT, { lockPermissions: false })", async () => {
    const channel = fakeChannel({ parentId: CURRENT_CATEGORY });
    await reconcileExistingRunChannel(fetcherFor(channel), envAllConfigured, item({ targetBucket: "NEXT" }));

    expect(channel.setParent).toHaveBeenCalledWith(NEXT_CATEGORY, { lockPermissions: false });
    expect(channel.setParent).toHaveBeenCalledTimes(1);
  });

  it("archive move: current/next channel whose target is ARCHIVE moves there, same channel id", async () => {
    const channel = fakeChannel({ parentId: CURRENT_CATEGORY });
    const result = await reconcileExistingRunChannel(fetcherFor(channel), envAllConfigured, item({ targetBucket: "ARCHIVE" }));

    expect(channel.setParent).toHaveBeenCalledWith(ARCHIVE_CATEGORY, { lockPermissions: false });
    expect(result).toEqual({ status: "ok", channelId: "chan-1" });
  });

  it("restore CURRENT: previously archived channel moves back to CURRENT, same channel id", async () => {
    const channel = fakeChannel({ parentId: ARCHIVE_CATEGORY });
    await reconcileExistingRunChannel(fetcherFor(channel), envAllConfigured, item({ targetBucket: "CURRENT" }));

    expect(channel.setParent).toHaveBeenCalledWith(CURRENT_CATEGORY, { lockPermissions: false });
  });

  it("restore NEXT: previously archived channel moves back to NEXT, same channel id", async () => {
    const channel = fakeChannel({ parentId: ARCHIVE_CATEGORY });
    await reconcileExistingRunChannel(fetcherFor(channel), envAllConfigured, item({ targetBucket: "NEXT" }));

    expect(channel.setParent).toHaveBeenCalledWith(NEXT_CATEGORY, { lockPermissions: false });
  });

  it("parent already correct: setParent is not called", async () => {
    const channel = fakeChannel({ parentId: CURRENT_CATEGORY });
    await reconcileExistingRunChannel(fetcherFor(channel), envAllConfigured, item({ targetBucket: "CURRENT" }));

    expect(channel.setParent).not.toHaveBeenCalled();
  });
});

describe("reconcileExistingRunChannel — name drift", () => {
  it("name drift: renames the same channel, never replaces it", async () => {
    const channel = fakeChannel({ name: "wrong-name", parentId: CURRENT_CATEGORY });
    const result = await reconcileExistingRunChannel(
      fetcherFor(channel),
      envAllConfigured,
      item({ desiredChannelName: "sat-2200-hc-syntax", targetBucket: "CURRENT" }),
    );

    expect(channel.setName).toHaveBeenCalledWith("sat-2200-hc-syntax");
    expect(channel.setName).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "ok", channelId: "chan-1" });
  });

  it("name already correct: setName is not called", async () => {
    const channel = fakeChannel({ name: "sat-2200-hc-syntax", parentId: CURRENT_CATEGORY });
    await reconcileExistingRunChannel(
      fetcherFor(channel),
      envAllConfigured,
      item({ desiredChannelName: "sat-2200-hc-syntax", targetBucket: "CURRENT" }),
    );

    expect(channel.setName).not.toHaveBeenCalled();
  });

  it("already fully correct: neither setName nor setParent is called (full idempotency)", async () => {
    const channel = fakeChannel({ name: "sat-2200-hc-syntax", parentId: CURRENT_CATEGORY });
    await reconcileExistingRunChannel(
      fetcherFor(channel),
      envAllConfigured,
      item({ desiredChannelName: "sat-2200-hc-syntax", targetBucket: "CURRENT" }),
    );

    expect(channel.setName).not.toHaveBeenCalled();
    expect(channel.setParent).not.toHaveBeenCalled();
  });

  it("name drift + week move: one pass corrects both, same channel id", async () => {
    const channel = fakeChannel({ name: "wrong-name", parentId: NEXT_CATEGORY });
    const result = await reconcileExistingRunChannel(
      fetcherFor(channel),
      envAllConfigured,
      item({ desiredChannelName: "right-name", targetBucket: "CURRENT" }),
    );

    expect(channel.setName).toHaveBeenCalledWith("right-name");
    expect(channel.setParent).toHaveBeenCalledWith(CURRENT_CATEGORY, { lockPermissions: false });
    expect(result).toEqual({ status: "ok", channelId: "chan-1" });
  });
});

describe("reconcileExistingRunChannel — missing category configuration", () => {
  it("missing CURRENT category: no setParent call, no throw, a warning is logged, channel unchanged", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const channel = fakeChannel({ parentId: ARCHIVE_CATEGORY });
    const env: ChannelReconciliationEnv = {
      discordRunCurrentCategoryId: null,
      discordRunNextCategoryId: NEXT_CATEGORY,
      discordRunArchiveCategoryId: ARCHIVE_CATEGORY,
    };

    const result = await reconcileExistingRunChannel(fetcherFor(channel), env, item({ targetBucket: "CURRENT" }));

    expect(channel.setParent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("DISCORD_RUN_CURRENT_CATEGORY_ID is unset"));
    expect(result).toEqual({ status: "ok", channelId: "chan-1" });
    warnSpy.mockRestore();
  });

  it("missing NEXT category: no setParent call, no throw, a warning is logged, and CURRENT is never used as a fallback", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const channel = fakeChannel({ parentId: CURRENT_CATEGORY });
    const env: ChannelReconciliationEnv = {
      discordRunCurrentCategoryId: CURRENT_CATEGORY,
      discordRunNextCategoryId: null,
      discordRunArchiveCategoryId: ARCHIVE_CATEGORY,
    };

    const result = await reconcileExistingRunChannel(fetcherFor(channel), env, item({ targetBucket: "NEXT" }));

    expect(channel.setParent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("DISCORD_RUN_NEXT_CATEGORY_ID is unset"));
    expect(result).toEqual({ status: "ok", channelId: "chan-1" });
    warnSpy.mockRestore();
  });

  it("missing ARCHIVE category: no setParent call, no throw, a warning is logged", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const channel = fakeChannel({ parentId: CURRENT_CATEGORY });
    const env: ChannelReconciliationEnv = {
      discordRunCurrentCategoryId: CURRENT_CATEGORY,
      discordRunNextCategoryId: NEXT_CATEGORY,
      discordRunArchiveCategoryId: null,
    };

    const result = await reconcileExistingRunChannel(fetcherFor(channel), env, item({ targetBucket: "ARCHIVE" }));

    expect(channel.setParent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("DISCORD_RUN_ARCHIVE_CATEGORY_ID is unset"));
    expect(result).toEqual({ status: "ok", channelId: "chan-1" });
    warnSpy.mockRestore();
  });
});

describe("reconcileExistingRunChannel — channel resolution failures", () => {
  it("missing/inaccessible channel: no throw, a warning is logged, status is 'missing'", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await reconcileExistingRunChannel(fetcherFor(null), envAllConfigured, item());

    expect(result).toEqual({ status: "missing" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("could not be resolved"));
    warnSpy.mockRestore();
  });

  it("a rename failure does not prevent the independent category move from being attempted", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const channel = fakeChannel({ name: "wrong-name", parentId: CURRENT_CATEGORY });
    channel.setName.mockRejectedValueOnce(new Error("rename failed"));

    const result = await reconcileExistingRunChannel(
      fetcherFor(channel),
      envAllConfigured,
      item({ desiredChannelName: "new-name", targetBucket: "ARCHIVE" }),
    );

    expect(channel.setParent).toHaveBeenCalledWith(ARCHIVE_CATEGORY, { lockPermissions: false });
    expect(result).toEqual({ status: "ok", channelId: "chan-1" });
    errorSpy.mockRestore();
  });
});

describe("reconcileChannels — channel-only pass and failure isolation", () => {
  it("channel-only pass: reconciles a Run's channel with no message send/edit involved", async () => {
    const channel = fakeChannel({ name: "wrong-name", parentId: CURRENT_CATEGORY });
    const resolved = await reconcileChannels(fetcherFor(channel), envAllConfigured, [
      item({ runId: "run-a", desiredChannelName: "right-name" }),
    ]);

    expect(channel.setName).toHaveBeenCalledWith("right-name");
    expect(resolved.get("run-a")).toBe("chan-1");
  });

  it("one bad channel does not stop the rest from reconciling", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const goodChannel = fakeChannel({ id: "chan-good", parentId: CURRENT_CATEGORY });
    const fetcher: ChannelFetcher = vi.fn(async (channelId: string) => {
      if (channelId === "chan-bad") throw new Error("Discord API unavailable");
      if (channelId === "chan-missing") return null;
      return goodChannel;
    });

    const resolved = await reconcileChannels(fetcher, envAllConfigured, [
      item({ runId: "run-bad", existingRunChannelId: "chan-bad" }),
      item({ runId: "run-missing", existingRunChannelId: "chan-missing" }),
      item({ runId: "run-good", existingRunChannelId: "chan-good", targetBucket: "ARCHIVE" }),
    ]);

    expect(resolved.has("run-bad")).toBe(false);
    expect(resolved.has("run-missing")).toBe(false);
    expect(resolved.get("run-good")).toBe("chan-good");
    expect(goodChannel.setParent).toHaveBeenCalledWith(ARCHIVE_CATEGORY, { lockPermissions: false });

    vi.restoreAllMocks();
  });
});
