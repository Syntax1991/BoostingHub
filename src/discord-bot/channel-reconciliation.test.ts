import { describe, expect, it, vi } from "vitest";
import {
  reconcileChannels,
  reconcileExistingRunChannel,
  reconcileWeekSectionPositions,
  type CategoryChannelLister,
  type CategoryChild,
  type ChannelFetcher,
  type ChannelReconciliationEnv,
  type ChannelReconciliationItem,
  type PositionSetter,
  type ReconcilableChannel,
  type WeekSectionEnv,
  type WeekSectionItem,
} from "@/discord-bot/channel-reconciliation";

const ACTIVE_CATEGORY = "active-cat-1";
const ARCHIVE_CATEGORY = "archive-cat-1";
const CURRENT_MARKER = "current-marker-1";
const NEXT_MARKER = "next-marker-1";

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
    targetBucket: "CURRENT",
    ...overrides,
  };
}

const envConfigured: ChannelReconciliationEnv = {
  discordRunCategoryId: ACTIVE_CATEGORY,
  discordRunArchiveCategoryId: ARCHIVE_CATEGORY,
};

describe("reconcileExistingRunChannel — category movement", () => {
  it("CURRENT and NEXT both resolve to the same active category — no-op when already there", async () => {
    const channel = fakeChannel({ parentId: ACTIVE_CATEGORY });
    await reconcileExistingRunChannel(fetcherFor(channel), envConfigured, item({ targetBucket: "CURRENT" }));
    expect(channel.setParent).not.toHaveBeenCalled();

    const channel2 = fakeChannel({ parentId: ACTIVE_CATEGORY });
    await reconcileExistingRunChannel(fetcherFor(channel2), envConfigured, item({ targetBucket: "NEXT" }));
    expect(channel2.setParent).not.toHaveBeenCalled();
  });

  it("archive move: moves the same channel to the archive category", async () => {
    const channel = fakeChannel({ parentId: ACTIVE_CATEGORY });
    const result = await reconcileExistingRunChannel(fetcherFor(channel), envConfigured, item({ targetBucket: "ARCHIVE" }));

    expect(channel.setParent).toHaveBeenCalledWith(ARCHIVE_CATEGORY, { lockPermissions: false });
    expect(channel.setParent).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "ok", channelId: "chan-1" });
  });

  it("restore move: moves the same channel back to the active category (from either CURRENT or NEXT target)", async () => {
    const channel = fakeChannel({ parentId: ARCHIVE_CATEGORY });
    await reconcileExistingRunChannel(fetcherFor(channel), envConfigured, item({ targetBucket: "NEXT" }));

    expect(channel.setParent).toHaveBeenCalledWith(ACTIVE_CATEGORY, { lockPermissions: false });
    expect(channel.setParent).toHaveBeenCalledTimes(1);
  });
});

describe("reconcileExistingRunChannel — name drift", () => {
  it("name drift: renames the same channel, never replaces it", async () => {
    const channel = fakeChannel({ name: "wrong-name", parentId: ACTIVE_CATEGORY });
    const result = await reconcileExistingRunChannel(
      fetcherFor(channel),
      envConfigured,
      item({ desiredChannelName: "sat-2200-hc-syntax" }),
    );

    expect(channel.setName).toHaveBeenCalledWith("sat-2200-hc-syntax");
    expect(channel.setName).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "ok", channelId: "chan-1" });
  });

  it("name already correct: setName is not called", async () => {
    const channel = fakeChannel({ name: "sat-2200-hc-syntax", parentId: ACTIVE_CATEGORY });
    await reconcileExistingRunChannel(fetcherFor(channel), envConfigured, item({ desiredChannelName: "sat-2200-hc-syntax" }));

    expect(channel.setName).not.toHaveBeenCalled();
  });

  it("already fully correct: neither setName nor setParent is called (full idempotency)", async () => {
    const channel = fakeChannel({ name: "sat-2200-hc-syntax", parentId: ACTIVE_CATEGORY });
    await reconcileExistingRunChannel(fetcherFor(channel), envConfigured, item({ desiredChannelName: "sat-2200-hc-syntax" }));

    expect(channel.setName).not.toHaveBeenCalled();
    expect(channel.setParent).not.toHaveBeenCalled();
  });
});

