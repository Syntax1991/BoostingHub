import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";

const listByUserId = vi.fn();
const isConfigured = vi.fn();

vi.mock("@/repositories/character.repository", () => ({
  characterRepository: {
    listByUserId: (...args: unknown[]) => listByUserId(...args),
    findById: vi.fn(),
    setWarcraftLogsId: vi.fn(),
  },
}));

vi.mock("@/integrations/warcraft-logs/warcraft-logs-api-client", () => ({
  warcraftLogsApiClient: {
    isConfigured: (...args: unknown[]) => isConfigured(...args),
    findCharacter: vi.fn(),
  },
  resetWarcraftLogsClientTokenCacheForTests: vi.fn(),
}));

import { characterWarcraftLogsService } from "@/services/character-warcraft-logs.service";

const owner: AuthenticatedUser = {
  id: "user-owner",
  name: "Owner",
  email: "owner@test.local",
  image: null,
  discordUserId: null,
  discordUsername: null,
  accountRole: "USER",
  accountStatus: "ACTIVE",
};

describe("characterWarcraftLogsService.linkMissingForOwner", () => {
  beforeEach(() => {
    listByUserId.mockReset();
    isConfigured.mockReset();
    isConfigured.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("batches only active owned Characters missing warcraftLogsId", async () => {
    listByUserId.mockResolvedValue([
      { id: "A", isActive: true, warcraftLogsId: null },
      { id: "B", isActive: true, warcraftLogsId: "   " },
      { id: "C", isActive: true, warcraftLogsId: "already" },
      { id: "D", isActive: false, warcraftLogsId: null },
    ]);
    const batch = vi.spyOn(characterWarcraftLogsService, "tryAutoLinkManyIfMissing").mockResolvedValue({
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

    const result = await characterWarcraftLogsService.linkMissingForOwner(owner);

    expect(listByUserId).toHaveBeenCalledWith("user-owner");
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith(["A", "B"]);
    expect(result).toEqual({
      status: "COMPLETED",
      summary: expect.objectContaining({ total: 2, linked: 2 }),
    });
  });

  it("returns NO_MISSING without calling the batch when nothing qualifies", async () => {
    listByUserId.mockResolvedValue([
      { id: "C", isActive: true, warcraftLogsId: "already" },
      { id: "D", isActive: false, warcraftLogsId: null },
    ]);
    const batch = vi.spyOn(characterWarcraftLogsService, "tryAutoLinkManyIfMissing");

    const result = await characterWarcraftLogsService.linkMissingForOwner(owner);

    expect(result).toEqual({ status: "NO_MISSING" });
    expect(batch).not.toHaveBeenCalled();
  });

  it("returns NOT_CONFIGURED without calling the batch", async () => {
    listByUserId.mockResolvedValue([{ id: "A", isActive: true, warcraftLogsId: null }]);
    isConfigured.mockReturnValue(false);
    const batch = vi.spyOn(characterWarcraftLogsService, "tryAutoLinkManyIfMissing");

    const result = await characterWarcraftLogsService.linkMissingForOwner(owner);

    expect(result).toEqual({ status: "NOT_CONFIGURED" });
    expect(batch).not.toHaveBeenCalled();
  });

  it("preserves mixed batch summary counts on COMPLETED", async () => {
    listByUserId.mockResolvedValue([
      { id: "A", isActive: true, warcraftLogsId: null },
      { id: "B", isActive: true, warcraftLogsId: null },
    ]);
    const summary = {
      total: 2,
      attempted: 2,
      linked: 1,
      alreadyLinked: 0,
      notFound: 1,
      mismatch: 0,
      unsupportedRegion: 0,
      temporaryFailure: 0,
      skippedAfterFailure: 0,
    };
    vi.spyOn(characterWarcraftLogsService, "tryAutoLinkManyIfMissing").mockResolvedValue(summary);

    const result = await characterWarcraftLogsService.linkMissingForOwner(owner);
    expect(result).toEqual({ status: "COMPLETED", summary });
  });

  it("propagates unexpected repository failures", async () => {
    listByUserId.mockRejectedValue(new Error("db down"));
    await expect(characterWarcraftLogsService.linkMissingForOwner(owner)).rejects.toThrow("db down");
  });
});
