import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { MANAFORGE_OMEGA_RAID_ID, VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { runDiscordPostRepository } from "@/repositories/run-discord-post.repository";
import { runRepository } from "@/repositories/run.repository";
import { runService } from "@/services/run.service";
import { runTemplateService } from "@/services/run-template.service";
import { createManyRunsSchema, type CreateManyRunsInput } from "@/validators/mass-create-runs";

const raidId = VENOMOUS_ABYSS_RAID_ID;
const ids = {
  user: "aaaaaaaa-aaaa-4aaa-8aaa-mc0000000001",
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-mc0000000002",
  otherLead: "aaaaaaaa-aaaa-4aaa-8aaa-mc0000000003",
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-mc0000000004",
  disabledLead: "aaaaaaaa-aaaa-4aaa-8aaa-mc0000000005",
};

const createdRunIds: string[] = [];
const createdTemplateIds: string[] = [];

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
  accountStatus: AuthenticatedUser["accountStatus"] = "ACTIVE",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@mctest.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus,
  };
}

async function expectDomainCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected domain error ${code}`);
  } catch (error) {
    if (error instanceof Error && error.message === `Expected domain error ${code}`) {
      throw error;
    }
    expect(isDomainError(error) && error.code).toBe(code);
  }
}

async function createTestUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"],
  accountStatus: AuthenticatedUser["accountStatus"] = "ACTIVE",
) {
  await orm.User.create({
    id,
    name,
    email: `${id}@mctest.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function deleteIfPresent(table: "User" | "Run", id: string) {
  try {
    if (table === "User") await orm.User.where({ id }).delete();
    else await orm.Run.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

function futureIso(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

const user = asUser(ids.user, "MassCreate User");
const lead = asUser(ids.lead, "MassCreate Lead", "RAID_LEAD");
const admin = asUser(ids.admin, "MassCreate Admin", "ADMIN");

function defaultsFor(overrides: Partial<CreateManyRunsInput["defaults"]> = {}): CreateManyRunsInput["defaults"] {
  return {
    raidId,
    difficulty: "HEROIC",
    lootType: "UNSAVED",
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    plannedBossCount: 8,
    ...overrides,
  };
}

function rowsOf(count: number, startDay = 7): CreateManyRunsInput["runs"] {
  return Array.from({ length: count }, (_, index) => ({
    scheduledStartAt: futureIso(startDay + index),
  }));
}

async function countBatchRuns(runIds: string[]): Promise<number> {
  if (runIds.length === 0) return 0;
  const rows = await orm.Run.where((run) => run.id.in(runIds)).select("id").all();
  return rows.length;
}

async function countRostersForRuns(runIds: string[]): Promise<number> {
  if (runIds.length === 0) return 0;
  const rows = await orm.RunRoster.where((roster) => roster.runId.in(runIds)).select("id").all();
  return rows.length;
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const id of [ids.user, ids.lead, ids.otherLead, ids.admin, ids.disabledLead]) {
    await deleteIfPresent("User", id);
  }
  await createTestUser(ids.user, "MassCreate User", "USER");
  await createTestUser(ids.lead, "MassCreate Lead", "RAID_LEAD");
  await createTestUser(ids.otherLead, "MassCreate Other Lead", "RAID_LEAD");
  await createTestUser(ids.admin, "MassCreate Admin", "ADMIN");
  await createTestUser(ids.disabledLead, "MassCreate Disabled Lead", "RAID_LEAD", "DISABLED");
});

afterAll(async () => {
  for (const id of createdRunIds) {
    await deleteIfPresent("Run", id);
  }
  for (const id of createdTemplateIds) {
    try {
      await orm.RunTemplate.where({ id }).delete();
    } catch {
      // Already gone.
    }
  }
  for (const id of [ids.user, ids.lead, ids.otherLead, ids.admin, ids.disabledLead]) {
    await deleteIfPresent("User", id);
  }
});

afterEach(async () => {
  // Sweep anything the current test created but didn't itself track, so a
  // rejected batch never leaks rows into the next test's assertions.
  const stray = await orm.Run.where({ raidLeadId: ids.lead }).select("id").all();
  for (const row of stray) {
    const id = String((row as { id: string }).id);
    if (!createdRunIds.includes(id)) {
      await deleteIfPresent("Run", id);
    }
  }
});

describe("runService.createManyRuns — authorization", () => {
  it("A: USER is forbidden, and no Run is created", async () => {
    const before = await orm.Run.where({ raidLeadId: ids.user }).select("id").all();
    await expectDomainCode(
      runService.createManyRuns(user, { defaults: defaultsFor(), runs: rowsOf(1) }),
      "NOT_AUTHORIZED",
    );
    const after = await orm.Run.where({ raidLeadId: ids.user }).select("id").all();
    expect(after.length).toBe(before.length);
  });

  it("B: RAID_LEAD is allowed", async () => {
    const result = await runService.createManyRuns(lead, { defaults: defaultsFor(), runs: rowsOf(2) });
    createdRunIds.push(...result.ids);
    expect(result.ids).toHaveLength(2);
  });

  it("C: ADMIN is allowed", async () => {
    const result = await runService.createManyRuns(admin, {
      defaults: defaultsFor({ raidLeadId: ids.lead }),
      runs: rowsOf(2, 30),
    });
    createdRunIds.push(...result.ids);
    expect(result.ids).toHaveLength(2);
  });
});

describe("runService.createManyRuns — batch size", () => {
  it("0 rows is a structural validation failure at the Zod boundary (not reached by the Service in this test, but the schema itself rejects)", () => {
    const result = createManyRunsSchema.safeParse({ defaults: defaultsFor(), runs: [] });
    expect(result.success).toBe(false);
  });

  it("1 row succeeds", async () => {
    const result = await runService.createManyRuns(lead, { defaults: defaultsFor(), runs: rowsOf(1, 60) });
    createdRunIds.push(...result.ids);
    expect(result.ids).toHaveLength(1);
  });

  it("25 rows succeeds", async () => {
    const result = await runService.createManyRuns(lead, { defaults: defaultsFor(), runs: rowsOf(25, 100) });
    createdRunIds.push(...result.ids);
    expect(result.ids).toHaveLength(25);
  });

  it("26 rows is rejected structurally, with 0 runs created", async () => {
    const before = await orm.Run.where({ raidLeadId: ids.lead }).select("id").all();
    const parsed = createManyRunsSchema.safeParse({ defaults: defaultsFor(), runs: rowsOf(26, 200) });
    expect(parsed.success).toBe(false);
    const after = await orm.Run.where({ raidLeadId: ids.lead }).select("id").all();
    expect(after.length).toBe(before.length);
  });
});

describe("runService.createManyRuns — raid lead authority", () => {
  it("RAID_LEAD forging another manager's id via defaults is rejected, 0 Runs created", async () => {
    const before = await orm.Run.where({ raidLeadId: ids.otherLead }).select("id").all();
    await expectDomainCode(
      runService.createManyRuns(lead, {
        defaults: defaultsFor({ raidLeadId: ids.otherLead }),
        runs: rowsOf(2, 300),
      }),
      "RUN_RAID_LEAD_INVALID",
    );
    const after = await orm.Run.where({ raidLeadId: ids.otherLead }).select("id").all();
    expect(after.length).toBe(before.length);
  });

  it("RAID_LEAD forging another manager's id via a row override is rejected, 0 Runs created", async () => {
    await expectDomainCode(
      runService.createManyRuns(lead, {
        defaults: defaultsFor(),
        runs: [
          { scheduledStartAt: futureIso(310) },
          { scheduledStartAt: futureIso(311), overrides: { raidLeadId: ids.otherLead } },
        ],
      }),
      "RUN_RAID_LEAD_INVALID",
    );
    const leaked = await orm.Run.where({ scheduledStartAt: futureIso(310) }).select("id").all();
    expect(leaked).toHaveLength(0);
  });

  it("ADMIN assigning a valid eligible raid lead succeeds", async () => {
    const result = await runService.createManyRuns(admin, {
      defaults: defaultsFor({ raidLeadId: ids.lead }),
      runs: rowsOf(1, 320),
    });
    createdRunIds.push(...result.ids);
    const run = await runRepository.findById(result.ids[0]!);
    expect(run?.raidLeadId).toBe(ids.lead);
  });

  it("ADMIN assigning a disabled (non-eligible) raid lead rejects the entire batch", async () => {
    await expectDomainCode(
      runService.createManyRuns(admin, {
        defaults: defaultsFor({ raidLeadId: ids.lead }),
        runs: [
          { scheduledStartAt: futureIso(330) },
          { scheduledStartAt: futureIso(331), overrides: { raidLeadId: ids.disabledLead } },
        ],
      }),
      "RUN_RAID_LEAD_INVALID",
    );
    const leaked = await orm.Run.where({ scheduledStartAt: futureIso(330) }).select("id").all();
    expect(leaked).toHaveLength(0);
  });
});

describe("runService.createManyRuns — raid availability", () => {
  it("a historical raid anywhere in the batch (default) rejects everything, with row context", async () => {
    try {
      await runService.createManyRuns(lead, {
        defaults: defaultsFor({ raidId: MANAFORGE_OMEGA_RAID_ID }),
        runs: rowsOf(3, 400),
      });
      expect.unreachable();
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe("RAID_NOT_AVAILABLE_FOR_RUNS");
      expect(isDomainError(error) && error.message).toMatch(/^Run 1:/);
    }
    const leaked = await orm.Run.where({ scheduledStartAt: futureIso(400) }).select("id").all();
    expect(leaked).toHaveLength(0);
  });

  it("a historical raid via row override (row 2 of 3) rejects the whole batch, with that row's number in the message", async () => {
    try {
      await runService.createManyRuns(lead, {
        defaults: defaultsFor(),
        runs: [
          { scheduledStartAt: futureIso(410) },
          { scheduledStartAt: futureIso(411), overrides: { raidId: MANAFORGE_OMEGA_RAID_ID } },
          { scheduledStartAt: futureIso(412) },
        ],
      });
      expect.unreachable();
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe("RAID_NOT_AVAILABLE_FOR_RUNS");
      expect(isDomainError(error) && error.message).toMatch(/^Run 2:/);
    }
    const leaked = await orm.Run.where({ scheduledStartAt: futureIso(410) }).select("id").all();
    expect(leaked).toHaveLength(0);
    const leaked3 = await orm.Run.where({ scheduledStartAt: futureIso(412) }).select("id").all();
    expect(leaked3).toHaveLength(0);
  });
});

describe("runService.createManyRuns — schedule rules", () => {
  it("one invalid timestamp rejects the whole batch, no partial writes", async () => {
    await expectDomainCode(
      runService.createManyRuns(lead, {
        defaults: defaultsFor(),
        runs: [{ scheduledStartAt: futureIso(420) }, { scheduledStartAt: "not-a-real-date" }],
      }),
      "RUN_SCHEDULE_INVALID",
    );
    const leaked = await orm.Run.where({ scheduledStartAt: futureIso(420) }).select("id").all();
    expect(leaked).toHaveLength(0);
  });

  it("one materially-past row rejects the whole batch, no partial writes", async () => {
    const pastIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await expectDomainCode(
      runService.createManyRuns(lead, {
        defaults: defaultsFor(),
        runs: [{ scheduledStartAt: futureIso(430) }, { scheduledStartAt: pastIso }],
      }),
      "RUN_SCHEDULE_INVALID",
    );
    const leaked = await orm.Run.where({ scheduledStartAt: futureIso(430) }).select("id").all();
    expect(leaked).toHaveLength(0);
  });
});

describe("runService.createManyRuns — loot type rules", () => {
  it("an invalid difficulty+lootType combination in one row rejects the whole batch", async () => {
    await expectDomainCode(
      runService.createManyRuns(lead, {
        defaults: defaultsFor(),
        runs: [
          { scheduledStartAt: futureIso(440) },
          { scheduledStartAt: futureIso(441), overrides: { difficulty: "MYTHIC", lootType: "SAVED" } },
        ],
      }),
      "RUN_LOOT_TYPE_INVALID",
    );
    const leaked = await orm.Run.where({ scheduledStartAt: futureIso(440) }).select("id").all();
    expect(leaked).toHaveLength(0);
  });
});

describe("runService.createManyRuns — boss count rules", () => {
  it("plannedBossCount exceeding the effective raid's total rejects the whole batch", async () => {
    await expectDomainCode(
      runService.createManyRuns(lead, {
        defaults: defaultsFor(),
        runs: [
          { scheduledStartAt: futureIso(450) },
          { scheduledStartAt: futureIso(451), overrides: { plannedBossCount: 999 } },
        ],
      }),
      "RUN_BOSS_COUNT_INVALID",
    );
    const leaked = await orm.Run.where({ scheduledStartAt: futureIso(450) }).select("id").all();
    expect(leaked).toHaveLength(0);
  });

  it("boss count validation uses the ROW's overridden raid, not the shared default raid", async () => {
    // Venomous Abyss has 8 bosses (see wow-raid-catalog.ts). A row overriding
    // to the historical Manaforge raid would fail availability first — so to
    // isolate the "validate against the row's own raid" rule, use the same
    // (only available) raid explicitly on the row and prove a boss count
    // valid for it, but which would exceed a deliberately-wrong shared
    // default, is still accepted (i.e. it is NOT validated against some
    // other stale total).
    const raid = await raidRepository.findById(raidId);
    const result = await runService.createManyRuns(lead, {
      defaults: defaultsFor({ plannedBossCount: 1 }),
      runs: [{ scheduledStartAt: futureIso(460), overrides: { raidId, plannedBossCount: raid!.totalBossCount } }],
    });
    createdRunIds.push(...result.ids);
    const run = await runRepository.findById(result.ids[0]!);
    expect(run?.plannedBossCount).toBe(raid!.totalBossCount);
  });
});

describe("runService.createManyRuns — composition rules", () => {
  it("a negative composition count in one row rejects the whole batch", async () => {
    await expectDomainCode(
      runService.createManyRuns(lead, {
        defaults: defaultsFor(),
        runs: [
          { scheduledStartAt: futureIso(470) },
          { scheduledStartAt: futureIso(471), overrides: { desiredTankCount: -1 } },
        ],
      }),
      "VALIDATION_FAILED",
    );
    const leaked = await orm.Run.where({ scheduledStartAt: futureIso(470) }).select("id").all();
    expect(leaked).toHaveLength(0);
  });

  it("an out-of-range composition count in one row rejects the whole batch", async () => {
    await expectDomainCode(
      runService.createManyRuns(lead, {
        defaults: defaultsFor(),
        runs: [
          { scheduledStartAt: futureIso(480) },
          { scheduledStartAt: futureIso(481), overrides: { desiredHealerCount: 999 } },
        ],
      }),
      "VALIDATION_FAILED",
    );
    const leaked = await orm.Run.where({ scheduledStartAt: futureIso(480) }).select("id").all();
    expect(leaked).toHaveLength(0);
  });
});

describe("runService.createManyRuns — notes override semantics", () => {
  it("no override inherits shared notes; a string override replaces them; an explicit null clears them", async () => {
    const result = await runService.createManyRuns(lead, {
      defaults: defaultsFor({ notes: "Bring buyers" }),
      runs: [
        { scheduledStartAt: futureIso(490) },
        { scheduledStartAt: futureIso(491), overrides: { notes: "VIP setup" } },
        { scheduledStartAt: futureIso(492), overrides: { notes: null } },
      ],
    });
    createdRunIds.push(...result.ids);

    const [inherited, overridden, cleared] = await Promise.all(result.ids.map((id) => runRepository.findById(id)));
    expect(inherited?.notes).toBe("Bring buyers");
    expect(overridden?.notes).toBe("VIP setup");
    expect(cleared?.notes).toBeNull();
  });
});

describe("runService.createManyRuns — title derivation", () => {
  it("every row's title is server-derived from its own effective fields via buildRunTitle", async () => {
    const result = await runService.createManyRuns(lead, {
      defaults: defaultsFor(),
      runs: [
        { scheduledStartAt: futureIso(500) },
        { scheduledStartAt: futureIso(501), overrides: { difficulty: "MYTHIC", lootType: "VIP", plannedBossCount: 3 } },
      ],
    });
    createdRunIds.push(...result.ids);

    const [a, b] = await Promise.all(result.ids.map((id) => runRepository.findById(id)));
    expect(a?.title).toContain("HC");
    expect(a?.title).toContain("Unsaved");
    expect(a?.title).toContain("8/8");
    expect(b?.title).toContain("MY");
    expect(b?.title).toContain("VIP");
    expect(b?.title).toContain("3/8");
  });
});

describe("runService.createManyRuns — DRAFT state", () => {
  it("every created run is DRAFT, signups closed, not archived", async () => {
    const result = await runService.createManyRuns(lead, { defaults: defaultsFor(), runs: rowsOf(3, 510) });
    createdRunIds.push(...result.ids);

    const runs = await Promise.all(result.ids.map((id) => runRepository.findById(id)));
    for (const run of runs) {
      expect(run?.status).toBe("DRAFT");
      expect(run?.signupsOpen).toBe(false);
      expect(run?.archivedAt).toBeNull();
    }
  });
});

describe("runService.createManyRuns — initial rosters", () => {
  it("a successful 5-row batch creates exactly 5 Runs and 5 initial RunRoster rows, no entries", async () => {
    const result = await runService.createManyRuns(lead, { defaults: defaultsFor(), runs: rowsOf(5, 520) });
    createdRunIds.push(...result.ids);

    expect(await countBatchRuns(result.ids)).toBe(5);
    expect(await countRostersForRuns(result.ids)).toBe(5);

    for (const id of result.ids) {
      const roster = await orm.RunRoster.where({ runId: id }).first();
      expect(roster).toBeTruthy();
      expect((roster as { version: number } | undefined)?.version).toBe(1);
      const entries = await orm.RunRosterEntry.where({ rosterId: String((roster as { id: string }).id) }).select("id").all();
      expect(entries).toHaveLength(0);
    }
  });
});

describe("runService.createManyRuns — no Discord state", () => {
  it("no RunDiscordPost exists for any freshly mass-created Run", async () => {
    const result = await runService.createManyRuns(lead, { defaults: defaultsFor(), runs: rowsOf(2, 530) });
    createdRunIds.push(...result.ids);

    for (const id of result.ids) {
      expect(await runDiscordPostRepository.findByRunId(id)).toBeNull();
    }
  });
});

describe("runService.createManyRuns — single vs one-row bulk equivalence", () => {
  it("a one-row Mass Create batch produces the same authoritative planning state as single createRun for the same effective input", async () => {
    const scheduledStartAt = futureIso(540);
    const single = await runService.createRun(lead, {
      raidId,
      difficulty: "HEROIC",
      lootType: "VIP",
      scheduledStartAt,
      plannedBossCount: 6,
      desiredTankCount: 3,
      desiredHealerCount: 5,
      desiredDpsCount: 12,
      notes: "Parity check",
    });
    createdRunIds.push(single.id);

    const bulk = await runService.createManyRuns(lead, {
      defaults: defaultsFor({
        lootType: "VIP",
        plannedBossCount: 6,
        desiredTankCount: 3,
        desiredHealerCount: 5,
        desiredDpsCount: 12,
        notes: "Parity check",
      }),
      runs: [{ scheduledStartAt }],
    });
    createdRunIds.push(...bulk.ids);

    const singleRun = await runRepository.findById(single.id);
    const bulkRun = await runRepository.findById(bulk.ids[0]!);

    expect(bulkRun?.title).toBe(singleRun?.title);
    expect(bulkRun?.raidId).toBe(singleRun?.raidId);
    expect(bulkRun?.difficulty).toBe(singleRun?.difficulty);
    expect(bulkRun?.lootType).toBe(singleRun?.lootType);
    expect(bulkRun?.scheduledStartAt).toBe(singleRun?.scheduledStartAt);
    expect(bulkRun?.raidLeadId).toBe(singleRun?.raidLeadId);
    expect(bulkRun?.notes).toBe(singleRun?.notes);
    expect(bulkRun?.desiredTankCount).toBe(singleRun?.desiredTankCount);
    expect(bulkRun?.desiredHealerCount).toBe(singleRun?.desiredHealerCount);
    expect(bulkRun?.desiredDpsCount).toBe(singleRun?.desiredDpsCount);
    expect(bulkRun?.plannedBossCount).toBe(singleRun?.plannedBossCount);
    expect(bulkRun?.status).toBe(singleRun?.status);
    expect(bulkRun?.signupsOpen).toBe(singleRun?.signupsOpen);
  });
});

describe("runService.createManyRuns — input order preserved", () => {
  it("returned ids correspond to the submitted row order, not any DB sort order", async () => {
    const schedules = [futureIso(600), futureIso(560), futureIso(580)]; // deliberately unsorted
    const result = await runService.createManyRuns(lead, {
      defaults: defaultsFor(),
      runs: schedules.map((scheduledStartAt) => ({ scheduledStartAt })),
    });
    createdRunIds.push(...result.ids);

    const runs = await Promise.all(result.ids.map((id) => runRepository.findById(id)));
    // Compared as parsed timestamps, never as raw strings — the driver
    // round-trips TimestamptzString in Postgres's own text format, not the
    // "...T...Z" ISO shape schedules[] was built from.
    expect(runs.map((run) => new Date(run!.scheduledStartAt).getTime())).toEqual(
      schedules.map((s) => new Date(s).getTime()),
    );
  });
});

describe("runRepository.createManyDraftsAtomic — atomic rollback", () => {
  it("a failure partway through the batch rolls back every row — 0 new Runs, 0 new rosters", async () => {
    const raid = await raidRepository.findById(raidId);
    const goodInput = {
      title: "Atomicity fixture (should not survive)",
      raidId,
      difficulty: "HEROIC" as const,
      lootType: "UNSAVED" as const,
      scheduledStartAt: futureIso(700),
      raidLeadId: ids.lead,
      notes: null,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      plannedBossCount: raid!.totalBossCount,
    };
    // A nonexistent raidId violates the Run.raidId foreign key at the DB
    // level on the SECOND insert, after the first would otherwise have
    // already written successfully — proving the whole transaction, not
    // just Service-level pre-validation, rolls back.
    const badInput = { ...goodInput, raidId: crypto.randomUUID(), scheduledStartAt: futureIso(701) };

    await expect(runRepository.createManyDraftsAtomic([goodInput, badInput])).rejects.toThrow();

    const leakedGood = await orm.Run.where({ scheduledStartAt: futureIso(700) }).select("id").all();
    const leakedBad = await orm.Run.where({ scheduledStartAt: futureIso(701) }).select("id").all();
    expect(leakedGood).toHaveLength(0);
    expect(leakedBad).toHaveLength(0);
  });
});

describe("runService.createManyRuns — templateId integration", () => {
  it("RAID_LEAD applying their own template creates Runs whose raidLeadId is the template owner", async () => {
    const template = await runTemplateService.createTemplate(lead, {
      name: "Integration Own Template",
      raidId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      notes: "Template notes",
    });
    createdTemplateIds.push(template.id);

    // The Server only derives raidLeadId from the template — copying the
    // other planning values (notes, composition, etc.) into Shared Defaults
    // is the client's job when it applies a template. Simulate that here by
    // passing them through defaults, exactly as the real form would submit.
    const result = await runService.createManyRuns(lead, {
      defaults: defaultsFor({ notes: "Template notes" }),
      runs: rowsOf(1, 800),
      templateId: template.id,
    });
    createdRunIds.push(...result.ids);

    const run = await runRepository.findById(result.ids[0]!);
    expect(run?.raidLeadId).toBe(ids.lead);
    expect(run?.notes).toBe("Template notes");
  });

  it("ADMIN applying another raid lead's template creates Runs owned by that raid lead, not the ADMIN", async () => {
    const template = await runTemplateService.createTemplate(admin, {
      name: "Integration Admin-Applied Template",
      raidId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      notes: null,
      raidLeadId: ids.otherLead,
    });
    createdTemplateIds.push(template.id);

    const result = await runService.createManyRuns(admin, {
      defaults: defaultsFor(),
      runs: rowsOf(1, 810),
      templateId: template.id,
    });
    createdRunIds.push(...result.ids);

    const run = await runRepository.findById(result.ids[0]!);
    expect(run?.raidLeadId).toBe(ids.otherLead);
  });

  it("RAID_LEAD attempting to use another raid lead's template is rejected, 0 Runs created", async () => {
    const template = await runTemplateService.createTemplate(admin, {
      name: "Integration Forbidden Template",
      raidId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      notes: null,
      raidLeadId: ids.otherLead,
    });
    createdTemplateIds.push(template.id);

    await expectDomainCode(
      runService.createManyRuns(lead, { defaults: defaultsFor(), runs: rowsOf(1, 820), templateId: template.id }),
      "NOT_AUTHORIZED",
    );
    const leaked = await orm.Run.where({ scheduledStartAt: futureIso(820) }).select("id").all();
    expect(leaked).toHaveLength(0);
  });

  it("a forged raidLeadId in defaults while a template is selected rejects the entire batch, 0 Runs created", async () => {
    const template = await runTemplateService.createTemplate(lead, {
      name: "Integration Defaults Mismatch",
      raidId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      notes: null,
    });
    createdTemplateIds.push(template.id);

    await expectDomainCode(
      runService.createManyRuns(admin, {
        defaults: defaultsFor({ raidLeadId: ids.otherLead }),
        runs: rowsOf(2, 830),
        templateId: template.id,
      }),
      "RUN_TEMPLATE_RAID_LEAD_MISMATCH",
    );
    const leaked = await orm.Run.where({ scheduledStartAt: futureIso(830) }).select("id").all();
    expect(leaked).toHaveLength(0);
  });

  it("a forged raidLeadId via a row override while a template is selected rejects the entire batch, 0 Runs created", async () => {
    const template = await runTemplateService.createTemplate(lead, {
      name: "Integration Row Mismatch",
      raidId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      notes: null,
    });
    createdTemplateIds.push(template.id);

    await expectDomainCode(
      runService.createManyRuns(lead, {
        defaults: defaultsFor(),
        runs: [
          { scheduledStartAt: futureIso(840) },
          { scheduledStartAt: futureIso(841), overrides: { raidLeadId: ids.otherLead } },
        ],
        templateId: template.id,
      }),
      "RUN_TEMPLATE_RAID_LEAD_MISMATCH",
    );
    const leaked = await orm.Run.where({ scheduledStartAt: futureIso(840) }).select("id").all();
    expect(leaked).toHaveLength(0);
  });

  it("using an inactive template is rejected before any row is prepared, 0 Runs created", async () => {
    const template = await runTemplateService.createTemplate(lead, {
      name: "Integration Inactive Template",
      raidId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      notes: null,
    });
    createdTemplateIds.push(template.id);
    await runTemplateService.deactivate(lead, template.id);

    await expectDomainCode(
      runService.createManyRuns(lead, { defaults: defaultsFor(), runs: rowsOf(1, 850), templateId: template.id }),
      "RUN_TEMPLATE_UNUSABLE",
    );
    const leaked = await orm.Run.where({ scheduledStartAt: futureIso(850) }).select("id").all();
    expect(leaked).toHaveLength(0);
  });

  it("a row may still override other template-derived values while the raid lead stays the template owner", async () => {
    const template = await runTemplateService.createTemplate(lead, {
      name: "Integration Row Override",
      raidId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      notes: "Shared template notes",
    });
    createdTemplateIds.push(template.id);

    const result = await runService.createManyRuns(lead, {
      defaults: defaultsFor(),
      runs: [{ scheduledStartAt: futureIso(860), overrides: { notes: "Row-specific notes", desiredTankCount: 3 } }],
      templateId: template.id,
    });
    createdRunIds.push(...result.ids);

    const run = await runRepository.findById(result.ids[0]!);
    expect(run?.raidLeadId).toBe(ids.lead);
    expect(run?.notes).toBe("Row-specific notes");
    expect(run?.desiredTankCount).toBe(3);
  });

  it("a multi-row batch via a template shares the template's raid lead across every row, atomically", async () => {
    const template = await runTemplateService.createTemplate(lead, {
      name: "Integration Multi-Row",
      raidId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      notes: null,
    });
    createdTemplateIds.push(template.id);

    const result = await runService.createManyRuns(lead, {
      defaults: defaultsFor(),
      runs: rowsOf(3, 870),
      templateId: template.id,
    });
    createdRunIds.push(...result.ids);

    expect(result.ids).toHaveLength(3);
    const runs = await Promise.all(result.ids.map((id) => runRepository.findById(id)));
    for (const run of runs) {
      expect(run?.raidLeadId).toBe(ids.lead);
      expect(run?.status).toBe("DRAFT");
      expect(run?.signupsOpen).toBe(false);
      const roster = await orm.RunRoster.where({ runId: run!.id }).first();
      expect(roster).toBeTruthy();
    }
  });

  describe("snapshot independence — editing/deactivating a template never mutates a Run already created from it", () => {
    it("editing the template after Run creation leaves the existing Run's fields unchanged", async () => {
      const template = await runTemplateService.createTemplate(lead, {
        name: "Snapshot Independence",
        raidId,
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        plannedBossCount: 8,
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        notes: "Original notes",
      });
      createdTemplateIds.push(template.id);

      const result = await runService.createManyRuns(lead, {
        defaults: defaultsFor(),
        runs: rowsOf(1, 880),
        templateId: template.id,
      });
      createdRunIds.push(...result.ids);
      const before = await runRepository.findById(result.ids[0]!);

      await runTemplateService.updateTemplate(lead, {
        templateId: template.id,
        name: "Snapshot Independence (edited)",
        raidId,
        difficulty: "MYTHIC",
        lootType: "VIP",
        plannedBossCount: 3,
        desiredTankCount: 5,
        desiredHealerCount: 1,
        desiredDpsCount: 20,
        notes: "Changed notes",
      });

      const after = await runRepository.findById(result.ids[0]!);
      expect(after?.difficulty).toBe(before?.difficulty);
      expect(after?.lootType).toBe(before?.lootType);
      expect(after?.plannedBossCount).toBe(before?.plannedBossCount);
      expect(after?.desiredTankCount).toBe(before?.desiredTankCount);
      expect(after?.desiredHealerCount).toBe(before?.desiredHealerCount);
      expect(after?.desiredDpsCount).toBe(before?.desiredDpsCount);
      expect(after?.notes).toBe(before?.notes);
      expect(after?.raidLeadId).toBe(before?.raidLeadId);
    });

    it("deactivating the template after Run creation leaves the existing Run fully manageable and unchanged", async () => {
      const template = await runTemplateService.createTemplate(lead, {
        name: "Deactivation Independence",
        raidId,
        difficulty: "HEROIC",
        lootType: "UNSAVED",
        plannedBossCount: 8,
        desiredTankCount: 2,
        desiredHealerCount: 4,
        desiredDpsCount: 14,
        notes: null,
      });
      createdTemplateIds.push(template.id);

      const result = await runService.createManyRuns(lead, {
        defaults: defaultsFor(),
        runs: rowsOf(1, 890),
        templateId: template.id,
      });
      createdRunIds.push(...result.ids);
      const before = await runRepository.findById(result.ids[0]!);

      await runTemplateService.deactivate(lead, template.id);

      const after = await runRepository.findById(result.ids[0]!);
      expect(after?.status).toBe(before?.status);
      expect(after?.raidLeadId).toBe(before?.raidLeadId);
      expect(after?.archivedAt).toBeNull();
      // The Run can still be opened normally — deactivation of its origin
      // template has no bearing on the Run's own lifecycle.
      const opened = await runService.openRun(lead, result.ids[0]!);
      expect(opened.id).toBe(result.ids[0]);
    });
  });
});
