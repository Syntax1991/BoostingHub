import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { orm } from "@/lib/prisma";

/**
 * Self-service sessions against the real session rows. Better Auth itself is mocked: these
 * tests prove which session it is asked to end, and what a caller can see.
 */
const authApi = vi.hoisted(() => ({
  getSession: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
  revokeSessions: vi.fn(),
}));
const requireUser = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/auth/auth", () => ({ auth: { api: authApi } }));
vi.mock("@/auth/session", () => ({ requireUser }));

import { sessionManagementService } from "@/services/session-management.service";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-5e5500000001";
const OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-5e5500000002";
const CURRENT = "aaaaaaaa-aaaa-4aaa-8aaa-5e5500000011";
const SECOND_DEVICE = "aaaaaaaa-aaaa-4aaa-8aaa-5e5500000012";
const EXPIRED = "aaaaaaaa-aaaa-4aaa-8aaa-5e5500000013";
const OTHERS_SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-5e5500000021";

const inFuture = () => new Date(Date.now() + 86_400_000).toISOString();

async function cleanup() {
  for (const userId of [OWNER, OTHER]) {
    await orm.Session.where({ userId }).deleteAndCount();
    await orm.User.where({ id: userId }).delete().catch(() => {});
  }
}

beforeAll(async () => {
  await cleanup();
  const now = new Date().toISOString();
  for (const id of [OWNER, OTHER]) {
    await orm.User.create({
      id,
      name: id,
      email: `${id}@sessions.boostting.local`,
      emailVerified: true,
      accountRole: "USER",
      accountStatus: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    });
  }
  for (const [id, userId, expiresAt] of [
    [CURRENT, OWNER, inFuture()],
    [SECOND_DEVICE, OWNER, inFuture()],
    [EXPIRED, OWNER, new Date(Date.now() - 1000).toISOString()],
    [OTHERS_SESSION, OTHER, inFuture()],
  ] as const) {
    await orm.Session.create({ id, userId, token: `token-${id}`, expiresAt, createdAt: now, updatedAt: now });
  }
});

afterAll(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: OWNER });
  authApi.getSession.mockResolvedValue({ session: { id: CURRENT }, user: { id: OWNER } });
});

describe("listing own sessions", () => {
  it("lists only the caller's active sessions, current first, without tokens", async () => {
    const sessions = await sessionManagementService.listOwnSessions();

    expect(sessions.map((session) => [session.id, session.isCurrent])).toEqual([
      [CURRENT, true],
      [SECOND_DEVICE, false],
    ]);
    expect(JSON.stringify(sessions)).not.toContain("token-");
  });

  it("refuses when there is no current session", async () => {
    authApi.getSession.mockResolvedValue(null);
    await expect(sessionManagementService.listOwnSessions()).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
  });
});

describe("revoking one session", () => {
  it("ends the caller's other device with that session's token", async () => {
    await sessionManagementService.revokeOwnSession(SECOND_DEVICE);

    expect(authApi.revokeSession).toHaveBeenCalledOnce();
    expect(authApi.revokeSession.mock.calls[0]![0].body).toEqual({ token: `token-${SECOND_DEVICE}` });
  });

  it("cannot end another user's session, and does not reveal that it exists", async () => {
    await expect(sessionManagementService.revokeOwnSession(OTHERS_SESSION)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(authApi.revokeSession).not.toHaveBeenCalled();
  });

  it("cannot end an expired session", async () => {
    await expect(sessionManagementService.revokeOwnSession(EXPIRED)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(authApi.revokeSession).not.toHaveBeenCalled();
  });

  it("sends the current session to Sign out instead of ending it here", async () => {
    await expect(sessionManagementService.revokeOwnSession(CURRENT)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(authApi.revokeSession).not.toHaveBeenCalled();
  });
});

describe("signed-out callers", () => {
  it.each([
    ["listOwnSessions", () => sessionManagementService.listOwnSessions()],
    ["revokeOwnSession", () => sessionManagementService.revokeOwnSession(SECOND_DEVICE)],
    ["revokeOtherOwnSessions", () => sessionManagementService.revokeOtherOwnSessions()],
    ["revokeAllOwnSessions", () => sessionManagementService.revokeAllOwnSessions()],
  ])("%s touches nothing", async (_name, call) => {
    requireUser.mockRejectedValue(Object.assign(new Error("Sign in is required."), { code: "NOT_AUTHENTICATED" }));

    await expect(call()).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
    expect(authApi.revokeSession).not.toHaveBeenCalled();
    expect(authApi.revokeOtherSessions).not.toHaveBeenCalled();
    expect(authApi.revokeSessions).not.toHaveBeenCalled();
  });
});
