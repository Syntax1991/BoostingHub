import { describe, expect, it, vi } from "vitest";
import {
  reconcileRunVoiceChannels,
  type CreatedVoiceChannel,
  type RunVoiceChannelAdapters,
  type RunVoiceChannelWorkItem,
  type VoiceChannelView,
} from "@/discord-bot/voice-channels";

const unknownChannel = () => Object.assign(new Error("Unknown Channel"), { code: 10003 });
const missingAccess = () => Object.assign(new Error("Missing Access"), { code: 50001 });
const missingPermissions = () => Object.assign(new Error("Missing Permissions"), { code: 50013 });

function voice(memberCount: number, name = "Raid with Syntax") {
  return {
    kind: "voice" as const,
    name,
    memberCount,
    setName: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function adapters(options: {
  channel?: VoiceChannelView | (() => never);
  create?: (() => Promise<CreatedVoiceChannel>) | null;
  createdId?: string;
  recordFails?: unknown;
  compensationFails?: unknown;
} = {}) {
  const createdDelete = vi.fn(async () => {
    if (options.compensationFails) throw options.compensationFails;
  });
  const recordVoiceChannel = vi.fn(async () => {
    if (options.recordFails) throw options.recordFails;
  });
  const clearVoiceChannel = vi.fn().mockResolvedValue(undefined);
  const createVoiceChannel =
    options.create === null
      ? null
      : vi.fn(options.create ?? (async (): Promise<CreatedVoiceChannel> => ({ id: options.createdId ?? "222", delete: createdDelete })));
  const fetchChannel = vi.fn(async () => {
    if (typeof options.channel === "function") return options.channel();
    return options.channel ?? voice(0);
  });
  const value: RunVoiceChannelAdapters = { fetchChannel, createVoiceChannel, recordVoiceChannel, clearVoiceChannel };
  return { value, fetchChannel, createVoiceChannel, recordVoiceChannel, clearVoiceChannel, createdDelete };
}

function item(action: RunVoiceChannelWorkItem["action"], existingVoiceChannelId: string | null = "voice-1"): RunVoiceChannelWorkItem {
  return { runId: "run-1", existingVoiceChannelId, desiredVoiceChannelName: "Raid with Syntax", action };
}

describe("reconcileRunVoiceChannels — creation", () => {
  it("PROVISION creates exactly one voice channel named for the Raid Lead and records it", async () => {
    const a = adapters();
    const resolved = await reconcileRunVoiceChannels(a.value, [item("PROVISION", null)]);
    expect(a.createVoiceChannel).toHaveBeenCalledTimes(1);
    expect(a.createVoiceChannel).toHaveBeenCalledWith("Raid with Syntax");
    expect(a.recordVoiceChannel).toHaveBeenCalledWith("run-1", "222");
    expect(resolved.get("run-1")).toBe("222");
  });

  it("no usable voice category (null creator) creates nothing and records nothing", async () => {
    const a = adapters({ create: null });
    const resolved = await reconcileRunVoiceChannels(a.value, [item("PROVISION", null)]);
    expect(a.recordVoiceChannel).not.toHaveBeenCalled();
    expect(resolved.has("run-1")).toBe(false);
  });

  it.each([
    ["Missing Permissions", missingPermissions],
    ["transient error", () => new Error("ECONNRESET")],
  ])("creation failure (%s) persists nothing and is retryable", async (_label, makeError) => {
    const a = adapters({ create: async () => { throw makeError(); } });
    const resolved = await reconcileRunVoiceChannels(a.value, [item("PROVISION", null)]);
    expect(a.recordVoiceChannel).not.toHaveBeenCalled();
    expect(resolved.has("run-1")).toBe(false);
    // A later poll still sees PROVISION and tries again.
    const retry = adapters();
    await reconcileRunVoiceChannels(retry.value, [item("PROVISION", null)]);
    expect(retry.createVoiceChannel).toHaveBeenCalledTimes(1);
  });
});

describe("reconcileRunVoiceChannels — create → persist atomicity", () => {
  it("A: persist failure → created once, record tried once, compensating delete, NOT in the resolved map", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = adapters({ recordFails: new Error("bot api 503") });
    const resolved = await reconcileRunVoiceChannels(a.value, [item("PROVISION", null)]);
    expect(a.createVoiceChannel).toHaveBeenCalledTimes(1);
    expect(a.recordVoiceChannel).toHaveBeenCalledTimes(1);
    expect(a.recordVoiceChannel).toHaveBeenCalledWith("run-1", "222");
    expect(a.createdDelete).toHaveBeenCalledTimes(1);
    expect(resolved.has("run-1")).toBe(false);
    error.mockRestore();
  });

  it("D: persist AND compensation fail → not resolved, high-signal ORPHANED error with run and channel id, no throw", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = adapters({ recordFails: new Error("bot api 503"), compensationFails: missingPermissions() });
    const resolved = await reconcileRunVoiceChannels(a.value, [item("PROVISION", null)]);
    expect(resolved.has("run-1")).toBe(false);
    const orphan = error.mock.calls.map((call) => String(call[0])).find((message) => message.includes("ORPHANED VOICE CHANNEL"));
    expect(orphan).toContain("run-1");
    expect(orphan).toContain("222");
    error.mockRestore();
  });

  it("E: normal success → persisted, then resolved; no compensation", async () => {
    const a = adapters();
    const resolved = await reconcileRunVoiceChannels(a.value, [item("PROVISION", null)]);
    expect(a.recordVoiceChannel).toHaveBeenCalledWith("run-1", "222");
    expect(a.createdDelete).not.toHaveBeenCalled();
    expect(resolved.get("run-1")).toBe("222");
  });

  it("Unknown-Channel recreate whose persist fails leaves the run resolved to null (never the unpersisted id)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = adapters({ channel: () => { throw unknownChannel(); }, recordFails: new Error("bot api 503") });
    const resolved = await reconcileRunVoiceChannels(a.value, [item("RECONCILE")]);
    expect(a.clearVoiceChannel).toHaveBeenCalledWith("run-1", "voice-1");
    expect(a.createdDelete).toHaveBeenCalledTimes(1);
    expect(resolved.get("run-1")).toBeNull();
    error.mockRestore();
  });
});

