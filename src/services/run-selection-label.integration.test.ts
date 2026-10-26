import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { seededProductSelection, venomousCreateInput, venomousUpdateInput } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import { runRepository } from "@/repositories/run.repository";
import { communityScheduleOccurrenceService } from "@/services/community-schedule-occurrence.service";
import { runService } from "@/services/run.service";
import { runTemplateService } from "@/services/run-template.service";

/**
 * Run / Run Setup select labels come from one helper over live fields: short
 * content titles, and every edit visible on the next load (no stale labels).
 */

const ids = { admin: "b3d50000-0000-4000-8000-000000000001", lead: "b3d50000-0000-4000-8000-000000000002" };
const admin: AuthenticatedUser = {
  id: ids.admin, name: "Label Admin", email: "label-admin@local", image: null, discordUserId: null, discordUsername: null,
  accountRole: "ADMIN", accountStatus: "ACTIVE",
};
const lead: AuthenticatedUser = { ...admin, id: ids.lead, name: "Label Lead", email: "label-lead@local", accountRole: "RAID_LEAD" };
const templateIds: string[] = [];

function futureIso(days: number, hourUtc: number) {
  const date = new Date(Date.now() + days * 86_400_000);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date.toISOString();
}

async function cleanup() {
  for (const row of (await orm.Run.where({ raidLeadId: ids.lead }).select("id").all()) as Array<{ id: string }>) {
    await orm.Run.where({ id: row.id }).delete().catch(() => {});
  }
  for (const id of templateIds) await orm.RunTemplate.where({ id }).delete().catch(() => {});
  for (const id of Object.values(ids)) {
    await orm.ActivityEvent.where({ userId: id }).delete().catch(() => {});
    await orm.User.where({ id }).delete().catch(() => {});
  }
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await cleanup();
  const now = new Date().toISOString();
  for (const [id, role] of [[ids.admin, "ADMIN"], [ids.lead, "RAID_LEAD"]] as const) {
    await orm.User.create({ id, name: id === ids.lead ? "Label Lead" : "Label Admin", email: `${id}@label.local`, emailVerified: true, accountRole: role, accountStatus: "ACTIVE", isBooster: false, createdAt: now, updatedAt: now });
  }
});

afterAll(cleanup);

describe("Run Setup option labels (Create Run)", () => {
  it("a multi-raid setup shows short content names; edits change the label on the next load", async () => {
    const created = await runTemplateService.createTemplate(admin, {
      name: "Label Bundle",
      ...seededProductSelection("MIDNIGHT_S2_BUNDLE", 8),
      difficulty: "HEROIC",
      lootType: "VIP",
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      notes: null,
    });
    templateIds.push(created.id);
    const labelOf = async () => (await runService.getCreateManyForm(lead)).templates.find((row) => row.id === created.id)?.label ?? "";

    const before = await labelOf();
    expect(before).toMatch(/^Label Bundle · /);
    expect(before).toContain("Tide");
    expect(before).toContain("Venom");
    expect(before).toContain("HC VIP");
    expect(before).not.toContain("The Venomous Abyss");
    expect(before).not.toContain("The Tidebound Grotto");

    await runTemplateService.updateTemplate(admin, {
      templateId: created.id,
      name: "Label Bundle Renamed",
      ...seededProductSelection("MIDNIGHT_S2_BUNDLE", 8),
      difficulty: "MYTHIC",
      lootType: "VIP",
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
      notes: null,
    });
    const after = await labelOf();
    expect(after).toMatch(/^Label Bundle Renamed · /);
    expect(after).toContain("Mythic VIP");
    expect(after).not.toContain("HC VIP");
  });
});

describe("existing Run option labels (Schedule: use existing Run)", () => {
  it("are the live Run title — time, type and Raid Lead edits show up, no stale label survives", async () => {
    const run = await runService.createRun(lead, venomousCreateInput({ scheduledStartAt: futureIso(3, 18) }));
    await orm.Run.where({ id: run.id }).update({ status: "OPEN" });
    const labelOf = async () =>
      (await communityScheduleOccurrenceService.listAdoptionCandidates(admin)).find((row) => row.runId === run.id)?.label ?? "";

    const first = (await runRepository.findById(run.id))!;
    expect(await labelOf()).toBe(first.title);
    expect(first.title).not.toContain("The Venomous Abyss");

    await runService.updateRun(
      lead,
      venomousUpdateInput(run.id, first, { scheduledStartAt: futureIso(4, 19), difficulty: "MYTHIC", lootType: "VIP" }),
    );
    const edited = (await runRepository.findById(run.id))!;
    expect(edited.title).not.toBe(first.title);
    expect(edited.title).toContain("Mythic");
    expect(await labelOf()).toBe(edited.title);
  });
});

describe("one shared helper", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), "src", path), "utf8");

  it("every Run / Run Setup option builder goes through run-selection-label", () => {
    for (const path of [
      "services/run.service.ts",
      "services/community-schedule.service.ts",
      "services/community-schedule-occurrence.service.ts",
    ]) {
      expect(read(path)).toContain('from "@/lib/run-selection-label"');
    }
    for (const path of [
      "components/manage/community-schedule-plan-dialog.tsx",
      "components/manage/community-schedule-slot-form-dialog.tsx",
    ]) {
      const source = read(path);
      expect(source).toContain("{template.label}");
      expect(source).not.toContain("{template.productLabel}");
    }
  });
});
