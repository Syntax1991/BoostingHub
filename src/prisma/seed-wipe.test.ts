import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { pgConnectionConfig } from "@/lib/pg-pool";
import { venomousCreateInput } from "@/lib/test-run-input";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { communityScheduleRepository } from "@/repositories/community-schedule.repository";
import { runTemplateRepository } from "@/repositories/run-template.repository";
import { communityScheduleMaterializationService } from "@/services/community-schedule-materialization.service";
import { communityScheduleOccurrenceService } from "@/services/community-schedule-occurrence.service";
import { runService } from "@/services/run.service";
import { freezeSystemTime, restoreSystemTime, SCHEDULE_TEST_CLOCK } from "@/test/time";

/**
 * The real seed reset (`npm run db:seed`, as run by `npm run test:db:reset`) must
 * succeed while Community Schedule data exists: its links / slots reference Runs,
 * Run Setups and Users with RESTRICT and used to block the wipe. Runs the actual
 * seed script — which leaves the test database freshly seeded, exactly as a reset
 * does, for the files after this one.
 */

/** Seeded identities (src/prisma/seed.ts). */
const THORNE_ID = "33333333-3333-4333-8333-333333333333";
const admin: AuthenticatedUser = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Aelira Nightwatch",
  email: "aelira@dev.boostting.local",
  image: null,
  discordUserId: null,
  discordUsername: null,
  accountRole: "ADMIN",
  accountStatus: "ACTIVE",
};

/** Fri 15 Jan 2027 12:00Z: CURRENT occurrence Fri 15 Jan 19:45 Berlin is upcoming, NEXT is Fri 22 Jan. */
const OCC_NOW = new Date("2027-01-15T12:00:00.000Z");
const NEXT_FRIDAY_1945 = "2027-01-22T18:45:00.000Z";

/**
 * The real seed script, pointed at the same (guarded) test database this process
 * uses — launched like `npm run test:db:reset` does: DATABASE_URL set to the test
 * database, outside the Vitest runtime (whose VITEST flag would otherwise make the
 * child re-run the test-database guard against that very URL).
 */
function runSeed() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => key !== "VITEST" && !(key === "NODE_ENV" && value === "test")),
  ) as NodeJS.ProcessEnv;
  env.DATABASE_URL = pgConnectionConfig.connectionString;
  return spawnSync("npm run db:seed", {
    env,
    shell: true,
    encoding: "utf8",
  });
}

async function scheduleRowCounts() {
  return {
    slots: (await orm.CommunityScheduleSlot.select("id").all()).length,
    links: (await orm.CommunityScheduleRun.select("id").all()).length,
  };
}

beforeAll(() => freezeSystemTime(SCHEDULE_TEST_CLOCK, { advance: true }));
afterAll(() => restoreSystemTime());

describe("seed reset with Community Schedule data", () => {
  it("wipes slots, ATTACHED and MATERIALIZED occurrences and their Run Setup, then seeds cleanly", async () => {
    const templateId = await runTemplateRepository.create({
      name: "Seed Reset Setup",
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 8 }],
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      notes: null,
      createdById: admin.id,
      updatedById: admin.id,
    });
    const slotFields = {
      label: "Seed Reset",
      notes: null,
      raidLeadId: THORNE_ID,
      runTemplateId: templateId,
      autoCreateRun: false,
      runMode: "INHOUSE" as const,
      createdById: admin.id,
      updatedById: admin.id,
    };
    const slot = await communityScheduleRepository.create({ ...slotFields, weekday: "FRIDAY", localStartTime: "19:45" });
    const inactive = await communityScheduleRepository.create({ ...slotFields, weekday: "SATURDAY", localStartTime: "20:00" });
    await communityScheduleRepository.setActive(inactive.id, false, admin.id);

    // MATERIALIZED: a Schedule-created Run for the CURRENT occurrence.
    const materialized = await communityScheduleMaterializationService.materializeOccurrence(
      { kind: "SYSTEM" },
      { scheduleSlotId: slot.id, window: "CURRENT", now: OCC_NOW },
    );
    // ATTACHED: an independent existing Run fulfils the NEXT occurrence.
    const existing = await runService.createRun(
      { ...admin, id: THORNE_ID, name: "Thorne Ironvein", accountRole: "RAID_LEAD" },
      venomousCreateInput({ scheduledStartAt: NEXT_FRIDAY_1945 }),
    );
    const attached = await communityScheduleOccurrenceService.attachExistingRun(admin, {
      scheduleSlotId: slot.id,
      runId: existing.id,
      now: OCC_NOW,
    });
    expect(attached.origin).toBe("ATTACHED");
    expect((await orm.CommunityScheduleRun.where({ runId: materialized.runId }).first()) as { origin: string })
      .toMatchObject({ origin: "MATERIALIZED" });
    expect(await scheduleRowCounts()).toEqual({ slots: 2, links: 2 });

    const seeded = runSeed();
    expect(seeded.status, `${seeded.stdout}\n${seeded.stderr}`.slice(-2000)).toBe(0);

    expect(await scheduleRowCounts()).toEqual({ slots: 0, links: 0 });
    expect(await orm.Run.where({ id: existing.id }).first()).toBeNull();
    expect(await orm.Run.where({ id: materialized.runId }).first()).toBeNull();
    expect(await orm.RunTemplate.where({ id: templateId }).first()).toBeNull();
    // Freshly seeded again: the seeded identities and Runs are back.
    expect(await orm.User.where({ id: admin.id }).first()).not.toBeNull();
    expect((await orm.Run.select("id").all()).length).toBeGreaterThan(0);
  }, 180_000);
});
