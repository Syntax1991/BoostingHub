import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { raidRepository } from "@/repositories/raid.repository";
import { strikeRepository } from "@/repositories/strike.repository";
import { runService } from "@/services/run.service";
import { anyContentRunInput } from "@tests/fixtures/test-run-input";
import { strikeService } from "@/services/strike.service";
import type { ParticipationType } from "@/models/enums";
import { testActor } from "@tests/fixtures/actors";
import { assertIsolatedTestDatabase, createTestCharacter, createTestUser, deleteCreatedRows } from "@tests/fixtures/db-fixtures";
import { expectDomainError } from "@tests/helpers/domain-error";

/**
 * Strikes restrict deleting both the struck User and their creator, so they go first;
 * Runs, signups and Characters then go with deleteCreatedRows.
 */
const created = { runIds: [] as string[], userIds: [] as string[] };
const ids = { admin: "", lead: "", otherLead: "", target: "", unrelated: "", plainUser: "" };
let admin: AuthenticatedUser;
let lead: AuthenticatedUser;
let target: AuthenticatedUser;
let plainUser: AuthenticatedUser;

async function createUser(name: string, accountRole: AuthenticatedUser["accountRole"]) {
  const id = await createTestUser({ name, accountRole });
  created.userIds.push(id);
  return id;
}

function futureIso(days = 10) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function createSignup(input: {
  runId: string;
  userId: string;
  characterId: string;
  participationType: ParticipationType;
}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id,
    runId: input.runId,
    userId: input.userId,
    characterId: input.characterId,
    participationType: input.participationType,
    isBackup: false,
    status: "PENDING",
    publishedRole: null,
    lootbuddyMode: null,
    lootbuddyVerification: null,
    createdAt: now,
    updatedAt: now,
  });
  if (input.participationType === "BOOSTER") {
    await orm.RunSignupRole.create({
      id: crypto.randomUUID(),
      signupId: id,
      role: "MELEE_DPS",
      createdAt: now,
    });
  }
  return id;
}

let labRunId = "";
let otherRunId = "";
let targetCharacterId = "";

beforeAll(async () => {
  assertIsolatedTestDatabase();
  await raidRepository.ensureReferenceRaids();
  ids.admin = await createUser("Strike Admin", "ADMIN");
  ids.lead = await createUser("Strike Lead", "RAID_LEAD");
  ids.otherLead = await createUser("Strike Other Lead", "RAID_LEAD");
  ids.target = await createUser("Strike Target", "USER");
  ids.unrelated = await createUser("Strike Unrelated", "USER");
  ids.plainUser = await createUser("Strike Plain User", "USER");
  admin = testActor(ids.admin, "ADMIN");
  lead = testActor(ids.lead, "RAID_LEAD");
  target = testActor(ids.target);
  plainUser = testActor(ids.plainUser);

  targetCharacterId = await createTestCharacter({
    userId: ids.target,
    name: "Skstriketarget",
    realm: "Strike Lab",
    wowClass: "WARRIOR",
    specialization: "Fury",
    primaryRole: "MELEE_DPS",
  });

  labRunId = (await runService.createRun(lead, anyContentRunInput({ scheduledStartAt: futureIso() }))).id;
  created.runIds.push(labRunId);
  await runService.openRun(lead, labRunId);
  // Association is proven by BoostingHub's own signup history — no roster
  // publish/start/attendance is needed to exercise the Strike domain.
  await createSignup({ runId: labRunId, userId: ids.target, characterId: targetCharacterId, participationType: "BOOSTER" });

  otherRunId = (await runService.createRun(admin, anyContentRunInput({ scheduledStartAt: futureIso(), raidLeadId: ids.otherLead }))).id;
  created.runIds.push(otherRunId);
}, 60_000);

afterAll(async () => {
  assertIsolatedTestDatabase();
  for (const userId of created.userIds) await orm.Strike.where({ userId }).deleteAndCount();
  await deleteCreatedRows(created);
}, 60_000);