describe("reconcileRunVoiceChannels — no creator (category unset/invalid) still manages existing channels", () => {
  it("RECONCILE keeps and renames an existing channel without any creator", async () => {
    const channel = voice(0, "Raid with Simon");
    const a = adapters({ channel, create: null });
    const resolved = await reconcileRunVoiceChannels(a.value, [item("RECONCILE")]);
    expect(channel.setName).toHaveBeenCalledWith("Raid with Syntax");
    expect(a.clearVoiceChannel).not.toHaveBeenCalled();
    expect(resolved.get("run-1")).toBe("voice-1");
  });

  it("RETIRE_IF_EMPTY deletes an empty channel and keeps an occupied one without any creator", async () => {
    const empty = voice(0);
    const emptyAdapters = adapters({ channel: empty, create: null });
    await reconcileRunVoiceChannels(emptyAdapters.value, [item("RETIRE_IF_EMPTY")]);
    expect(empty.delete).toHaveBeenCalledTimes(1);
    expect(emptyAdapters.clearVoiceChannel).toHaveBeenCalledWith("run-1", "voice-1");

    const occupied = voice(4);
    const occupiedAdapters = adapters({ channel: occupied, create: null });
    await reconcileRunVoiceChannels(occupiedAdapters.value, [item("RETIRE_IF_EMPTY")]);
    expect(occupied.delete).not.toHaveBeenCalled();
    expect(occupiedAdapters.clearVoiceChannel).not.toHaveBeenCalled();
  });
});

