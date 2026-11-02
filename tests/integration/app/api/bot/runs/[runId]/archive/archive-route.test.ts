import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { anyContentRunInput } from "@tests/fixtures/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import { runService } from "@/services/run.service";
import { testActor } from "@tests/fixtures/actors";
import { botRequest, installBotApiToken, runRouteParams } from "@tests/helpers/bot-api";
import {
  assertIsolatedTestDatabase,
  createTestUser,
  deleteCreatedRows,
  syntheticDiscordId,
} from "@tests/fixtures/db-fixtures";
import { CURRENT_WEEK_RUN_START, RAID_WEEK_TEST_CLOCK, freezeSystemTime, restoreSystemTime } from "@tests/fixtures/time";
import { POST as archivePost } from "@/app/api/bot/runs/[runId]/archive/route";

const TOKEN = "bot-api-archive-test-token-0123456789";
const LEAD_DISCORD_ID = syntheticDiscordId();
const OTHER_DISCORD_ID = syntheticDiscordId();
const created = { runIds: [] as string[], userIds: [] as string[] };

let lead: AuthenticatedUser;
let restoreToken = () => {};

function archive(runId: string, actingDiscordUserId: string) {
  return archivePost(
    botRequest(`/api/bot/runs/${runId}/archive`, { method: "POST", token: TOKEN, actingDiscordUserId }),
    runRouteParams(runId),
  );
}

/** A fresh Run of the suite's Raid Lead; `completed` moves it straight to COMPLETED. */
async function createRun(options: { completed: boolean }) {
  const run = await runService.createRun(lead, anyContentRunInput({ scheduledStartAt: CURRENT_WEEK_RUN_START }));
  created.runIds.push(run.id);
  if (options.completed) await orm.Run.where({ id: run.id }).update({ status: "COMPLETED" });
  return run.id;
}

async function archiveState(runId: string) {
  return (await orm.Run.where({ id: runId }).first()) as { archivedAt: string | null; archivedById: string | null };
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  freezeSystemTime(RAID_WEEK_TEST_CLOCK, { advance: true });
  restoreToken = installBotApiToken(TOKEN);
  await raidRepository.ensureReferenceRaids();
  const leadId = await createTestUser({ name: "Archive Lead", accountRole: "RAID_LEAD", discordUserId: LEAD_DISCORD_ID });
  const otherId = await createTestUser({ name: "Archive Other", discordUserId: OTHER_DISCORD_ID });
  created.userIds.push(leadId, otherId);
  lead = testActor(leadId, "RAID_LEAD", { discordUserId: LEAD_DISCORD_ID });
});

afterAll(async () => {
  try {
    await deleteCreatedRows(created);
  } finally {
    restoreToken();
    restoreSystemTime();
  }
});

describe("POST /api/bot/runs/:runId/archive (Discord Archive Run button)", () => {
  it("refuses a Run that has not ended", async () => {
    const runId = await createRun({ completed: false });
    const res = await archive(runId, LEAD_DISCORD_ID);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("RUN_CANNOT_ARCHIVE");
    expect((await archiveState(runId)).archivedAt).toBeNull();
  });

  it("refuses a member who may not manage the Run", async () => {
    const runId = await createRun({ completed: true });
    const res = await archive(runId, OTHER_DISCORD_ID);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("RUN_NOT_MANAGEABLE");
    expect((await archiveState(runId)).archivedAt).toBeNull();
  });

  it("the Run's Raid Lead archives a completed Run (once)", async () => {
    const runId = await createRun({ completed: true });
    const res = await archive(runId, LEAD_DISCORD_ID);
    expect(res.status).toBe(200);
    const run = await archiveState(runId);
    expect(run.archivedAt).not.toBeNull();
    expect(run.archivedById).toBe(lead.id);

    const again = await archive(runId, LEAD_DISCORD_ID);
    expect(((await again.json()) as { code: string }).code).toBe("RUN_ALREADY_ARCHIVED");
    expect((await archiveState(runId)).archivedAt).toBe(run.archivedAt);
  });
});
