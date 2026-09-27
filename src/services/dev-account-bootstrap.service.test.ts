import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orm } from "@/lib/prisma";
import { auth } from "@/auth/auth";
import {
  bootstrapDevelopmentAccount,
  bootstrapDevelopmentAccountOrThrow,
} from "@/services/dev-account-bootstrap.service";

/** discordUserId is globally unique, so every test user needs its own. */
const USER_IDS = {
  disabledCase: "dab0000000000001",
  productionCase: "dab0000000000002",
  missingIdCase: "dab0000000000003",
  nonTarget: "dab0000000000004",
  defaultTarget: "dab0000000000005",
  adminDisabledTarget: "dab0000000000006",
  raidLeadTarget: "dab0000000000007",
  partialHeroicTarget: "dab0000000000008",
  revokedNormalTarget: "dab0000000000009",
  idempotentTarget: "dab000000000000a",
  exactSetTarget: "dab000000000000b",
  concurrentTarget: "dab000000000000c",
  authIntegrationTarget: "dab000000000000d",
  authIntegrationNonTarget: "dab000000000000e",
  firstSignInTarget: "dab000000000000f",
  returningSignInTarget: "dab000000000000g",
  noActivityTarget: "dab000000000000h",
} as const;

const ALL_USER_IDS = Object.values(USER_IDS);

const DISCORD_IDS: Record<string, string> = Object.fromEntries(
  Object.keys(USER_IDS).map((key, index) => [key, `9000000000000${String(index + 1).padStart(3, "0")}`]),
);

function discordIdFor(userKey: keyof typeof USER_IDS): string {
  return DISCORD_IDS[userKey]!;
}