describe("reconcileRunVoiceChannels — IN_PROGRESS (RECONCILE)", () => {
  it("keeps an existing EMPTY voice channel and never creates a duplicate", async () => {
    const channel = voice(0);
    const a = adapters({ channel });
    const resolved = await reconcileRunVoiceChannels(a.value, [item("RECONCILE")]);
    expect(channel.delete).not.toHaveBeenCalled();
    expect(a.createVoiceChannel).not.toHaveBeenCalled();
    expect(a.clearVoiceChannel).not.toHaveBeenCalled();
    expect(resolved.get("run-1")).toBe("voice-1");
  });

  it("renames a reused channel when the effective Raid Lead name changed", async () => {
    const channel = voice(2, "Raid with Simon");
    await reconcileRunVoiceChannels(adapters({ channel }).value, [item("RECONCILE")]);
    expect(channel.setName).toHaveBeenCalledWith("Raid with Syntax");
  });

  it("Unknown Channel: clears the stale id and recreates exactly once in the same pass", async () => {
    const a = adapters({ channel: () => { throw unknownChannel(); } });
    const resolved = await reconcileRunVoiceChannels(a.value, [item("RECONCILE")]);
    expect(a.clearVoiceChannel).toHaveBeenCalledWith("run-1", "voice-1");
    expect(a.createVoiceChannel).toHaveBeenCalledTimes(1);
    expect(a.recordVoiceChannel).toHaveBeenCalledWith("run-1", "222");
    expect(resolved.get("run-1")).toBe("222");
  });

  it.each([
    ["Missing Access", missingAccess],
    ["transient error", () => new Error("ECONNRESET")],
  ])("%s keeps the persisted id and creates nothing", async (_label, makeError) => {
    const a = adapters({ channel: () => { throw makeError(); } });
    await reconcileRunVoiceChannels(a.value, [item("RECONCILE")]);
    expect(a.clearVoiceChannel).not.toHaveBeenCalled();
    expect(a.createVoiceChannel).not.toHaveBeenCalled();
  });

  it("incompatible channel type: not deleted, not replaced, not cleared", async () => {
    const a = adapters({ channel: { kind: "other" } });
    const resolved = await reconcileRunVoiceChannels(a.value, [item("RECONCILE")]);
    expect(a.clearVoiceChannel).not.toHaveBeenCalled();
    expect(a.createVoiceChannel).not.toHaveBeenCalled();
    expect(resolved.has("run-1")).toBe(false);
  });
});

describe("reconcileRunVoiceChannels — terminal / app-archived (RETIRE_IF_EMPTY)", () => {
  it.each([3, 1])("keeps an occupied channel (%i connected) and keeps its id for a later retry", async (members) => {
    const channel = voice(members);
    const a = adapters({ channel });
    const resolved = await reconcileRunVoiceChannels(a.value, [item("RETIRE_IF_EMPTY")]);
    expect(channel.delete).not.toHaveBeenCalled();
    expect(a.clearVoiceChannel).not.toHaveBeenCalled();
    expect(resolved.has("run-1")).toBe(false);
  });

  it("deletes an empty channel, then clears its id", async () => {
    const channel = voice(0);
    const a = adapters({ channel });
    const resolved = await reconcileRunVoiceChannels(a.value, [item("RETIRE_IF_EMPTY")]);
    expect(channel.delete).toHaveBeenCalledTimes(1);
    expect(a.clearVoiceChannel).toHaveBeenCalledWith("run-1", "voice-1");
    expect(resolved.get("run-1")).toBeNull();
    expect(a.createVoiceChannel).not.toHaveBeenCalled();
  });

  it("Example B: occupied 5 → 2 → 0 connected — deleted only on the poll after the last user leaves", async () => {
    for (const members of [5, 2]) {
      const channel = voice(members);
      const a = adapters({ channel });
      await reconcileRunVoiceChannels(a.value, [item("RETIRE_IF_EMPTY")]);
      expect(channel.delete).not.toHaveBeenCalled();
      expect(a.clearVoiceChannel).not.toHaveBeenCalled();
    }
    const channel = voice(0);
    const a = adapters({ channel });
    await reconcileRunVoiceChannels(a.value, [item("RETIRE_IF_EMPTY")]);
    expect(channel.delete).toHaveBeenCalledTimes(1);
    expect(a.clearVoiceChannel).toHaveBeenCalledWith("run-1", "voice-1");
  });

  it("Unknown Channel clears the id", async () => {
    const a = adapters({ channel: () => { throw unknownChannel(); } });
    const resolved = await reconcileRunVoiceChannels(a.value, [item("RETIRE_IF_EMPTY")]);
    expect(a.clearVoiceChannel).toHaveBeenCalledWith("run-1", "voice-1");
    expect(resolved.get("run-1")).toBeNull();
  });

  it("delete hitting Unknown Channel (already gone) still clears the id", async () => {
    const channel = voice(0);
    channel.delete.mockRejectedValue(unknownChannel());
    const a = adapters({ channel });
    await reconcileRunVoiceChannels(a.value, [item("RETIRE_IF_EMPTY")]);
    expect(a.clearVoiceChannel).toHaveBeenCalledWith("run-1", "voice-1");
  });

  it("Missing Permissions on delete keeps the id for a later retry", async () => {
    const channel = voice(0);
    channel.delete.mockRejectedValue(missingPermissions());
    const a = adapters({ channel });
    const resolved = await reconcileRunVoiceChannels(a.value, [item("RETIRE_IF_EMPTY")]);
    expect(a.clearVoiceChannel).not.toHaveBeenCalled();
    expect(resolved.has("run-1")).toBe(false);
  });

  it("Missing Access when fetching keeps the id", async () => {
    const a = adapters({ channel: () => { throw missingAccess(); } });
    await reconcileRunVoiceChannels(a.value, [item("RETIRE_IF_EMPTY")]);
    expect(a.clearVoiceChannel).not.toHaveBeenCalled();
  });

  it("incompatible channel type is never deleted and its id is kept", async () => {
    const a = adapters({ channel: { kind: "other" } });
    await reconcileRunVoiceChannels(a.value, [item("RETIRE_IF_EMPTY")]);
    expect(a.clearVoiceChannel).not.toHaveBeenCalled();
  });

  it("never creates a channel for a terminal Run", async () => {
    const a = adapters({ channel: () => { throw unknownChannel(); } });
    await reconcileRunVoiceChannels(a.value, [item("RETIRE_IF_EMPTY")]);
    expect(a.createVoiceChannel).not.toHaveBeenCalled();
  });
});

