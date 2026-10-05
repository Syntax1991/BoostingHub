import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orm } from "@/lib/prisma";
import { integrationEventRepository } from "@/repositories/integration-event.repository";
import { integrationEventService } from "@/services/integration-event.service";

const IDS = [
  "cccccccc-cccc-4ccc-8ccc-ie0000000001",
  "cccccccc-cccc-4ccc-8ccc-ie0000000002",
  "cccccccc-cccc-4ccc-8ccc-ie0000000003",
];

async function cleanup() {
  const operations = [
    "SCHEDULED_SYNC_PASS",
    "SYNC_ONCE",
    "RETENTION_TEST_OLD",
    "RETENTION_TEST_NEW",
    "FIND_CHARACTER",
  ];
  for (const operation of operations) {
    const rows = (await orm.IntegrationEvent.where({ operation }).all()) as Array<Record<string, unknown>>;
    for (const row of rows) {
      await orm.IntegrationEvent.where({ id: String(row.id) }).delete().catch(() => {});
    }
  }
  for (const id of IDS) {
    await orm.IntegrationEvent.where({ id }).delete().catch(() => {});
  }
}

beforeAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

describe("integrationEventRepository / service", () => {
  it("persists sanitized metadata and lists newest first with a hard limit", async () => {
    await integrationEventRepository.create({
      provider: "BLIZZARD",
      operation: "SCHEDULED_SYNC_PASS",
      status: "SUCCESS",
      durationMs: 1200,
      metadata: { processed: 5, access_token: "SECRET", nested: { x: 1 } },
      createdAt: "2026-10-05T10:00:00.000Z",
    });
    await integrationEventRepository.create({
      provider: "DISCORD",
      operation: "SYNC_ONCE",
      status: "ERROR",
      errorCode: "DISCORD_MISSING_PERMISSIONS",
      httpStatus: 403,
      metadata: { discordCode: 50013 },
      createdAt: "2026-10-05T11:00:00.000Z",
    });

    const rows = await integrationEventRepository.listRecent({ limit: 10 });
    expect(rows[0]?.provider).toBe("DISCORD");
    expect(rows[1]?.provider).toBe("BLIZZARD");
    expect(rows[1]?.metadataJson).toBe(JSON.stringify({ processed: 5 }));
    expect(rows[1]?.metadataJson).not.toContain("SECRET");

    const blizzardOnly = await integrationEventRepository.listRecent({
      provider: "BLIZZARD",
      limit: 10,
    });
    expect(blizzardOnly).toHaveLength(1);
    expect(blizzardOnly[0]?.operation).toBe("SCHEDULED_SYNC_PASS");
  });

  it("caps listRecent limit at 100", async () => {
    const rows = await integrationEventRepository.listRecent({ limit: 10_000 });
    expect(rows.length).toBeLessThanOrEqual(100);
  });

  it("purgeExpired deletes events older than 30 days", async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    await orm.IntegrationEvent.create({
      id: IDS[0],
      provider: "SYSTEM",
      operation: "RETENTION_TEST_OLD",
      status: "SUCCESS",
      createdAt: old,
      durationMs: null,
      httpStatus: null,
      errorCode: null,
      entityType: null,
      entityId: null,
      region: null,
      metadataJson: null,
    });
    await orm.IntegrationEvent.create({
      id: IDS[1],
      provider: "SYSTEM",
      operation: "RETENTION_TEST_NEW",
      status: "SUCCESS",
      createdAt: recent,
      durationMs: null,
      httpStatus: null,
      errorCode: null,
      entityType: null,
      entityId: null,
      region: null,
      metadataJson: null,
    });

    const result = await integrationEventService.purgeExpired();
    expect(result.retentionDays).toBe(30);
    expect(result.purged).toBeGreaterThanOrEqual(1);

    const remaining = await integrationEventRepository.listRecent({
      provider: "SYSTEM",
      operation: "RETENTION_TEST_NEW",
      limit: 10,
    });
    expect(remaining.some((row) => row.id === IDS[1])).toBe(true);

    const oldGone = await orm.IntegrationEvent.where({ id: IDS[0] }).first();
    expect(oldGone).toBeNull();
  });

  it("recordFailure stores DomainError codes safely", async () => {
    const row = await integrationEventService.recordFailure({
      provider: "WARCRAFT_LOGS",
      operation: "FIND_CHARACTER",
      error: { code: "WCL_UNAVAILABLE", message: "token=abc" },
      entityType: "Character",
      entityId: "char-1",
      region: "EU",
    });
    expect(row.status).toBe("ERROR");
    expect(row.errorCode).toBe("WCL_UNAVAILABLE");
    expect(row.metadataJson).toBeNull();
  });
});
