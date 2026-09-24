import { describe, expect, it, vi } from "vitest";
import {
  mergeWeekSectionItemsForOrdering,
  planWeekSectionOrder,
  reconcileChannels,
  reconcileExistingRunChannel,
  reconcileWeekSectionPositions,
  reconcileWeekSectionPositionsUntilSettled,
  relativeOrderMatches,
  WEEK_SECTION_POSITION_MAX_ATTEMPTS,
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

  it("app-archived ARCHIVE never moves — rename only; transcript path deletes later", async () => {
    const channel = fakeChannel({ parentId: ACTIVE_CATEGORY, name: "old-name" });
    const result = await reconcileExistingRunChannel(
      fetcherFor(channel),
      envConfigured,
      item({
        targetBucket: "ARCHIVE",
        desiredChannelName: "closed-sat-2200-hc-vip-7of9-titan",
        retireChannel: true,
      }),
    );

    expect(channel.setName).toHaveBeenCalledWith("closed-sat-2200-hc-vip-7of9-titan");
    expect(channel.setParent).not.toHaveBeenCalled();
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
  it("Unknown Channel (10003): no throw, a warning is logged, status is 'missing' (confirmed deletion)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher: ChannelFetcher = vi.fn().mockRejectedValue(Object.assign(new Error("Unknown Channel"), { code: 10003 }));
    const result = await reconcileExistingRunChannel(fetcher, envConfigured, item());

    expect(result).toEqual({ status: "missing" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown Channel"));
    warnSpy.mockRestore();
  });

  it("Missing Access or a transient failure is an 'error', never a deletion", async () => {
    for (const error of [Object.assign(new Error("Missing Access"), { code: 50001 }), new Error("socket hang up")]) {
      const fetcher: ChannelFetcher = vi.fn().mockRejectedValue(error);
      const result = await reconcileExistingRunChannel(fetcher, envConfigured, item());
      expect(result).toEqual({ status: "error", error });
    }
  });

  it("a channel that resolves to nothing reconcilable is 'unresolved', not a deletion", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await reconcileExistingRunChannel(fetcherFor(null), envConfigured, item());

    expect(result).toEqual({ status: "unresolved" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("keeping stored id"));
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

  it("reports only confirmed deletions to onConfirmedMissing, once per item", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const goodChannel = fakeChannel({ id: "chan-good", parentId: ACTIVE_CATEGORY });
    const fetcher: ChannelFetcher = vi.fn(async (channelId: string) => {
      if (channelId === "chan-deleted") throw Object.assign(new Error("Unknown Channel"), { code: 10003 });
      if (channelId === "chan-forbidden") throw Object.assign(new Error("Missing Access"), { code: 50001 });
      if (channelId === "chan-unresolved") return null;
      return goodChannel;
    });
    const onConfirmedMissing = vi.fn().mockResolvedValue(undefined);

    const resolved = await reconcileChannels(
      fetcher,
      envConfigured,
      [
        item({ runId: "run-deleted", existingRunChannelId: "chan-deleted" }),
        item({ runId: "run-forbidden", existingRunChannelId: "chan-forbidden" }),
        item({ runId: "run-unresolved", existingRunChannelId: "chan-unresolved" }),
        item({ runId: "run-good", existingRunChannelId: "chan-good" }),
      ],
      onConfirmedMissing,
    );

    expect(onConfirmedMissing).toHaveBeenCalledTimes(1);
    expect(onConfirmedMissing).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-deleted", existingRunChannelId: "chan-deleted" }),
    );
    expect(resolved.has("run-deleted")).toBe(false);
    expect(resolved.get("run-good")).toBe("chan-good");

    vi.restoreAllMocks();
  });

  it("a failing onConfirmedMissing does not stop the rest from reconciling", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const goodChannel = fakeChannel({ id: "chan-good", name: "wrong-name", parentId: ACTIVE_CATEGORY });
    const fetcher: ChannelFetcher = vi.fn(async (channelId: string) => {
      if (channelId === "chan-deleted") throw Object.assign(new Error("Unknown Channel"), { code: 10003 });
      return goodChannel;
    });

    const resolved = await reconcileChannels(
      fetcher,
      envConfigured,
      [
        item({ runId: "run-deleted", existingRunChannelId: "chan-deleted" }),
        item({ runId: "run-good", existingRunChannelId: "chan-good", desiredChannelName: "right-name" }),
      ],
      vi.fn().mockRejectedValue(new Error("API down")),
    );

    expect(goodChannel.setName).toHaveBeenCalledWith("right-name");
    expect(resolved.get("run-good")).toBe("chan-good");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("channel reconciliation crashed for run run-deleted"),
      expect.any(Error),
    );

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

describe("mergeWeekSectionItemsForOrdering — same-pass first-channel create", () => {
  it("live bug regression: brand-new CURRENT channel is ordered between markers without a second poll", async () => {
    // Initial category: only markers. Sync provisions mon-0200 CURRENT below
    // #next-id (Discord default). End-of-pass merge must place it correctly.
    const children = [
      child(CURRENT_MARKER, 0),
      child(NEXT_MARKER, 10),
      child("chan-mon-0200", 20), // default placement after create
    ];
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;
    const items = mergeWeekSectionItemsForOrdering(
      [],
      [
        weekItem({
          runId: "run-mon-0200",
          existingRunChannelId: "chan-mon-0200",
          targetBucket: "CURRENT",
          // Monday 14 Sep 2026 02:00 Europe/Berlin = 2026-09-14T00:00:00.000Z
          scheduledStartAt: "2026-09-14T00:00:00.000Z",
        }),
      ],
    );

    await reconcileWeekSectionPositions(listerFor(children), setPositions, weekEnv, items);

    expect(orderedChannelIds(setPositions)).toEqual([CURRENT_MARKER, "chan-mon-0200", NEXT_MARKER]);
  });

  it("brand-new NEXT channel ends below #next-id in the same pass", async () => {
    const children = [child(CURRENT_MARKER, 0), child(NEXT_MARKER, 10), child("chan-next", 5)];
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;
    const items = mergeWeekSectionItemsForOrdering(
      [],
      [weekItem({ runId: "run-next", existingRunChannelId: "chan-next", targetBucket: "NEXT" })],
    );

    await reconcileWeekSectionPositions(listerFor(children), setPositions, weekEnv, items);
    expect(orderedChannelIds(setPositions)).toEqual([CURRENT_MARKER, NEXT_MARKER, "chan-next"]);
  });

  it("existing CURRENT + newly provisioned CURRENT insert chronologically before #next-id", async () => {
    const children = [
      child(CURRENT_MARKER, 0),
      child("chan-mon", 1),
      child(NEXT_MARKER, 10),
      child("chan-thu", 11),
      child("chan-tue", 20), // new Tuesday CURRENT, defaulted below next
    ];
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;
    const items = mergeWeekSectionItemsForOrdering(
      [
        weekItem({
          runId: "run-mon",
          existingRunChannelId: "chan-mon",
          targetBucket: "CURRENT",
          scheduledStartAt: "2026-09-14T00:00:00.000Z",
        }),
        weekItem({
          runId: "run-thu",
          existingRunChannelId: "chan-thu",
          targetBucket: "NEXT",
          scheduledStartAt: "2026-09-17T18:00:00.000Z",
        }),
      ],
      [
        weekItem({
          runId: "run-tue",
          existingRunChannelId: "chan-tue",
          targetBucket: "CURRENT",
          scheduledStartAt: "2026-09-15T18:00:00.000Z",
        }),
      ],
    );

    await reconcileWeekSectionPositions(listerFor(children), setPositions, weekEnv, items);
    expect(orderedChannelIds(setPositions)).toEqual([
      CURRENT_MARKER,
      "chan-mon",
      "chan-tue",
      NEXT_MARKER,
      "chan-thu",
    ]);
  });

  it("multiple new channels sort by schedule, not creation/merge order", async () => {
    const children = [
      child(CURRENT_MARKER, 0),
      child(NEXT_MARKER, 10),
      child("chan-tue", 20),
      child("chan-mon", 21),
      child("chan-wed", 22),
      child("chan-thu", 23),
    ];
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;
    // Intentionally non-chronological merge/create order.
    const items = mergeWeekSectionItemsForOrdering(
      [],
      [
        weekItem({
          runId: "run-wed",
          existingRunChannelId: "chan-wed",
          targetBucket: "NEXT",
          scheduledStartAt: "2026-09-16T18:00:00.000Z",
        }),
        weekItem({
          runId: "run-tue",
          existingRunChannelId: "chan-tue",
          targetBucket: "CURRENT",
          scheduledStartAt: "2026-09-15T18:00:00.000Z",
        }),
        weekItem({
          runId: "run-thu",
          existingRunChannelId: "chan-thu",
          targetBucket: "NEXT",
          scheduledStartAt: "2026-09-17T17:00:00.000Z",
        }),
        weekItem({
          runId: "run-mon",
          existingRunChannelId: "chan-mon",
          targetBucket: "CURRENT",
          scheduledStartAt: "2026-09-14T00:00:00.000Z",
        }),
      ],
    );

    await reconcileWeekSectionPositions(listerFor(children), setPositions, weekEnv, items);
    expect(orderedChannelIds(setPositions)).toEqual([
      CURRENT_MARKER,
      "chan-mon",
      "chan-tue",
      NEXT_MARKER,
      "chan-wed",
      "chan-thu",
    ]);
  });

  it("later provisioned item for the same runId replaces a stale existing channel id", () => {
    const merged = mergeWeekSectionItemsForOrdering(
      [weekItem({ runId: "run-1", existingRunChannelId: "chan-dead" })],
      [weekItem({ runId: "run-1", existingRunChannelId: "chan-fresh" })],
    );
    expect(merged).toEqual([weekItem({ runId: "run-1", existingRunChannelId: "chan-fresh" })]);
  });
});

describe("reconcileWeekSectionPositionsUntilSettled — fresh verify + bounded retry", () => {
  it("relativeOrderMatches distinguishes intended vs live sequences", () => {
    expect(relativeOrderMatches(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
    expect(relativeOrderMatches(["a", "c", "b"], ["a", "b", "c"])).toBe(false);
  });

  it("verifies correct order on first attempt without retry when fresh matches", async () => {
    let live = [child(CURRENT_MARKER, 0), child(NEXT_MARKER, 1), child("chan-1", 2)];
    const setPositions = vi.fn(async (moves: Array<{ channelId: string; position: number }>) => {
      live = [...moves]
        .sort((a, b) => a.position - b.position)
        .map((move) => child(move.channelId, move.position));
    }) as unknown as PositionSetter;
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await reconcileWeekSectionPositionsUntilSettled(
      listerFor(live),
      async () => live,
      setPositions,
      weekEnv,
      [weekItem({ targetBucket: "CURRENT", existingRunChannelId: "chan-1" })],
      { sleep, retryDelayMs: 10 },
    );

    expect(result).toEqual({ status: "ok", moved: 2, attempts: 1, verified: true });
    expect(setPositions).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(live.map((c) => c.id)).toEqual([CURRENT_MARKER, "chan-1", NEXT_MARKER]);
  });

  it("retries when cache write looks done but fresh Discord order stays wrong", async () => {
    // Cache/plan view starts wrong; setPositions "succeeds" but fresh stays wrong until 2nd write.
    let cacheView = [child(CURRENT_MARKER, 0), child(NEXT_MARKER, 1), child("chan-1", 2)];
    let freshView = [child(CURRENT_MARKER, 0), child(NEXT_MARKER, 1), child("chan-1", 2)];
    let writes = 0;
    const setPositions = vi.fn(async (moves: Array<{ channelId: string; position: number }>) => {
      writes += 1;
      const next = [...moves]
        .sort((a, b) => a.position - b.position)
        .map((move) => child(move.channelId, move.position));
      cacheView = next;
      // Discord create→position lag: first write ignored by server view.
      if (writes >= 2) {
        freshView = next;
      }
    }) as unknown as PositionSetter;
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await reconcileWeekSectionPositionsUntilSettled(
      async () => cacheView,
      async () => freshView,
      setPositions,
      weekEnv,
      [weekItem({ targetBucket: "CURRENT", existingRunChannelId: "chan-1" })],
      { sleep, retryDelayMs: 5 },
    );

    expect(result).toEqual({ status: "ok", moved: expect.any(Number), attempts: 2, verified: true });
    expect(result.status === "ok" && result.moved).toBeGreaterThan(0);
    expect(setPositions).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(5);
    expect(freshView.map((c) => c.id)).toEqual([CURRENT_MARKER, "chan-1", NEXT_MARKER]);
  });

  it("stops at configured maximum and surfaces unverified when Discord never converges", async () => {
    const stuck = [child(CURRENT_MARKER, 0), child(NEXT_MARKER, 1), child("chan-1", 2)];
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;
    const sleep = vi.fn().mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await reconcileWeekSectionPositionsUntilSettled(
      listerFor(stuck),
      listerFor(stuck),
      setPositions,
      weekEnv,
      [weekItem({ targetBucket: "CURRENT", existingRunChannelId: "chan-1" })],
      { sleep, retryDelayMs: 1, maxAttempts: WEEK_SECTION_POSITION_MAX_ATTEMPTS },
    );

    expect(result).toEqual({
      status: "ok",
      moved: expect.any(Number),
      attempts: WEEK_SECTION_POSITION_MAX_ATTEMPTS,
      verified: false,
    });
    expect(setPositions).toHaveBeenCalledTimes(WEEK_SECTION_POSITION_MAX_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(WEEK_SECTION_POSITION_MAX_ATTEMPTS - 1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("does not write when already correct and fresh agrees", async () => {
    const live = [child(CURRENT_MARKER, 0), child("chan-1", 1), child(NEXT_MARKER, 2)];
    const setPositions = vi.fn().mockResolvedValue(undefined) as PositionSetter;
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await reconcileWeekSectionPositionsUntilSettled(
      listerFor(live),
      listerFor(live),
      setPositions,
      weekEnv,
      [weekItem({ targetBucket: "CURRENT", existingRunChannelId: "chan-1" })],
      { sleep },
    );

    expect(result).toEqual({ status: "ok", moved: 0, attempts: 1, verified: true });
    expect(setPositions).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("planWeekSectionOrder — BoostingHub and manual Run channels sorted together by time", () => {
  const named = (id: string, position: number, name: string): CategoryChild => ({ id, position, name });
  // Production snapshot 2026-09-24: BoostingHub's Fri 22:15 channel sat above the manual Fri 13:00 one.
  const productionChildren = [
    named(CURRENT_MARKER, 0, "💰-current-id"),
    named("bh-fri-2215", 1, "fri-2215-hc-vip-7of9-uwe"),
    named("m-fri-1300", 2, "fri-1300-nm-vip-9of9-locheia"),
    named("m-fri-1530", 3, "fri-1530-nm-vip-9of9-locheia"),
    named("m-fri-2000", 4, "fri-2000-nm-vip-9of9-alantra"),
    named("m-sat-1300", 5, "sat-1300-nm-vip-9of9-locheia"),
    named("m-sun-2330", 6, "sun-2330-nm-vip-9of9-uwe"),
    named("m-mon-1930", 7, "mon-1930-hc-vip-7of9-alantra"),
    named("m-tue-2330", 8, "tue-2330-hc-vip-7of9-uwe"),
    named(NEXT_MARKER, 9, "💫-next-id"),
  ];
  // Fri 2026-09-25 22:15 Europe/Berlin (CEST) = 20:15Z.
  const bhFri2215 = weekItem({ runId: "run-bh", existingRunChannelId: "bh-fri-2215", scheduledStartAt: "2026-09-25T20:15:00.000Z" });

  function finalIds(children: CategoryChild[], items: WeekSectionItem[]): string[] {
    const plan = planWeekSectionOrder(children, weekEnv, items);
    if (plan.status !== "ok") throw new Error(plan.reason);
    return plan.finalOrderIds;
  }

  it("PRODUCTION: interleaves the BoostingHub channel into the manual channels by time", () => {
    expect(finalIds(productionChildren, [bhFri2215])).toEqual([
      CURRENT_MARKER,
      "m-fri-1300",
      "m-fri-1530",
      "m-fri-2000",
      "bh-fri-2215",
      "m-sat-1300",
      "m-sun-2330",
      "m-mon-1930",
      "m-tue-2330",
      NEXT_MARKER,
    ]);
  });

  it("is idempotent: an already time-sorted category needs no write", async () => {
    const sorted = finalIds(productionChildren, [bhFri2215]).map((id, position) => ({
      ...productionChildren.find((c) => c.id === id)!,
      position,
    }));
    const plan = planWeekSectionOrder(sorted, weekEnv, [bhFri2215]);
    expect(plan.status === "ok" && plan.alreadyInOrder).toBe(true);
    const setPositions = vi.fn().mockResolvedValue(undefined);
    await reconcileWeekSectionPositions(listerFor(sorted), setPositions, weekEnv, [bhFri2215]);
    expect(setPositions).not.toHaveBeenCalled();
  });

  it("keeps channels without a recognisable time at the end of their section, in their relative order", () => {
    const children = [
      named(CURRENT_MARKER, 0, "current"),
      named("notes", 1, "raid-notes"),
      named("m-sat", 2, "sat-1300-nm-vip-9of9-a"),
      named("rules", 3, "rules"),
      named("m-thu", 4, "thu-2000-nm-vip-9of9-b"),
      named(NEXT_MARKER, 5, "next"),
    ];
    expect(finalIds(children, [])).toEqual([CURRENT_MARKER, "m-thu", "m-sat", "notes", "rules", NEXT_MARKER]);
  });

  it("sorts the NEXT section the same way and never moves channels between sections or above the CURRENT marker", () => {
    const children = [
      named("above", 0, "fri-0900-above-marker"),
      named(CURRENT_MARKER, 1, "current"),
      named("m-cur-sun", 2, "sun-2000-cur"),
      named(NEXT_MARKER, 3, "next"),
      named("m-next-tue", 4, "tue-1000-next"),
      named("m-next-thu", 5, "thu-1800-next"),
      named("bh-next", 6, "wed-2000-bh"),
    ];
    // Wed 2026-10-07 20:00 Berlin = 18:00Z, NEXT week.
    const bhNext = weekItem({ runId: "run-next", existingRunChannelId: "bh-next", targetBucket: "NEXT", scheduledStartAt: "2026-10-07T18:00:00.000Z" });
    expect(finalIds(children, [bhNext])).toEqual(["above", CURRENT_MARKER, "m-cur-sun", NEXT_MARKER, "bh-next", "m-next-thu", "m-next-tue"]);
  });

  it("raid week starts Wednesday 06:00: Wed 05:00 sorts after Tue 23:30, Wed 06:00 first", () => {
    const children = [
      named(CURRENT_MARKER, 0, "current"),
      named("wed-0500", 1, "wed-0500-late"),
      named("tue-2330", 2, "tue-2330-x"),
      named("wed-0600", 3, "wed-0600-first"),
      named(NEXT_MARKER, 4, "next"),
    ];
    expect(finalIds(children, [])).toEqual([CURRENT_MARKER, "wed-0600", "tue-2330", "wed-0500", NEXT_MARKER]);
  });

  it("ties (same time): BoostingHub channel first, then previous order", () => {
    const children = [
      named(CURRENT_MARKER, 0, "current"),
      named("m-dup", 1, "fri-2215-hc-vip-7of9-uwe"),
      named("bh-fri-2215", 2, "fri-2215-hc-vip-7of9-uwe"),
      named(NEXT_MARKER, 3, "next"),
    ];
    expect(finalIds(children, [bhFri2215])).toEqual([CURRENT_MARKER, "bh-fri-2215", "m-dup", NEXT_MARKER]);
  });
});
