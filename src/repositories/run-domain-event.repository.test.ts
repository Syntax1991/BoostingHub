import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orm } from "@/lib/prisma";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { runDomainEventRepository } from "@/repositories/run-domain-event.repository";
import { runRepository } from "@/repositories/run.repository";
import { runDomainEventService } from "@/services/run-domain-event.service";

let runId = "";
let leadId = "";

async function cleanupEvents() {
  if (!runId) return;
  const rows = (await orm.RunDomainEvent.where({ runId }).all()) as Array<Record<string, unknown>>;
  for (const row of rows) {
    await orm.RunDomainEvent.where({ id: String(row.id) }).delete().catch(() => {});
  }
}

beforeAll(async () => {
  const lead = (await orm.User.where({ accountRole: "RAID_LEAD" }).first()) as { id: string } | null;
  if (!lead) throw new Error("Expected seeded RAID_LEAD for RunDomainEvent tests.");
  leadId = lead.id;
  runId = await runRepository.create({
    title: "RDE Fixture",
    difficulty: "HEROIC",
    lootType: "SAVED",
    scheduledStartAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    raidLeadId: leadId,
    notes: null,
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    desiredLootbuddyCount: 0,
    contents: [{ raidId: VENOMOUS_ABYSS_RAID_ID, sortOrder: 1, plannedBossCount: 8 }],
  });
  await cleanupEvents();
});

beforeEach(async () => {
  await cleanupEvents();
});

afterAll(async () => {
  await cleanupEvents();
  if (runId) {
    await orm.RunRoster.where({ runId }).delete().catch(() => {});
    await orm.RunRaidContent.where({ runId }).delete().catch(() => {});
    await orm.Run.where({ id: runId }).delete().catch(() => {});
  }
});

describe("runDomainEventRepository / service", () => {
  it("persists sanitized payload and lists newest first with a hard limit", async () => {
    await runDomainEventService.record({
      runId,
      actorUser: { id: leadId },
      type: "RUN_CREATED",
      summary: "Run draft created.",
      payload: { difficulty: "HEROIC", token: "SECRET", nested: { x: 1 } },
    });
    await runDomainEventRepository.create({
      runId,
      actorKind: "SYSTEM",
      type: "RUN_STARTED",
      summary: "System start note.",
      payload: { selectedCount: 8 },
      occurredAt: "2099-01-01T00:00:00.000Z",
    });

    const rows = await runDomainEventService.listForRun(runId, 10);
    expect(rows[0]?.type).toBe("RUN_STARTED");
    expect(rows[0]?.actorKind).toBe("SYSTEM");
    expect(rows[0]?.actorUserId).toBeNull();
    expect(rows[1]?.payloadJson).toBe(JSON.stringify({ difficulty: "HEROIC" }));
    expect(rows[1]?.payloadJson).not.toContain("SECRET");
  });

  it("refuses USER actor without actorUserId", async () => {
    await expect(
      runDomainEventRepository.create({
        runId,
        actorKind: "USER",
        type: "RUN_CANCELLED",
        summary: "bad",
      }),
    ).rejects.toThrow(/requires actorUserId/);
  });
});
