import { describe, expect, it, vi, beforeEach } from "vitest";

const linkForOwner = vi.fn();
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
  },
}));

import { linkWarcraftLogsCharacterAction } from "@/controllers/warcraft-logs.actions";

describe("linkWarcraftLogsCharacterAction", () => {
  beforeEach(() => {
    requireUser.mockReset();
    linkForOwner.mockReset();
    revalidatePath.mockReset();
    requireUser.mockResolvedValue({
      id: "user-1",
      name: "Owner",
      email: "o@test.local",
      image: null,
      discordUserId: null,
      discordUsername: null,
      accountRole: "USER",
      accountStatus: "ACTIVE",
    });
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

  it("maps not found and not configured without crashing", async () => {
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