describe("reconcileRunVoiceChannels — isolation", () => {
  it("one Run's failure does not stop another Run's voice work", async () => {
    const a = adapters();
    a.fetchChannel.mockRejectedValueOnce(new Error("boom"));
    const resolved = await reconcileRunVoiceChannels(a.value, [
      { ...item("RECONCILE"), runId: "run-a" },
      { ...item("PROVISION", null), runId: "run-b" },
    ]);
    expect(resolved.get("run-b")).toBe("222");
  });
});

describe("reconcileRunVoiceChannels — fixed pool (Raid #1 / Raid #2)", () => {
  const POOL = ["raid-1", "raid-2"];

  function poolAdapters(channels: Record<string, VoiceChannelView | (() => never)>, options: { recordFails?: unknown } = {}) {
    const a = adapters({ recordFails: options.recordFails });
    a.value.fetchChannel = vi.fn(async (id: string): Promise<VoiceChannelView> => {
      const channel = channels[id];
      if (typeof channel === "function") return channel();
      return channel ?? { kind: "unresolved" };
    });
    return a;
  }

  function run(runId: string, action: RunVoiceChannelWorkItem["action"], existingVoiceChannelId: string | null = null): RunVoiceChannelWorkItem {
    return { runId, existingVoiceChannelId, desiredVoiceChannelName: "Raid with Syntax", action };
  }

  it("Start Run assigns the first pool channel — nothing is created", async () => {
    const a = poolAdapters({ "raid-1": voice(0, "Raid #1"), "raid-2": voice(0, "Raid #2") });
    const resolved = await reconcileRunVoiceChannels(a.value, [run("run-a", "PROVISION")], { pool: POOL });
    expect(a.recordVoiceChannel).toHaveBeenCalledWith("run-a", "raid-1");
    expect(a.createVoiceChannel).not.toHaveBeenCalled();
    expect(resolved.get("run-a")).toBe("raid-1");
  });

  it("a second running Raid gets Raid #2 while Raid #1 is held", async () => {
    const a = poolAdapters({ "raid-1": voice(4, "Raid #1"), "raid-2": voice(0, "Raid #2") });
    const resolved = await reconcileRunVoiceChannels(
      a.value,
      [run("run-b", "PROVISION"), run("run-a", "RECONCILE", "raid-1")],
      { pool: POOL },
    );
    expect(resolved.get("run-a")).toBe("raid-1");
    expect(resolved.get("run-b")).toBe("raid-2");
    expect(a.recordVoiceChannel).toHaveBeenCalledTimes(1);
  });

  it("two Runs starting in the same pass get different channels", async () => {
    const a = poolAdapters({ "raid-1": voice(0, "Raid #1"), "raid-2": voice(0, "Raid #2") });
    const resolved = await reconcileRunVoiceChannels(a.value, [run("run-a", "PROVISION"), run("run-b", "PROVISION")], {
      pool: POOL,
    });
    expect([resolved.get("run-a"), resolved.get("run-b")]).toEqual(["raid-1", "raid-2"]);
  });

  it("pool full → temporary channel fallback", async () => {
    const a = poolAdapters({ "raid-1": voice(1), "raid-2": voice(1) });
    const resolved = await reconcileRunVoiceChannels(
      a.value,
      [run("run-a", "RECONCILE", "raid-1"), run("run-b", "RECONCILE", "raid-2"), run("run-c", "PROVISION")],
      { pool: POOL },
    );
    expect(a.createVoiceChannel).toHaveBeenCalledWith("Raid with Syntax");
    expect(resolved.get("run-c")).toBe("222");
  });

  it("a held pool channel keeps its own name (never renamed to the Raid Lead)", async () => {
    const raid1 = voice(0, "Raid #1");
    const a = poolAdapters({ "raid-1": raid1 });
    await reconcileRunVoiceChannels(a.value, [run("run-a", "RECONCILE", "raid-1")], { pool: POOL });
    expect(raid1.setName).not.toHaveBeenCalled();
    expect(a.clearVoiceChannel).not.toHaveBeenCalled();
  });

  it("Run end releases the pool channel at once — never deleted, even while people are connected", async () => {
    const raid1 = voice(6, "Raid #1");
    const a = poolAdapters({ "raid-1": raid1, "raid-2": voice(0, "Raid #2") });
    const resolved = await reconcileRunVoiceChannels(
      a.value,
      [run("run-new", "PROVISION"), run("run-old", "RETIRE_IF_EMPTY", "raid-1")],
      { pool: POOL },
    );
    expect(raid1.delete).not.toHaveBeenCalled();
    expect(a.clearVoiceChannel).toHaveBeenCalledWith("run-old", "raid-1");
    expect(resolved.get("run-old")).toBeNull();
    // Released in this pass → free for the Run that starts in the same pass.
    expect(resolved.get("run-new")).toBe("raid-1");
  });

  it("a deleted pool channel is cleared and the Run moves to the next free one", async () => {
    const a = poolAdapters({
      "raid-1": () => {
        throw unknownChannel();
      },
      "raid-2": voice(0, "Raid #2"),
    });
    const resolved = await reconcileRunVoiceChannels(a.value, [run("run-a", "RECONCILE", "raid-1")], { pool: POOL });
    expect(a.clearVoiceChannel).toHaveBeenCalledWith("run-a", "raid-1");
    expect(resolved.get("run-a")).toBe("raid-2");
    expect(a.createVoiceChannel).not.toHaveBeenCalled();
  });

  it("a pool id that is not a voice channel is skipped", async () => {
    const a = poolAdapters({ "raid-1": { kind: "other" }, "raid-2": voice(0, "Raid #2") });
    const resolved = await reconcileRunVoiceChannels(a.value, [run("run-a", "PROVISION")], { pool: POOL });
    expect(resolved.get("run-a")).toBe("raid-2");
  });

  it("a held channel whose fetch failed this pass stays taken", async () => {
    const a = poolAdapters({
      "raid-1": () => {
        throw missingAccess();
      },
      "raid-2": voice(0, "Raid #2"),
    });
    const resolved = await reconcileRunVoiceChannels(
      a.value,
      [run("run-a", "RECONCILE", "raid-1"), run("run-b", "PROVISION")],
      { pool: POOL },
    );
    expect(resolved.get("run-b")).toBe("raid-2");
  });

  it("assignment that cannot be recorded creates nothing and retries next poll", async () => {
    const a = poolAdapters({ "raid-1": voice(0, "Raid #1") }, { recordFails: new Error("api down") });
    const resolved = await reconcileRunVoiceChannels(a.value, [run("run-a", "PROVISION")], { pool: POOL });
    expect(a.createVoiceChannel).not.toHaveBeenCalled();
    expect(resolved.has("run-a")).toBe(false);
  });

  it("a temporary channel from before the pool keeps the old lifecycle", async () => {
    const temp = voice(0);
    const a = poolAdapters({ "temp-1": temp });
    await reconcileRunVoiceChannels(a.value, [run("run-a", "RETIRE_IF_EMPTY", "temp-1")], { pool: POOL });
    expect(temp.delete).toHaveBeenCalledTimes(1);
  });
});
