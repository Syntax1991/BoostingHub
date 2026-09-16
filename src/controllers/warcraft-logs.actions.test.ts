import { describe, expect, it, vi, beforeEach } from "vitest";

const linkForOwner = vi.fn();
const tryAutoLinkManyIfMissing = vi.fn();
const listByUserId = vi.fn();
const isConfigured = vi.fn();
const requireUser = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

vi.mock("@/services/character-warcraft-logs.service", () => ({
  characterWarcraftLogsService: {
    linkForOwner: (...args: unknown[]) => linkForOwner(...args),
    tryAutoLinkManyIfMissing: (...args: unknown[]) => tryAutoLinkManyIfMissing(...args),
  },
}));

vi.mock("@/repositories/character.repository", () => ({
  characterRepository: {
    listByUserId: (...args: unknown[]) => listByUserId(...args),
  },
}));

vi.mock("@/integrations/warcraft-logs/warcraft-logs-api-client", () => ({
  warcraftLogsApiClient: {
    isConfigured: (...args: unknown[]) => isConfigured(...args),
  },
}));

import {
  linkWarcraftLogsCharacterAction,
  linkMissingWarcraftLogsCharactersAction,
} from "@/controllers/warcraft-logs.actions";

const owner = {
  id: "user-1",
  name: "Owner",
  email: "o@test.local",
  image: null,
  discordUserId: null,
  discordUsername: null,
  accountRole: "USER" as const,
  accountStatus: "ACTIVE" as const,
};

describe("linkWarcraftLogsCharacterAction", () => {
  beforeEach(() => {
    requireUser.mockReset();
    linkForOwner.mockReset();
    revalidatePath.mockReset();
    requireUser.mockResolvedValue(owner);
  });

  it("returns success and revalidates on LINKED", async () => {
    linkForOwner.mockResolvedValue({ status: "LINKED", warcraftLogsId: "99" });
    const result = await linkWarcraftLogsCharacterAction({
      characterId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(result).toEqual({ ok: true, message: "Warcraft Logs character linked." });
    expect(revalidatePath).toHaveBeenCalledWith("/characters");
    expect(revalidatePath).toHaveBeenCalledWith("/characters/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("maps not found, not configured, and temporary failure without crashing", async () => {
    linkForOwner.mockResolvedValue({ status: "NOT_FOUND" });
    await expect(
      linkWarcraftLogsCharacterAction({ characterId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    ).resolves.toMatchObject({
      ok: false,
      code: "WCL_CHARACTER_NOT_FOUND",
      message: "No Warcraft Logs character found yet.",
    });

    linkForOwner.mockResolvedValue({ status: "NOT_CONFIGURED" });
    await expect(
      linkWarcraftLogsCharacterAction({ characterId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    ).resolves.toMatchObject({
      ok: false,
      code: "WCL_NOT_CONFIGURED",
      message: "Warcraft Logs API is not configured on this server.",
    });

    linkForOwner.mockResolvedValue({ status: "TEMPORARY_FAILURE", message: "timeout" });
    await expect(
      linkWarcraftLogsCharacterAction({ characterId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    ).resolves.toMatchObject({
      ok: false,
      code: "WCL_TEMPORARY_FAILURE",
      message: "Warcraft Logs is temporarily unavailable. Try again later.",
    });
  });

  it("maps ownership failures through DomainError handling", async () => {
    const { DomainError } = await import("@/lib/errors");
    linkForOwner.mockRejectedValue(new DomainError("CHARACTER_NOT_OWNED", "Not yours.", 403));
    await expect(
      linkWarcraftLogsCharacterAction({ characterId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    ).resolves.toMatchObject({
      ok: false,
      code: "CHARACTER_NOT_OWNED",
    });
  });
});

describe("linkMissingWarcraftLogsCharactersAction", () => {
  beforeEach(() => {
    requireUser.mockReset();
    listByUserId.mockReset();
    tryAutoLinkManyIfMissing.mockReset();
    isConfigured.mockReset();
    revalidatePath.mockReset();
    requireUser.mockResolvedValue(owner);
    isConfigured.mockReturnValue(true);
  });

  it("batches only active owned Characters missing warcraftLogsId", async () => {
    listByUserId.mockResolvedValue([
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", isActive: true, warcraftLogsId: null },
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", isActive: true, warcraftLogsId: "   " },
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", isActive: true, warcraftLogsId: "already" },
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", isActive: false, warcraftLogsId: null },
    ]);
    tryAutoLinkManyIfMissing.mockResolvedValue({
      total: 2,
      attempted: 2,
      linked: 2,
      alreadyLinked: 0,
      notFound: 0,
      mismatch: 0,
      unsupportedRegion: 0,
      temporaryFailure: 0,
      skippedAfterFailure: 0,
    });

    const result = await linkMissingWarcraftLogsCharactersAction();

    expect(listByUserId).toHaveBeenCalledWith("user-1");
    expect(tryAutoLinkManyIfMissing).toHaveBeenCalledTimes(1);
    expect(tryAutoLinkManyIfMissing).toHaveBeenCalledWith([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    ]);
    expect(result).toEqual({ ok: true, message: "2 Warcraft Logs characters linked." });
    expect(revalidatePath).toHaveBeenCalledWith("/characters");
  });

  it("returns nothing-to-do without calling the batch service", async () => {
    listByUserId.mockResolvedValue([
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", isActive: true, warcraftLogsId: "already" },
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", isActive: false, warcraftLogsId: null },
    ]);

    const result = await linkMissingWarcraftLogsCharactersAction();

    expect(tryAutoLinkManyIfMissing).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      message: "No active characters are missing Warcraft Logs links.",
    });
  });

  it("returns not configured without batching", async () => {
    listByUserId.mockResolvedValue([
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", isActive: true, warcraftLogsId: null },
    ]);
    isConfigured.mockReturnValue(false);

    const result = await linkMissingWarcraftLogsCharactersAction();

    expect(tryAutoLinkManyIfMissing).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      code: "WCL_NOT_CONFIGURED",
      message: "Warcraft Logs API is not configured on this server.",
    });
  });

  it("formats temporary-failure summaries with skipped remainder", async () => {
    listByUserId.mockResolvedValue([
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", isActive: true, warcraftLogsId: null },
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", isActive: true, warcraftLogsId: null },
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", isActive: true, warcraftLogsId: null },
    ]);
    tryAutoLinkManyIfMissing.mockResolvedValue({
      total: 3,
      attempted: 1,
      linked: 0,
      alreadyLinked: 0,
      notFound: 0,
      mismatch: 0,
      unsupportedRegion: 0,
      temporaryFailure: 1,
      skippedAfterFailure: 2,
    });

    const result = await linkMissingWarcraftLogsCharactersAction();
    expect(result).toEqual({
      ok: true,
      message: "0 linked before Warcraft Logs became unavailable · 2 skipped.",
    });
  });

  it("does not accept client Character IDs as ownership authority", async () => {
    listByUserId.mockResolvedValue([
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", isActive: true, warcraftLogsId: null },
    ]);
    tryAutoLinkManyIfMissing.mockResolvedValue({
      total: 1,
      attempted: 1,
      linked: 1,
      alreadyLinked: 0,
      notFound: 0,
      mismatch: 0,
      unsupportedRegion: 0,
      temporaryFailure: 0,
      skippedAfterFailure: 0,
    });

    // Action takes no input — foreign IDs cannot be injected.
    await linkMissingWarcraftLogsCharactersAction();
    expect(tryAutoLinkManyIfMissing.mock.calls[0]?.[0]).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    ]);
  });
});