describe("strikeService.create", () => {
  it("ADMIN creates a general (user-only) strike", async () => {
    const created = await strikeService.create(admin, {
      userId: ids.target,
      reason: "General staff note",
    });
    expect(created.runId).toBeNull();
    expect(created.status).toBe("ACTIVE");
    expect(created.userId).toBe(ids.target);
  });

  it("ADMIN creates a run-linked strike for an associated user", async () => {
    const created = await strikeService.create(admin, {
      userId: ids.target,
      runId: labRunId,
      reason: "No-show without notice",
    });
    expect(created.runId).toBe(labRunId);
    expect(created.runTitle).toBeTruthy();
  });

  it("RAID_LEAD creates a strike for a user associated with their own run", async () => {
    const created = await strikeService.create(lead, {
      userId: ids.target,
      runId: labRunId,
      reason: "Late without notice",
    });
    expect(created.status).toBe("ACTIVE");
  });

  it("RAID_LEAD is blocked from creating a strike on a run they do not manage", async () => {
    await expectDomainError(
      strikeService.create(lead, {
        userId: ids.target,
        runId: otherRunId,
        reason: "Not their run",
      }),
      "STRIKE_NOT_MANAGEABLE",
    );
  });

  it("RAID_LEAD is blocked from creating a user-only strike (no run)", async () => {
    await expectDomainError(
      strikeService.create(lead, {
        userId: ids.target,
        reason: "General note",
      }),
      "STRIKE_RUN_REQUIRED",
    );
  });

  it("RAID_LEAD is blocked when the target user has no signup history on their run", async () => {
    await expectDomainError(
      strikeService.create(lead, {
        userId: ids.unrelated,
        runId: labRunId,
        reason: "Unrelated user",
      }),
      "STRIKE_USER_NOT_ASSOCIATED",
    );
  });

  it("USER cannot create a strike", async () => {
    await expectDomainError(
      strikeService.create(plainUser, {
        userId: ids.target,
        reason: "Should be rejected",
      }),
      "STRIKE_NOT_MANAGEABLE",
    );
  });

});

describe("strikeService.revoke", () => {
  it("ADMIN revoke succeeds with a required reason and preserves the row", async () => {
    const created = await strikeService.create(admin, {
      userId: ids.target,
      reason: "To be revoked",
    });

    const revoked = await strikeService.revoke(admin, created.id, "Staff correction");
    expect(revoked.status).toBe("REVOKED");
    expect(revoked.revokedById).toBe(ids.admin);
    expect(revoked.revokedReason).toBe("Staff correction");
    expect(revoked.revokedAt).toBeTruthy();

    const stillThere = await strikeRepository.findById(created.id);
    expect(stillThere).not.toBeNull();
    expect(stillThere?.status).toBe("REVOKED");
  });

  it("rejects revoke without a reason", async () => {
    const created = await strikeService.create(admin, {
      userId: ids.target,
      reason: "Needs reason to revoke",
    });
    await expectDomainError(strikeService.revoke(admin, created.id, "   "), "VALIDATION_FAILED");
  });

  it("RAID_LEAD cannot revoke a strike, including one they created", async () => {
    const created = await strikeService.create(lead, {
      userId: ids.target,
      runId: labRunId,
      reason: "Created by lead",
    });
    await expectDomainError(strikeService.revoke(lead, created.id, "Trying anyway"), "STRIKE_REVOKE_FORBIDDEN");
  });

  it("rejects revoking an already-revoked strike", async () => {
    const created = await strikeService.create(admin, {
      userId: ids.target,
      reason: "Double revoke",
    });
    await strikeService.revoke(admin, created.id, "First revoke");
    await expectDomainError(strikeService.revoke(admin, created.id, "Second revoke"), "STRIKE_ALREADY_REVOKED");
  });
});

describe("strikeService history preservation and visibility", () => {
  it("survives the target user's account role change", async () => {
    const created = await strikeService.create(admin, {
      userId: ids.target,
      reason: "Role change survival",
    });

    await orm.User.where({ id: ids.target }).update({ accountRole: "RAID_LEAD" });
    const stillThere = await strikeRepository.findById(created.id);
    expect(stillThere?.userId).toBe(ids.target);
    await orm.User.where({ id: ids.target }).update({ accountRole: "USER" });
  });

  it("survives the target user's character deactivation", async () => {
    const created = await strikeService.create(admin, {
      userId: ids.target,
      reason: "Character deactivation survival",
    });

    await orm.Character.where({ id: targetCharacterId }).update({ isActive: false });
    const stillThere = await strikeRepository.findById(created.id);
    expect(stillThere?.userId).toBe(ids.target);
    await orm.Character.where({ id: targetCharacterId }).update({ isActive: true });
  });

  it("USER may read their own strike history without internal notes", async () => {
    const created = await strikeService.create(admin, {
      userId: ids.target,
      reason: "Own history visible",
      notes: "Internal-only detail",
    });

    const own = await strikeService.listOwn(target);
    const row = own.find((entry) => entry.id === created.id);
    expect(row).toBeTruthy();
    expect(row && "notes" in row).toBe(false);
  });

  it("USER cannot read another user's strike history", async () => {
    await expectDomainError(strikeService.listForUser(plainUser, ids.target), "NOT_AUTHORIZED");
  });
});
