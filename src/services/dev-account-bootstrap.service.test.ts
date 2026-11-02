import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orm } from "@/lib/prisma";
import { auth } from "@/auth/auth";
import type { AccountRole, AccountStatus } from "@/models/enums";
import {
  bootstrapDevelopmentAccount,
  bootstrapDevelopmentAccountOrThrow,
} from "@/services/dev-account-bootstrap.service";
import { assertIsolatedTestDatabase, createTestUser, deleteCreatedRows, syntheticDiscordId } from "@/test/db-fixtures";

/** Activity events go with the Users (none are expected). */
const created = { userIds: [] as string[] };

/** A fresh User with its own Discord id (globally unique); returns both. */
async function discordUser(options: { accountRole?: AccountRole; accountStatus?: AccountStatus; isBooster?: boolean } = {}) {
  const discordUserId = syntheticDiscordId();
  const id = await createTestUser({ name: "Bootstrap Test", discordUserId, ...options });
  created.userIds.push(id);
  return { id, discordUserId };
}

async function rawUser(id: string) {
  return (await orm.User.where({ id }).first()) as Record<string, unknown> | null;
}

async function activityCountFor(userId: string): Promise<number> {
  return (await orm.ActivityEvent.where({ userId }).all()).length;
}

/** Temporarily overrides env vars for the duration of `fn`, then restores them exactly. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const enabledFor = (discordUserId: string) => ({ DEV_ACCOUNT_BOOTSTRAP_ENABLED: "true", DEV_ADMIN_DISCORD_USER_ID: discordUserId });

/** Runs the bootstrap as the configured target and checks it wrote no activity. */
async function bootstrapTarget(target: { id: string; discordUserId: string }) {
  await withEnv(enabledFor(target.discordUserId), () => bootstrapDevelopmentAccount({ userId: target.id }));
  expect(await activityCountFor(target.id)).toBe(0);
  return rawUser(target.id);
}

async function expectUntouchedUser(id: string) {
  expect(await rawUser(id)).toMatchObject({ accountRole: "USER", accountStatus: "ACTIVE", isBooster: false });
  expect(await activityCountFor(id)).toBe(0);
}

beforeAll(() => {
  assertIsolatedTestDatabase();
});

afterAll(() => deleteCreatedRows(created));

describe("bootstrapDevelopmentAccount — gating", () => {
  it("is a no-op when disabled (0 writes)", async () => {
    const user = await discordUser();
    await withEnv({ DEV_ACCOUNT_BOOTSTRAP_ENABLED: undefined, DEV_ADMIN_DISCORD_USER_ID: user.discordUserId }, () =>
      bootstrapDevelopmentAccount({ userId: user.id }),
    );
    await expectUntouchedUser(user.id);
  });

  it("CRITICAL: is a hard no-op in production even with matching env and ID", async () => {
    const user = await discordUser();
    await withEnv({ ...enabledFor(user.discordUserId), NODE_ENV: "production" }, () =>
      bootstrapDevelopmentAccount({ userId: user.id }),
    );
    await expectUntouchedUser(user.id);
  });

  it("fails closed with a clear configuration error when enabled but the target ID is blank", async () => {
    const user = await discordUser();
    await withEnv({ DEV_ACCOUNT_BOOTSTRAP_ENABLED: "true", DEV_ADMIN_DISCORD_USER_ID: "" }, async () => {
      await expect(bootstrapDevelopmentAccountOrThrow({ userId: user.id })).rejects.toThrow(/DEV_ADMIN_DISCORD_USER_ID/);
      // The safe wrapper never lets that escape, and never elevates anyone.
      await expect(bootstrapDevelopmentAccount({ userId: user.id })).resolves.toBeUndefined();
    });
    await expectUntouchedUser(user.id);
  });

  it("leaves a non-matching Discord user completely untouched", async () => {
    const target = await discordUser();
    const other = await discordUser();
    await withEnv(enabledFor(target.discordUserId), () => bootstrapDevelopmentAccount({ userId: other.id }));
    await expectUntouchedUser(other.id);
  });
});

