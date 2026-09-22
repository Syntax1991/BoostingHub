import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { orm } from "@/lib/prisma";
import { authSessionRepository } from "@/repositories/auth-session.repository";

const ids = {
  user: "cccccccc-cccc-4ccc-8ccc-sess00000001",
  other: "cccccccc-cccc-4ccc-8ccc-sess00000002",
  active: "cccccccc-cccc-4ccc-8ccc-sess00000011",
  expired: "cccccccc-cccc-4ccc-8ccc-sess00000012",
  otherSession: "cccccccc-cccc-4ccc-8ccc-sess00000013",
};

async function deleteUserCascade(userId: string) {
  try {
    const sessions = await orm.Session.where({ userId }).all();
    for (const session of sessions) {
      await orm.Session.where({ id: session.id }).delete();
    }
  } catch {
    // ignore
  }
  try {
    await orm.User.where({ id: userId }).delete();
  } catch {
    // ignore
  }
}

async function createUser(id: string, name: string) {
  const now = new Date().toISOString();
  await orm.User.create({
    id,
    name,
    email: `${id}@authsess.boostting.local`,
    emailVerified: true,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
}

describe("authSessionRepository", () => {
  beforeEach(async () => {
    await deleteUserCascade(ids.user);
    await deleteUserCascade(ids.other);
    await createUser(ids.user, "Session Owner");
    await createUser(ids.other, "Session Other");
  });

  afterAll(async () => {
    await deleteUserCascade(ids.user);
    await deleteUserCascade(ids.other);
  });

  it("lists only non-expired sessions for the owner", async () => {
    const now = Date.now();
    const created = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    await orm.Session.create({
      id: ids.active,
      userId: ids.user,
      token: "active-token-secret",
      expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: created,
      updatedAt: created,
      ipAddress: "203.0.113.10",
      userAgent: "Mozilla/5.0 Test",
    });
    await orm.Session.create({
      id: ids.expired,
      userId: ids.user,
      token: "expired-token-secret",
      expiresAt: new Date(now - 60_000).toISOString(),
      createdAt: created,
      updatedAt: created,
    });
    await orm.Session.create({
      id: ids.otherSession,
      userId: ids.other,
      token: "other-token-secret",
      expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: created,
      updatedAt: created,
    });

    const listed = await authSessionRepository.listActiveByUserId(ids.user);
    expect(listed.map((session) => session.id)).toEqual([ids.active]);

    const owned = await authSessionRepository.findOwnedActiveById(ids.user, ids.active);
    expect(owned?.token).toBe("active-token-secret");

    const expired = await authSessionRepository.findOwnedActiveById(ids.user, ids.expired);
    expect(expired).toBeNull();

    const foreign = await authSessionRepository.findOwnedActiveById(ids.user, ids.otherSession);
    expect(foreign).toBeNull();
  });
});
