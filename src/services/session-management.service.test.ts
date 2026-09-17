import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { auth } from "@/auth/auth";
import { toPublicSessionView } from "@/auth/session-view";
import { orm } from "@/lib/prisma";
import { getDevAuthPassword, isDevAuthEnabled } from "@/auth/dev-auth";

const ids = {
  user: "bbbbbbbb-bbbb-4bbb-8bbb-auth00000001",
  other: "bbbbbbbb-bbbb-4bbb-8bbb-auth00000002",
};

function cookieFromSetCookie(setCookie: string | null): string {
  if (!setCookie) {
    throw new Error("Expected Set-Cookie from Better Auth sign-in");
  }
  // May be multiple cookies joined; take name=value pairs only.
  return setCookie
    .split(/,(?=\s*[^;=]+=[^;]+)/)
    .map((part) => part.trim().split(";")[0])
    .filter(Boolean)
    .join("; ");
}

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
    const accounts = await orm.Account.where({ userId }).all();
    for (const account of accounts) {
      await orm.Account.where({ id: account.id }).delete();
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

async function createCredentialUser(id: string, name: string) {
  const now = new Date().toISOString();
  const email = `${id}@authtest.boostting.local`;
  await orm.User.create({
    id,
    name,
    email,
    emailVerified: true,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
  await orm.Account.create({
    id: crypto.randomUUID(),
    accountId: id,
    providerId: "credential",
    userId: id,
    password: await hashPassword(getDevAuthPassword()),
    createdAt: now,
    updatedAt: now,
  });
  return email;
}

async function signInHeaders(email: string): Promise<Headers> {
  const result = await auth.api.signInEmail({
    body: {
      email,
      password: getDevAuthPassword(),
    },
    returnHeaders: true,
  });
  const setCookie = result.headers.get("set-cookie");
  return new Headers({
    cookie: cookieFromSetCookie(setCookie),
  });
}

describe("Better Auth session lifecycle (1.7.3 APIs)", () => {
  beforeAll(async () => {
    if (!isDevAuthEnabled()) {
      throw new Error("DEV_AUTH_ENABLED must be true for auth session integration tests");
    }
  });

  beforeEach(async () => {
    await deleteUserCascade(ids.user);
    await deleteUserCascade(ids.other);
  });

  afterAll(async () => {
    await deleteUserCascade(ids.user);
    await deleteUserCascade(ids.other);
  });

  it("lists, identifies, and revokes sessions without exposing tokens in public views", async () => {
    const email = await createCredentialUser(ids.user, "Auth Session User");

    const headersA = await signInHeaders(email);
    const headersB = await signInHeaders(email);

    const sessionA = await auth.api.getSession({ headers: headersA });
    const sessionB = await auth.api.getSession({ headers: headersB });
    expect(sessionA?.session.id).toBeTruthy();
    expect(sessionB?.session.id).toBeTruthy();
    expect(sessionA!.session.id).not.toBe(sessionB!.session.id);

    const listedFromB = await auth.api.listSessions({ headers: headersB });
    expect(listedFromB.length).toBeGreaterThanOrEqual(2);

    const publicViews = listedFromB.map((session) =>
      toPublicSessionView(session, sessionB!.session.id),
    );
    expect(publicViews.some((view) => view.isCurrent)).toBe(true);
    for (const view of publicViews) {
      expect(view).not.toHaveProperty("token");
      expect(JSON.stringify(view)).not.toMatch(/token/i);
    }

    const other = listedFromB.find((session) => session.id === sessionA!.session.id);
    expect(other).toBeTruthy();

    await auth.api.revokeSession({
      body: { token: other!.token },
      headers: headersB,
    });

    const afterRevokeA = await auth.api.getSession({ headers: headersA });
    expect(afterRevokeA).toBeNull();

    const stillB = await auth.api.getSession({ headers: headersB });
    expect(stillB?.session.id).toBe(sessionB!.session.id);

    await auth.api.revokeOtherSessions({ headers: headersB });
    const listedAfterOthers = await auth.api.listSessions({ headers: headersB });
    expect(listedAfterOthers).toHaveLength(1);
    expect(listedAfterOthers[0]?.id).toBe(sessionB!.session.id);

    await auth.api.revokeSessions({ headers: headersB });
    const afterAll = await auth.api.getSession({ headers: headersB });
    expect(afterAll).toBeNull();
  });

  it("does not allow a session cookie to list another user's sessions", async () => {
    const emailA = await createCredentialUser(ids.user, "Auth Owner");
    const emailB = await createCredentialUser(ids.other, "Auth Intruder");

    const headersA = await signInHeaders(emailA);
    const headersB = await signInHeaders(emailB);

    const listedB = await auth.api.listSessions({ headers: headersB });
    expect(listedB.every((session) => session.userId === ids.other)).toBe(true);
    expect(listedB.some((session) => session.userId === ids.user)).toBe(false);

    // Confirm owner still has their own session(s)
    const listedA = await auth.api.listSessions({ headers: headersA });
    expect(listedA.every((session) => session.userId === ids.user)).toBe(true);
  });
});