async function createUser(input: {
  id: string;
  discordUserId: string | null;
  accountRole?: "USER" | "RAID_LEAD" | "ADMIN";
  accountStatus?: "ACTIVE" | "DISABLED";
}) {
  const now = new Date().toISOString();
  await orm.User.create({
    id: input.id,
    name: `Bootstrap Test ${input.id}`,
    email: `${input.id}@dabtest.boostting.local`,
    emailVerified: true,
    discordUserId: input.discordUserId,
    discordUsername: input.discordUserId ? `discord_${input.discordUserId}` : null,
    accountRole: input.accountRole ?? "USER",
    accountStatus: input.accountStatus ?? "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
}

/** The User's account-level Booster role (User.isBooster). */
async function isBooster(userId: string): Promise<boolean> {
  const row = await orm.User.where({ id: userId }).select("isBooster").first();
  return (row as { isBooster?: boolean } | null)?.isBooster === true;
}

async function rawUser(id: string) {
  return (await orm.User.where({ id }).first()) as Record<string, unknown> | null;
}

async function activityCountFor(userId: string): Promise<number> {
  const rows = await orm.ActivityEvent.where({ userId }).all();
  return rows.length;
}

async function cleanup() {
  for (const userId of ALL_USER_IDS) {
    const activity = await orm.ActivityEvent.where({ userId }).all();
    for (const row of activity) {
      await orm.ActivityEvent.where({ id: (row as Record<string, unknown>).id as string }).delete();
    }
  }
  for (const userId of ALL_USER_IDS) {
    try {
      await orm.User.where({ id: userId }).delete();
    } catch {
      // already gone
    }
  }
}

/** Temporarily overrides env vars for the duration of `fn`, then restores them exactly. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
  }
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

function enabledFor(userKey: keyof typeof USER_IDS) {
  return {
    DEV_ACCOUNT_BOOTSTRAP_ENABLED: "true",
    DEV_ADMIN_DISCORD_USER_ID: discordIdFor(userKey),
  };
}

beforeAll(async () => {
  await cleanup();
  await createUser({ id: USER_IDS.disabledCase, discordUserId: discordIdFor("disabledCase") });
  await createUser({ id: USER_IDS.productionCase, discordUserId: discordIdFor("productionCase") });
  await createUser({ id: USER_IDS.missingIdCase, discordUserId: discordIdFor("missingIdCase") });
  await createUser({ id: USER_IDS.nonTarget, discordUserId: discordIdFor("nonTarget") });
  await createUser({ id: USER_IDS.defaultTarget, discordUserId: discordIdFor("defaultTarget") });
  await createUser({
    id: USER_IDS.adminDisabledTarget,
    discordUserId: discordIdFor("adminDisabledTarget"),
    accountRole: "ADMIN",
    accountStatus: "DISABLED",
  });
  await createUser({
    id: USER_IDS.raidLeadTarget,
    discordUserId: discordIdFor("raidLeadTarget"),
    accountRole: "RAID_LEAD",
    accountStatus: "ACTIVE",
  });
  await createUser({ id: USER_IDS.partialHeroicTarget, discordUserId: discordIdFor("partialHeroicTarget") });
  await orm.User.where({ id: USER_IDS.partialHeroicTarget }).update({ isBooster: true });

  // A revoked Booster: the flag is simply false again.
  await createUser({ id: USER_IDS.revokedNormalTarget, discordUserId: discordIdFor("revokedNormalTarget") });

  await createUser({ id: USER_IDS.idempotentTarget, discordUserId: discordIdFor("idempotentTarget") });
  await createUser({ id: USER_IDS.exactSetTarget, discordUserId: discordIdFor("exactSetTarget") });
  await createUser({ id: USER_IDS.concurrentTarget, discordUserId: discordIdFor("concurrentTarget") });
  await createUser({ id: USER_IDS.authIntegrationTarget, discordUserId: discordIdFor("authIntegrationTarget") });
  await createUser({ id: USER_IDS.authIntegrationNonTarget, discordUserId: discordIdFor("authIntegrationNonTarget") });
  await createUser({ id: USER_IDS.firstSignInTarget, discordUserId: discordIdFor("firstSignInTarget") });
  await createUser({
    id: USER_IDS.returningSignInTarget,
    discordUserId: discordIdFor("returningSignInTarget"),
    accountRole: "ADMIN",
    accountStatus: "ACTIVE",
  });
  // Simulate a dev-seed wipe: privileges reset back to defaults, Booster role revoked.
  await orm.User.where({ id: USER_IDS.returningSignInTarget }).update({
    accountRole: "USER",
    accountStatus: "ACTIVE",
    isBooster: false,
  });

  await createUser({ id: USER_IDS.noActivityTarget, discordUserId: discordIdFor("noActivityTarget") });
});

afterAll(async () => {
  await cleanup();
});

describe("bootstrapDevelopmentAccount — gating", () => {
  it("is a no-op when disabled (0 writes)", async () => {
    await withEnv(
      { DEV_ACCOUNT_BOOTSTRAP_ENABLED: undefined, DEV_ADMIN_DISCORD_USER_ID: discordIdFor("disabledCase") },
      () => bootstrapDevelopmentAccount({ userId: USER_IDS.disabledCase }),
    );
    const user = await rawUser(USER_IDS.disabledCase);
    expect(user?.accountRole).toBe("USER");
    expect(user?.accountStatus).toBe("ACTIVE");
    expect(await isBooster(USER_IDS.disabledCase)).toBe(false);
  });

  it("CRITICAL: is a hard no-op in production even with matching env and ID", async () => {
    await withEnv(
      { ...enabledFor("productionCase"), NODE_ENV: "production" },
      () => bootstrapDevelopmentAccount({ userId: USER_IDS.productionCase }),
    );
    const user = await rawUser(USER_IDS.productionCase);
    expect(user?.accountRole).toBe("USER");
    expect(user?.accountStatus).toBe("ACTIVE");
    expect(await isBooster(USER_IDS.productionCase)).toBe(false);
  });

  it("fails closed with a clear configuration error when enabled but the target ID is blank", async () => {
    await withEnv(
      { DEV_ACCOUNT_BOOTSTRAP_ENABLED: "true", DEV_ADMIN_DISCORD_USER_ID: "" },
      async () => {
        await expect(
          bootstrapDevelopmentAccountOrThrow({ userId: USER_IDS.missingIdCase }),
        ).rejects.toThrow(/DEV_ADMIN_DISCORD_USER_ID/);
        // The safe wrapper never lets that escape, and never elevates anyone.
        await expect(
          bootstrapDevelopmentAccount({ userId: USER_IDS.missingIdCase }),
        ).resolves.toBeUndefined();
      },
    );
    const user = await rawUser(USER_IDS.missingIdCase);
    expect(user?.accountRole).toBe("USER");
    expect(await isBooster(USER_IDS.missingIdCase)).toBe(false);
  });

  it("leaves a non-matching Discord user completely untouched", async () => {
    await withEnv(
      { DEV_ACCOUNT_BOOTSTRAP_ENABLED: "true", DEV_ADMIN_DISCORD_USER_ID: discordIdFor("defaultTarget") },
      () => bootstrapDevelopmentAccount({ userId: USER_IDS.nonTarget }),
    );
    const user = await rawUser(USER_IDS.nonTarget);
    expect(user?.accountRole).toBe("USER");
    expect(user?.accountStatus).toBe("ACTIVE");
    expect(await isBooster(USER_IDS.nonTarget)).toBe(false);
    expect(await activityCountFor(USER_IDS.nonTarget)).toBe(0);
  });
});

describe("bootstrapDevelopmentAccount — restoring the target account", () => {
  it("promotes a default USER/ACTIVE target to ADMIN/ACTIVE with the Booster role", async () => {
    await withEnv(enabledFor("defaultTarget"), () => bootstrapDevelopmentAccount({ userId: USER_IDS.defaultTarget }));
    const user = await rawUser(USER_IDS.defaultTarget);
    expect(user?.accountRole).toBe("ADMIN");
    expect(user?.accountStatus).toBe("ACTIVE");
    expect(user?.isBooster).toBe(true);
    // The Lootbuddy role is independent and never granted by the bootstrap.
    expect(user?.isLootbuddy).toBe(false);
  });

  it("restores an ADMIN/DISABLED target to ADMIN/ACTIVE with the Booster role", async () => {
    await withEnv(enabledFor("adminDisabledTarget"), () =>
      bootstrapDevelopmentAccount({ userId: USER_IDS.adminDisabledTarget }),
    );
    const user = await rawUser(USER_IDS.adminDisabledTarget);
    expect(user?.accountRole).toBe("ADMIN");
    expect(user?.accountStatus).toBe("ACTIVE");
    expect(await isBooster(USER_IDS.adminDisabledTarget)).toBe(true);
  });

  it("promotes a RAID_LEAD/ACTIVE target to ADMIN/ACTIVE", async () => {
    await withEnv(enabledFor("raidLeadTarget"), () =>
      bootstrapDevelopmentAccount({ userId: USER_IDS.raidLeadTarget }),
    );
    const user = await rawUser(USER_IDS.raidLeadTarget);
    expect(user?.accountRole).toBe("ADMIN");
    expect(user?.accountStatus).toBe("ACTIVE");
  });

  it("still restores Admin authority for a target that already holds the Booster role", async () => {
    await withEnv(enabledFor("partialHeroicTarget"), () =>
      bootstrapDevelopmentAccount({ userId: USER_IDS.partialHeroicTarget }),
    );
    const user = await rawUser(USER_IDS.partialHeroicTarget);
    expect(user?.accountRole).toBe("ADMIN");
    expect(user?.isBooster).toBe(true);
  });

  it("re-grants the Booster role to a revoked target", async () => {
    expect(await isBooster(USER_IDS.revokedNormalTarget)).toBe(false);
    await withEnv(enabledFor("revokedNormalTarget"), () =>
      bootstrapDevelopmentAccount({ userId: USER_IDS.revokedNormalTarget }),
    );
    expect(await isBooster(USER_IDS.revokedNormalTarget)).toBe(true);
  });

  it("has zero drift across two consecutive calls on an already-fully-correct target", async () => {
    await withEnv(enabledFor("idempotentTarget"), () =>
      bootstrapDevelopmentAccount({ userId: USER_IDS.idempotentTarget }),
    );
    const userBefore = await rawUser(USER_IDS.idempotentTarget);

    await withEnv(enabledFor("idempotentTarget"), () =>
      bootstrapDevelopmentAccount({ userId: USER_IDS.idempotentTarget }),
    );
    const userAfter = await rawUser(USER_IDS.idempotentTarget);

    expect(userAfter).toEqual(userBefore);
    expect(userAfter?.isBooster).toBe(true);
  });

  it("grants exactly the Booster role and never touches the Lootbuddy role", async () => {
    await withEnv(enabledFor("exactSetTarget"), () =>
      bootstrapDevelopmentAccount({ userId: USER_IDS.exactSetTarget }),
    );
    const user = await rawUser(USER_IDS.exactSetTarget);
    expect(user?.isBooster).toBe(true);
    expect(user?.isLootbuddy).toBe(false);
  });

  it("resolves two concurrent calls on a never-granted target without a thrown error", async () => {
    await withEnv(enabledFor("concurrentTarget"), () =>
      Promise.all([
        bootstrapDevelopmentAccount({ userId: USER_IDS.concurrentTarget }),
        bootstrapDevelopmentAccount({ userId: USER_IDS.concurrentTarget }),
      ]),
    );
    const user = await rawUser(USER_IDS.concurrentTarget);
    expect(user?.accountRole).toBe("ADMIN");
    expect(await isBooster(USER_IDS.concurrentTarget)).toBe(true);
    expect(await activityCountFor(USER_IDS.concurrentTarget)).toBe(0);
  });

  it("never creates an ActivityEvent across any mutation scenario above", async () => {
    await withEnv(enabledFor("noActivityTarget"), () =>
      bootstrapDevelopmentAccount({ userId: USER_IDS.noActivityTarget }),
    );
    expect(await activityCountFor(USER_IDS.noActivityTarget)).toBe(0);
    for (const userId of [
      USER_IDS.defaultTarget,
      USER_IDS.adminDisabledTarget,
      USER_IDS.raidLeadTarget,
      USER_IDS.partialHeroicTarget,
      USER_IDS.revokedNormalTarget,
      USER_IDS.idempotentTarget,
      USER_IDS.exactSetTarget,
    ]) {
      expect(await activityCountFor(userId)).toBe(0);
    }
  });
});

describe("Better Auth wiring — databaseHooks.session.create.after", () => {
  it("is wired as an async function on the configured auth instance", () => {
    expect(auth.options.databaseHooks?.session?.create?.after).toBeTypeOf("function");
  });

  it("invokes bootstrap for the matching discordUserId and skips a non-matching one, with no network calls", async () => {
    const after = auth.options.databaseHooks!.session!.create!.after!;
    await withEnv(enabledFor("authIntegrationTarget"), async () => {
      await after({ userId: USER_IDS.authIntegrationTarget } as Parameters<typeof after>[0]);
      await after({ userId: USER_IDS.authIntegrationNonTarget } as Parameters<typeof after>[0]);
    });

    const target = await rawUser(USER_IDS.authIntegrationTarget);
    expect(target?.accountRole).toBe("ADMIN");
    expect(target?.accountStatus).toBe("ACTIVE");
    expect(await isBooster(USER_IDS.authIntegrationTarget)).toBe(true);

    const nonTarget = await rawUser(USER_IDS.authIntegrationNonTarget);
    expect(nonTarget?.accountRole).toBe("USER");
    expect(await isBooster(USER_IDS.authIntegrationNonTarget)).toBe(false);
  });

  it("first-sign-in semantics: a brand-new default User is promoted through the same integration boundary", async () => {
    const after = auth.options.databaseHooks!.session!.create!.after!;
    await withEnv(enabledFor("firstSignInTarget"), () =>
      after({ userId: USER_IDS.firstSignInTarget } as Parameters<typeof after>[0]),
    );
    const user = await rawUser(USER_IDS.firstSignInTarget);
    expect(user?.accountRole).toBe("ADMIN");
    expect(user?.accountStatus).toBe("ACTIVE");
    expect(await isBooster(USER_IDS.firstSignInTarget)).toBe(true);
  });

  it("returning-sign-in semantics: an existing User whose privileges were reset is restored through the same integration boundary (no separate first-login path)", async () => {
    const before = await rawUser(USER_IDS.returningSignInTarget);
    expect(before?.accountRole).toBe("USER");

    const after = auth.options.databaseHooks!.session!.create!.after!;
    await withEnv(enabledFor("returningSignInTarget"), () =>
      after({ userId: USER_IDS.returningSignInTarget } as Parameters<typeof after>[0]),
    );

    const user = await rawUser(USER_IDS.returningSignInTarget);
    expect(user?.accountRole).toBe("ADMIN");
    expect(user?.accountStatus).toBe("ACTIVE");
    expect(await isBooster(USER_IDS.returningSignInTarget)).toBe(true);
  });
});
