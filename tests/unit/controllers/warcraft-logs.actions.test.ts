import { describe, expect, it, vi, beforeEach } from "vitest";

const linkForOwner = vi.fn();
const linkMissingForOwner = vi.fn();
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
    linkMissingForOwner: (...args: unknown[]) => linkMissingForOwner(...args),
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
    linkMissingForOwner.mockReset();
    revalidatePath.mockReset();
    requireUser.mockResolvedValue(owner);
  });

  it("maps NO_MISSING to a success ActionResult", async () => {
    linkMissingForOwner.mockResolvedValue({ status: "NO_MISSING" });
    const result = await linkMissingWarcraftLogsCharactersAction();
    expect(requireUser).toHaveBeenCalled();
    expect(linkMissingForOwner).toHaveBeenCalledWith(owner);
    expect(result).toEqual({
      ok: true,
      message: "No active characters are missing Warcraft Logs links.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("maps NOT_CONFIGURED to WCL_NOT_CONFIGURED", async () => {
    linkMissingForOwner.mockResolvedValue({ status: "NOT_CONFIGURED" });
    const result = await linkMissingWarcraftLogsCharactersAction();
    expect(result).toEqual({
      ok: false,
      code: "WCL_NOT_CONFIGURED",
      message: "Warcraft Logs API is not configured on this server.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("formats COMPLETED summaries and revalidates /characters", async () => {
    linkMissingForOwner.mockResolvedValue({
      status: "COMPLETED",
      summary: {
        total: 2,
        attempted: 2,
        linked: 2,
        alreadyLinked: 0,
        notFound: 0,
        mismatch: 0,
        unsupportedRegion: 0,
        temporaryFailure: 0,
        skippedAfterFailure: 0,
      },
    });

    const result = await linkMissingWarcraftLogsCharactersAction();
    expect(linkMissingForOwner).toHaveBeenCalledWith(owner);
    expect(result).toEqual({ ok: true, message: "2 Warcraft Logs characters linked." });
    expect(revalidatePath).toHaveBeenCalledWith("/characters");
  });

  it("formats temporary-failure COMPLETED summaries", async () => {
    linkMissingForOwner.mockResolvedValue({
      status: "COMPLETED",
      summary: {
        total: 3,
        attempted: 1,
        linked: 0,
        alreadyLinked: 0,
        notFound: 0,
        mismatch: 0,
        unsupportedRegion: 0,
        temporaryFailure: 1,
        skippedAfterFailure: 2,
      },
    });

    const result = await linkMissingWarcraftLogsCharactersAction();
    expect(result).toEqual({
      ok: true,
      message: "0 linked before Warcraft Logs became unavailable · 2 skipped.",
    });
  });

  it("maps unexpected service errors through mapActionError", async () => {
    linkMissingForOwner.mockRejectedValue(new Error("boom"));
    await expect(linkMissingWarcraftLogsCharactersAction()).resolves.toMatchObject({
      ok: false,
      code: "UNEXPECTED",
    });
  });
});