describe("reconcileExistingRunChannel — missing category configuration", () => {
  it("active category unset: no setParent call, no throw, a warning is logged", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const channel = fakeChannel({ parentId: ARCHIVE_CATEGORY });
    const env: ChannelReconciliationEnv = { discordRunCategoryId: null, discordRunArchiveCategoryId: ARCHIVE_CATEGORY };

    const result = await reconcileExistingRunChannel(fetcherFor(channel), env, item({ targetBucket: "CURRENT" }));

    expect(channel.setParent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("DISCORD_RUN_CATEGORY_ID is unset"));
    expect(result).toEqual({ status: "ok", channelId: "chan-1" });
    warnSpy.mockRestore();
  });

  it("archive category unset: no setParent call, no throw, a warning is logged", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const channel = fakeChannel({ parentId: ACTIVE_CATEGORY });
    const env: ChannelReconciliationEnv = { discordRunCategoryId: ACTIVE_CATEGORY, discordRunArchiveCategoryId: null };

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
    const result = await reconcileExistingRunChannel(fetcherFor(null), envConfigured, item());

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
      envConfigured,
      item({ desiredChannelName: "new-name", targetBucket: "ARCHIVE" }),
    );

    expect(channel.setParent).toHaveBeenCalledWith(ARCHIVE_CATEGORY, { lockPermissions: false });
    expect(result).toEqual({ status: "ok", channelId: "chan-1" });
    errorSpy.mockRestore();
  });
});