describe("bootstrapDevelopmentAccount — restoring the target account", () => {
  it("promotes a default USER/ACTIVE target to ADMIN/ACTIVE with the Booster role", async () => {
    // The Lootbuddy role is independent and never granted by the bootstrap.
    expect(await bootstrapTarget(await discordUser())).toMatchObject({
      accountRole: "ADMIN",
      accountStatus: "ACTIVE",
      isBooster: true,
      isLootbuddy: false,
    });
  });

  it("restores an ADMIN/DISABLED target to ADMIN/ACTIVE with the Booster role", async () => {
    const target = await discordUser({ accountRole: "ADMIN", accountStatus: "DISABLED" });
    expect(await bootstrapTarget(target)).toMatchObject({ accountRole: "ADMIN", accountStatus: "ACTIVE", isBooster: true });
  });

  it("promotes a RAID_LEAD/ACTIVE target to ADMIN/ACTIVE", async () => {
    const target = await discordUser({ accountRole: "RAID_LEAD" });
    expect(await bootstrapTarget(target)).toMatchObject({ accountRole: "ADMIN", accountStatus: "ACTIVE" });
  });

  it("still restores Admin authority for a target that already holds the Booster role", async () => {
    const target = await discordUser({ isBooster: true });
    expect(await bootstrapTarget(target)).toMatchObject({ accountRole: "ADMIN", isBooster: true });
  });

  it("re-grants the Booster role to a revoked target", async () => {
    // A revoked Booster: the flag is simply false again.
    const target = await discordUser({ isBooster: false });
    expect(await bootstrapTarget(target)).toMatchObject({ isBooster: true });
  });

  it("has zero drift across two consecutive calls on an already-fully-correct target", async () => {
    const target = await discordUser();
    const userBefore = await bootstrapTarget(target);
    const userAfter = await bootstrapTarget(target);
    expect(userAfter).toEqual(userBefore);
    expect(userAfter?.isBooster).toBe(true);
  });

  it("grants exactly the Booster role and never touches the Lootbuddy role", async () => {
    expect(await bootstrapTarget(await discordUser())).toMatchObject({ isBooster: true, isLootbuddy: false });
  });

  it("resolves two concurrent calls on a never-granted target without a thrown error", async () => {
    const target = await discordUser();
    await withEnv(enabledFor(target.discordUserId), () =>
      Promise.all([bootstrapDevelopmentAccount({ userId: target.id }), bootstrapDevelopmentAccount({ userId: target.id })]),
    );
    expect(await rawUser(target.id)).toMatchObject({ accountRole: "ADMIN", isBooster: true });
    expect(await activityCountFor(target.id)).toBe(0);
  });
});

describe("Better Auth wiring — databaseHooks.session.create.after", () => {
  const sessionCreated = () => auth.options.databaseHooks!.session!.create!.after!;
  const signIn = (userId: string) => sessionCreated()({ userId } as Parameters<ReturnType<typeof sessionCreated>>[0]);

  it("is wired as an async function on the configured auth instance", () => {
    expect(auth.options.databaseHooks?.session?.create?.after).toBeTypeOf("function");
  });

  it("invokes bootstrap for the matching discordUserId and skips a non-matching one, with no network calls", async () => {
    const target = await discordUser();
    const other = await discordUser();
    await withEnv(enabledFor(target.discordUserId), async () => {
      await signIn(target.id);
      await signIn(other.id);
    });
    expect(await rawUser(target.id)).toMatchObject({ accountRole: "ADMIN", accountStatus: "ACTIVE", isBooster: true });
    expect(await rawUser(other.id)).toMatchObject({ accountRole: "USER", isBooster: false });
  });

  it("first-sign-in semantics: a brand-new default User is promoted through the same integration boundary", async () => {
    const target = await discordUser();
    await withEnv(enabledFor(target.discordUserId), () => signIn(target.id));
    expect(await rawUser(target.id)).toMatchObject({ accountRole: "ADMIN", accountStatus: "ACTIVE", isBooster: true });
  });

  it("returning-sign-in semantics: an existing User whose privileges were reset is restored through the same integration boundary (no separate first-login path)", async () => {
    // Simulates a dev-seed wipe: an ADMIN reset back to defaults, Booster role revoked.
    const target = await discordUser({ accountRole: "ADMIN" });
    await orm.User.where({ id: target.id }).update({ accountRole: "USER", accountStatus: "ACTIVE", isBooster: false });
    expect((await rawUser(target.id))?.accountRole).toBe("USER");

    await withEnv(enabledFor(target.discordUserId), () => signIn(target.id));
    expect(await rawUser(target.id)).toMatchObject({ accountRole: "ADMIN", accountStatus: "ACTIVE", isBooster: true });
  });
});
