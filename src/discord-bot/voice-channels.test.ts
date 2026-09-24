import { describe, expect, it, vi } from "vitest";
import {
  reconcileRunVoiceChannels,
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
  create?: (() => Promise<string>) | null;
} = {}) {
  const recordVoiceChannel = vi.fn().mockResolvedValue(undefined);
  const clearVoiceChannel = vi.fn().mockResolvedValue(undefined);
  const createVoiceChannel = options.create === null ? null : vi.fn(options.create ?? (async () => "222"));
  const fetchChannel = vi.fn(async () => {
    if (typeof options.channel === "function") return options.channel();
    return options.channel ?? voice(0);
  });
  const value: RunVoiceChannelAdapters = { fetchChannel, createVoiceChannel, recordVoiceChannel, clearVoiceChannel };
  return { value, fetchChannel, createVoiceChannel, recordVoiceChannel, clearVoiceChannel };
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
