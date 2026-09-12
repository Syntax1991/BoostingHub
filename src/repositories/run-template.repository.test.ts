import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orm } from "@/lib/prisma";
import { raidRepository } from "@/repositories/raid.repository";
import { runTemplateRepository } from "@/repositories/run-template.repository";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";

const raidId = VENOMOUS_ABYSS_RAID_ID;
const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-rt0000000001",
  otherLead: "aaaaaaaa-aaaa-4aaa-8aaa-rt0000000002",
  admin: "aaaaaaaa-aaaa-4aaa-8aaa-rt0000000003",
};

const createdTemplateIds: string[] = [];

async function createTestUser(
  id: string,
  name: string,
  accountRole: "USER" | "RAID_LEAD" | "ADMIN",
  accountStatus: "ACTIVE" | "DISABLED" = "ACTIVE",
) {
  await orm.User.create({
    id,
    name,
    email: `${id}@rttest.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function deleteIfPresent(table: "User" | "RunTemplate", id: string) {
  try {
    if (table === "User") await orm.User.where({ id }).delete();
    else await orm.RunTemplate.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const id of [ids.lead, ids.otherLead, ids.admin]) {
    await deleteIfPresent("User", id);
  }
  await createTestUser(ids.lead, "RT Lead", "RAID_LEAD");
  await createTestUser(ids.otherLead, "RT Other Lead", "RAID_LEAD");
  await createTestUser(ids.admin, "RT Admin", "ADMIN");
});

afterAll(async () => {
  for (const id of createdTemplateIds) {
    await deleteIfPresent("RunTemplate", id);
  }
  for (const id of [ids.lead, ids.otherLead, ids.admin]) {
    await deleteIfPresent("User", id);
  }
});

function baseFields(overrides: Partial<Parameters<typeof runTemplateRepository.create>[0]> = {}) {
  return {
    name: "Repo Test Template",
    raidLeadId: ids.lead,
    raidId,
    difficulty: "HEROIC" as const,
    lootType: "UNSAVED" as const,
    plannedBossCount: 8,
    desiredTankCount: 2,
    desiredHealerCount: 4,
    desiredDpsCount: 14,
    notes: null,
    createdById: ids.lead,
    updatedById: ids.lead,
    ...overrides,
  };
}

describe("runTemplateRepository — CRUD and joined reads", () => {
  it("create + findById returns joined raid/raid-lead/audit fields", async () => {
    const id = await runTemplateRepository.create(baseFields());
    createdTemplateIds.push(id);

    const template = await runTemplateRepository.findById(id);
    expect(template).toBeTruthy();
    expect(template?.name).toBe("Repo Test Template");
    expect(template?.raidLeadId).toBe(ids.lead);
    expect(template?.raidLeadName).toBe("RT Lead");
    expect(template?.raidLeadEligible).toBe(true);
    expect(template?.raidId).toBe(raidId);
    expect(template?.raidAvailableForRuns).toBe(true);
    expect(template?.totalBossCount).toBe(8);
    expect(template?.isActive).toBe(true);
    expect(template?.createdById).toBe(ids.lead);
    expect(template?.createdByName).toBe("RT Lead");
    expect(template?.updatedById).toBe(ids.lead);
  });

  it("findById returns null for a nonexistent id", async () => {
    expect(await runTemplateRepository.findById(crypto.randomUUID())).toBeNull();
  });

  it("update mutates planning fields and bumps updatedById/updatedAt", async () => {
    const id = await runTemplateRepository.create(baseFields({ name: "Before update" }));
    createdTemplateIds.push(id);
    const before = await runTemplateRepository.findById(id);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await runTemplateRepository.update(id, {
      name: "After update",
      raidLeadId: ids.lead,
      raidId,
      difficulty: "MYTHIC",
      lootType: "VIP",
      plannedBossCount: 5,
      desiredTankCount: 3,
      desiredHealerCount: 5,
      desiredDpsCount: 12,
      notes: "Updated notes",
      updatedById: ids.admin,
    });

    const after = await runTemplateRepository.findById(id);
    expect(after?.name).toBe("After update");
    expect(after?.difficulty).toBe("MYTHIC");
    expect(after?.lootType).toBe("VIP");
    expect(after?.plannedBossCount).toBe(5);
    expect(after?.desiredTankCount).toBe(3);
    expect(after?.desiredHealerCount).toBe(5);
    expect(after?.desiredDpsCount).toBe(12);
    expect(after?.notes).toBe("Updated notes");
    expect(after?.updatedById).toBe(ids.admin);
    // createdById/createdBy never change on update — only updatedById does.
    expect(after?.createdById).toBe(before?.createdById);
    expect(new Date(after!.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(before!.updatedAt).getTime());
  });

  it("setActive toggles isActive and records who changed it", async () => {
    const id = await runTemplateRepository.create(baseFields());
    createdTemplateIds.push(id);

    await runTemplateRepository.setActive(id, false, ids.admin);
    const deactivated = await runTemplateRepository.findById(id);
    expect(deactivated?.isActive).toBe(false);
    expect(deactivated?.updatedById).toBe(ids.admin);

    await runTemplateRepository.setActive(id, true, ids.lead);
    const reactivated = await runTemplateRepository.findById(id);
    expect(reactivated?.isActive).toBe(true);
    expect(reactivated?.updatedById).toBe(ids.lead);
  });
});

describe("runTemplateRepository — scoped reads", () => {
  it("listByRaidLead returns only that raid lead's templates", async () => {
    const ownId = await runTemplateRepository.create(baseFields({ name: "Scoped Own" }));
    const otherId = await runTemplateRepository.create(baseFields({ name: "Scoped Other", raidLeadId: ids.otherLead, createdById: ids.otherLead, updatedById: ids.otherLead }));
    createdTemplateIds.push(ownId, otherId);

    const own = await runTemplateRepository.listByRaidLead(ids.lead);
    expect(own.some((t) => t.id === ownId)).toBe(true);
    expect(own.some((t) => t.id === otherId)).toBe(false);

    const other = await runTemplateRepository.listByRaidLead(ids.otherLead);
    expect(other.some((t) => t.id === otherId)).toBe(true);
    expect(other.some((t) => t.id === ownId)).toBe(false);
  });

  it("listAll with no filter includes templates across raid leads; with a raidLeadId filter it scopes", async () => {
    const ownId = await runTemplateRepository.create(baseFields({ name: "ListAll Own" }));
    const otherId = await runTemplateRepository.create(baseFields({ name: "ListAll Other", raidLeadId: ids.otherLead, createdById: ids.otherLead, updatedById: ids.otherLead }));
    createdTemplateIds.push(ownId, otherId);

    const all = await runTemplateRepository.listAll();
    expect(all.some((t) => t.id === ownId)).toBe(true);
    expect(all.some((t) => t.id === otherId)).toBe(true);

    const scoped = await runTemplateRepository.listAll({ raidLeadId: ids.lead });
    expect(scoped.some((t) => t.id === ownId)).toBe(true);
    expect(scoped.some((t) => t.id === otherId)).toBe(false);
  });
});