describe("reconcileChannels — channel-only pass and failure isolation", () => {
  it("channel-only pass: reconciles a Run's channel with no message send/edit involved", async () => {
    const channel = fakeChannel({ name: "wrong-name", parentId: ACTIVE_CATEGORY });
    const resolved = await reconcileChannels(fetcherFor(channel), envConfigured, [
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

    const resolved = await reconcileChannels(fetcher, envConfigured, [
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

// ---------------------------------------------------------------------------
// reconcileWeekSectionPositions
// ---------------------------------------------------------------------------

function child(id: string, position: number): CategoryChild {
  return { id, position };
}

function listerFor(children: CategoryChild[] | null): CategoryChannelLister {
  return vi.fn().mockResolvedValue(children);
}

function weekItem(overrides: Partial<WeekSectionItem> = {}): WeekSectionItem {
  return {
    runId: "run-1",
    existingRunChannelId: "chan-1",
    targetBucket: "CURRENT",
    scheduledStartAt: "2026-01-14T18:00:00.000Z",
    ...overrides,
  };
}

const weekEnv: WeekSectionEnv = {
  discordRunCategoryId: ACTIVE_CATEGORY,
  discordRunCurrentMarkerChannelId: CURRENT_MARKER,
  discordRunNextMarkerChannelId: NEXT_MARKER,
};

/**
 * Discord's real `setPositions` API only takes effect on a complete, dense
 * re-index of every channel in the category (confirmed empirically against
 * a live server — see channel-reconciliation.ts's doc comment). So the
 * payload always includes every child of the category, including the two
 * markers — these helpers extract the section order from that full payload
 * to make assertions readable without hand-computing dense indices.
 */
function orderedChannelIds(setPositions: PositionSetter): string[] {
  const calls = (setPositions as ReturnType<typeof vi.fn>).mock.calls;
  const [moves] = calls[calls.length - 1] as [Array<{ channelId: string; position: number }>];
  return [...moves].sort((a, b) => a.position - b.position).map((m) => m.channelId);
}

describe("reconcileWeekSectionPositions — CURRENT/NEXT ordering", () => {
  it("positions a single CURRENT channel right after #current-id, before #next-id", async () => {
    const children = [child(CURRENT_MARKER, 0), child(NEXT_MARKER, 10), child("chan-1", 20)];
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;

    const result = await reconcileWeekSectionPositions(listerFor(children), setPositions, weekEnv, [
      weekItem({ targetBucket: "CURRENT", existingRunChannelId: "chan-1" }),
    ]);

    expect(orderedChannelIds(setPositions)).toEqual([CURRENT_MARKER, "chan-1", NEXT_MARKER]);
    // Both chan-1 and #next-id change relative index (chan-1 moves in front
    // of the marker); #current-id's index is unchanged.
    expect(result).toEqual({ status: "ok", moved: 2 });
  });

  it("positions a single NEXT channel right after #next-id", async () => {
    const children = [child(CURRENT_MARKER, 0), child(NEXT_MARKER, 10), child("chan-1", 3)];
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;

    await reconcileWeekSectionPositions(listerFor(children), setPositions, weekEnv, [
      weekItem({ targetBucket: "NEXT", existingRunChannelId: "chan-1" }),
    ]);

    expect(orderedChannelIds(setPositions)).toEqual([CURRENT_MARKER, NEXT_MARKER, "chan-1"]);
  });

  it("orders multiple CURRENT channels chronologically by scheduledStartAt", async () => {
    const children = [
      child(CURRENT_MARKER, 0),
      child(NEXT_MARKER, 100),
      child("chan-late", 5),
      child("chan-early", 50),
    ];
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;

    await reconcileWeekSectionPositions(listerFor(children), setPositions, weekEnv, [
      weekItem({ runId: "run-late", existingRunChannelId: "chan-late", scheduledStartAt: "2026-01-16T18:00:00.000Z" }),
      weekItem({ runId: "run-early", existingRunChannelId: "chan-early", scheduledStartAt: "2026-01-14T18:00:00.000Z" }),
    ]);

    expect(orderedChannelIds(setPositions)).toEqual([CURRENT_MARKER, "chan-early", "chan-late", NEXT_MARKER]);
  });

  it("no-op when every channel is already correctly ordered", async () => {
    const children = [child(CURRENT_MARKER, 0), child("chan-1", 1), child(NEXT_MARKER, 10), child("chan-2", 11)];
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;

    const result = await reconcileWeekSectionPositions(listerFor(children), setPositions, weekEnv, [
      weekItem({ targetBucket: "CURRENT", existingRunChannelId: "chan-1" }),
      weekItem({ targetBucket: "NEXT", existingRunChannelId: "chan-2" }),
    ]);

    expect(setPositions).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "ok", moved: 0 });
  });

  it("ARCHIVE-targeted items are ignored by position reconciliation", async () => {
    const children = [child(CURRENT_MARKER, 0), child(NEXT_MARKER, 10), child("chan-1", 20)];
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;

    const result = await reconcileWeekSectionPositions(listerFor(children), setPositions, weekEnv, [
      weekItem({ targetBucket: "ARCHIVE", existingRunChannelId: "chan-1" }),
    ]);

    expect(setPositions).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "ok", moved: 0 });
  });
});

describe("reconcileWeekSectionPositions — drift correction", () => {
  it("manual CURRENT drift: a CURRENT channel dragged below #next-id moves back above it", async () => {
    const children = [child(CURRENT_MARKER, 0), child(NEXT_MARKER, 10), child("chan-1", 15)];
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;

    await reconcileWeekSectionPositions(listerFor(children), setPositions, weekEnv, [
      weekItem({ targetBucket: "CURRENT", existingRunChannelId: "chan-1" }),
    ]);

    expect(orderedChannelIds(setPositions)).toEqual([CURRENT_MARKER, "chan-1", NEXT_MARKER]);
  });

  it("manual NEXT drift: a NEXT channel dragged above #current-id moves back below #next-id", async () => {
    const children = [child(CURRENT_MARKER, 0), child(NEXT_MARKER, 10), child("chan-1", 1)];
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;

    await reconcileWeekSectionPositions(listerFor(children), setPositions, weekEnv, [
      weekItem({ targetBucket: "NEXT", existingRunChannelId: "chan-1" }),
    ]);

    expect(orderedChannelIds(setPositions)).toEqual([CURRENT_MARKER, NEXT_MARKER, "chan-1"]);
  });

  it("category drift: a channel outside the category (per reconcileExistingRunChannel) is a separate concern — position reconciliation only orders channels already listed as children", async () => {
    const children = [child(CURRENT_MARKER, 0), child(NEXT_MARKER, 10), child("chan-1", 15)];
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;

    const result = await reconcileWeekSectionPositions(listerFor(children), setPositions, weekEnv, [
      weekItem({ targetBucket: "CURRENT", existingRunChannelId: "chan-1" }),
    ]);

    // chan-1 and #next-id both change relative index.
    expect(result).toEqual({ status: "ok", moved: 2 });
  });
});

describe("reconcileWeekSectionPositions — marker and unmanaged channel safety", () => {
  it("markers may appear in the payload (Discord requires the full set), but their own relative order and identity never change", async () => {
    const children = [child(CURRENT_MARKER, 0), child(NEXT_MARKER, 1), child("chan-1", 2)];
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;

    await reconcileWeekSectionPositions(listerFor(children), setPositions, weekEnv, [
      weekItem({ targetBucket: "CURRENT", existingRunChannelId: "chan-1" }),
    ]);

    const order = orderedChannelIds(setPositions);
    expect(order.indexOf(CURRENT_MARKER)).toBeLessThan(order.indexOf(NEXT_MARKER));
    // The PositionSetter payload shape ({channelId, position}) has no field
    // for name or parent — this module is structurally incapable of
    // renaming, reparenting, deleting, or messaging a marker.
    const calls = (setPositions as ReturnType<typeof vi.fn>).mock.calls;
    for (const [moves] of calls) {
      for (const move of moves as object[]) {
        expect(Object.keys(move).sort()).toEqual(["channelId", "position"]);
      }
    }
  });

  it("an unmanaged channel between the markers keeps its relative position among other unmanaged channels", async () => {
    const children = [
      child(CURRENT_MARKER, 0),
      child("unmanaged-chan", 5),
      child(NEXT_MARKER, 10),
      child("chan-1", 25),
    ];
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;

    await reconcileWeekSectionPositions(listerFor(children), setPositions, weekEnv, [
      weekItem({ targetBucket: "CURRENT", existingRunChannelId: "chan-1" }),
    ]);

    const order = orderedChannelIds(setPositions);
    // chan-1 (CURRENT-managed) sorts before the unmanaged channel that was
    // already sitting between the markers; the unmanaged channel is present
    // (never dropped) and still sits between the two markers.
    expect(order).toEqual([CURRENT_MARKER, "chan-1", "unmanaged-chan", NEXT_MARKER]);
  });

  it("an unmanaged channel before #current-id is preserved in front, never reordered relative to other unmanaged channels", async () => {
    // chan-1 starts misplaced (between the markers) so an actual reorder is
    // required — the point of the test is that "unmanaged-chan" stays put
    // in front of #current-id throughout.
    const children = [child("unmanaged-chan", 0), child(CURRENT_MARKER, 5), child("chan-1", 7), child(NEXT_MARKER, 10)];
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;

    await reconcileWeekSectionPositions(listerFor(children), setPositions, weekEnv, [
      weekItem({ targetBucket: "NEXT", existingRunChannelId: "chan-1" }),
    ]);

    const order = orderedChannelIds(setPositions);
    expect(order).toEqual(["unmanaged-chan", CURRENT_MARKER, NEXT_MARKER, "chan-1"]);
  });
});

describe("reconcileWeekSectionPositions — missing/invalid configuration", () => {
  it("missing active category: skipped, no crash", async () => {
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;
    const result = await reconcileWeekSectionPositions(
      listerFor([]),
      setPositions,
      { ...weekEnv, discordRunCategoryId: null },
      [weekItem()],
    );
    expect(result.status).toBe("skipped");
    expect(setPositions).not.toHaveBeenCalled();
  });

  it("missing CURRENT marker: warns and skips safely", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;

    const result = await reconcileWeekSectionPositions(
      listerFor([child(NEXT_MARKER, 10)]),
      setPositions,
      { ...weekEnv, discordRunCurrentMarkerChannelId: null },
      [weekItem()],
    );

    expect(result.status).toBe("skipped");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("DISCORD_RUN_CURRENT_MARKER_CHANNEL_ID is unset"));
    expect(setPositions).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("missing NEXT marker: warns and skips safely", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;

    const result = await reconcileWeekSectionPositions(
      listerFor([child(CURRENT_MARKER, 0)]),
      setPositions,
      { ...weekEnv, discordRunNextMarkerChannelId: null },
      [weekItem()],
    );

    expect(result.status).toBe("skipped");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("DISCORD_RUN_NEXT_MARKER_CHANNEL_ID is unset"));
    expect(setPositions).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("category cannot be resolved: warns and skips, never crashes", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;

    const result = await reconcileWeekSectionPositions(listerFor(null), setPositions, weekEnv, [weekItem()]);

    expect(result.status).toBe("skipped");
    expect(warnSpy).toHaveBeenCalled();
    expect(setPositions).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("marker not found inside the configured category: warns and skips, does not invent a replacement", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;

    const result = await reconcileWeekSectionPositions(
      listerFor([child(NEXT_MARKER, 10), child("chan-1", 20)]), // CURRENT_MARKER absent
      setPositions,
      weekEnv,
      [weekItem()],
    );

    expect(result.status).toBe("skipped");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("#current-id"));
    expect(setPositions).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("marker order reversed (next-id above current-id): warns and skips rather than silently swapping them", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;

    const result = await reconcileWeekSectionPositions(
      listerFor([child(NEXT_MARKER, 0), child(CURRENT_MARKER, 10)]),
      setPositions,
      weekEnv,
      [weekItem()],
    );

    expect(result.status).toBe("skipped");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("must sit above"));
    expect(setPositions).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("a channel referenced by items that no longer exists in the category is silently skipped, not an error", async () => {
    const children = [child(CURRENT_MARKER, 0), child(NEXT_MARKER, 10)];
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;

    const result = await reconcileWeekSectionPositions(listerFor(children), setPositions, weekEnv, [
      weekItem({ existingRunChannelId: "chan-gone" }),
    ]);

    expect(result).toEqual({ status: "ok", moved: 0 });
  });

  it("setPositions failure is caught and reported without throwing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const children = [child(CURRENT_MARKER, 0), child(NEXT_MARKER, 10), child("chan-1", 20)];
    const setPositions = vi.fn().mockRejectedValue(new Error("Discord API unavailable")) as PositionSetter;

    const result = await reconcileWeekSectionPositions(listerFor(children), setPositions, weekEnv, [
      weekItem({ existingRunChannelId: "chan-1" }),
    ]);

    expect(result.status).toBe("skipped");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
