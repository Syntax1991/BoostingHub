import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import { runService } from "@/services/run.service";
import { POST as archivePost } from "@/app/api/bot/runs/[runId]/archive/route";

const TOKEN = "bot-api-archive-test-token-0123456789";
const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-bar000000001",
  other: "aaaaaaaa-aaaa-4aaa-8aaa-bar000000002",
};
const LEAD_DISCORD_ID = "910000000000000001";
const OTHER_DISCORD_ID = "910000000000000002";

const lead: AuthenticatedUser = {
  id: ids.lead,
  name: "Archive Lead",
  email: null,
  image: null,
  discordUserId: LEAD_DISCORD_ID,
  discordUsername: null,
  accountRole: "RAID_LEAD",
  accountStatus: "ACTIVE",
};

function archive(runId: string, discordUserId: string) {
  return archivePost(
    new NextRequest(new URL(`/api/bot/runs/${runId}/archive`, "http://bot-api.test"), {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "x-discord-user-id": discordUserId },
    }),
    { params: Promise.resolve({ runId }) },
  );
}

async function cleanup() {
  for (const row of (await orm.Run.where({ raidLeadId: ids.lead }).select("id").all()) as Array<{ id: string }>) {
    await orm.RunRoster.where({ runId: row.id }).delete().catch(() => {});
    await orm.RunRaidContent.where({ runId: row.id }).delete().catch(() => {});
    await orm.RunDomainEvent.where({ runId: row.id }).delete().catch(() => {});
    await orm.Run.where({ id: row.id }).delete().catch(() => {});
  }
  for (const id of Object.values(ids)) {
    await orm.ActivityEvent.where({ userId: id }).delete().catch(() => {});
    await orm.User.where({ id }).delete().catch(() => {});
  }
}

let originalToken: string | undefined;
let runId = "";

beforeAll(async () => {
  originalToken = process.env.BOOSTINGHUB_BOT_API_TOKEN;
  process.env.BOOSTINGHUB_BOT_API_TOKEN = TOKEN;
  await raidRepository.ensureReferenceRaids();
  await cleanup();
  const now = new Date().toISOString();
  for (const [id, discordUserId, accountRole] of [
    [ids.lead, LEAD_DISCORD_ID, "RAID_LEAD"],
    [ids.other, OTHER_DISCORD_ID, "USER"],
  ] as const) {
    await orm.User.create({
      id,
      name: id === ids.lead ? "Archive Lead" : "Archive Other",
      email: `${id}@botapi.boostting.local`,
      emailVerified: true,
      discordUserId,
      accountRole,
      accountStatus: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    });
  }
  runId = (
    await runService.createRun(
      lead,
      venomousCreateInput({ scheduledStartAt: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString() }),
    )
  ).id;
});

afterAll(async () => {
  await cleanup();
  process.env.BOOSTINGHUB_BOT_API_TOKEN = originalToken;
});

describe("POST /api/bot/runs/:runId/archive (Discord Archive Run button)", () => {
  it("refuses a Run that has not ended", async () => {
    const res = await archive(runId, LEAD_DISCORD_ID);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("RUN_CANNOT_ARCHIVE");
  });

  it("refuses a member who may not manage the Run", async () => {
    await orm.Run.where({ id: runId }).update({ status: "COMPLETED" });
    const res = await archive(runId, OTHER_DISCORD_ID);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("RUN_NOT_MANAGEABLE");
    expect(((await orm.Run.where({ id: runId }).first()) as { archivedAt: string | null }).archivedAt).toBeNull();
  });

  it("the Run's Raid Lead archives a completed Run (once)", async () => {
    const res = await archive(runId, LEAD_DISCORD_ID);
    expect(res.status).toBe(200);
    const run = (await orm.Run.where({ id: runId }).first()) as { archivedAt: string | null; archivedById: string | null };
    expect(run.archivedAt).not.toBeNull();
    expect(run.archivedById).toBe(ids.lead);

    const again = await archive(runId, LEAD_DISCORD_ID);
    expect(((await again.json()) as { code: string }).code).toBe("RUN_ALREADY_ARCHIVED");
  });
});
