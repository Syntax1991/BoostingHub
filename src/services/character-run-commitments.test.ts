import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import {
  CROSS_RUN_RESERVATION_MIN_GAP_MS,
  signupRepository,
} from "@/repositories/signup.repository";
import {
  deriveCharacterRunCommitmentState,
  getRunCommitmentsForCharacters,
  projectCharacterRunCommitment,
} from "@/services/character-run-commitment";
import { boosterQualificationService } from "@/services/booster-qualification.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";

const ids = {
  lead: "cccccccc-cccc-4ccc-8ccc-crc000000001",
  owner: "cccccccc-cccc-4ccc-8ccc-crc000000002",
  admin: "cccccccc-cccc-4ccc-8ccc-crc000000003",
  other: "cccccccc-cccc-4ccc-8ccc-crc000000004",
};

const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@crc.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
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

function futureIso(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

async function ensureUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  await orm.User.create({
    id,
    name,
    email: `${id}@crc.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).catch(() => {});
}

async function createCharacter(userId: string, name: string) {
  const id = crypto.randomUUID();
  createdCharacterIds.push(id);
  await orm.Character.create({
    id,
    userId,
    name,
    realm: "Commitment Lab",
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity("Commitment Lab"),
    region: "EU",
    wowClass: "WARRIOR",
    specialization: "Arms",
    primaryRole: "DPS",
    itemLevel: 700,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

async function cleanupRun(runId: string) {
  const roster = await orm.RunRoster.where({ runId }).first();
  if (roster) {
    const rosterId = (roster as { id: string }).id;
    const entries = await orm.RunRosterEntry.where({ rosterId }).all();
    for (const entry of entries) {
      await orm.RunRosterEntry.where({ id: (entry as { id: string }).id }).delete();
    }
    await orm.RunRoster.where({ id: rosterId }).delete();
  }
  const signups = await orm.RunSignup.where({ runId }).select("id").all();
  for (const row of signups) {
    await orm.RunSignupRole.where({ signupId: (row as { id: string }).id }).delete().catch(() => {});
    await orm.RunSignup.where({ id: (row as { id: string }).id }).delete().catch(() => {});
  }
  await orm.RunRaidContent.where({ runId }).delete().catch(() => {});
  await orm.Run.where({ id: runId }).delete().catch(() => {});
}

async function createOpenRun(lead: AuthenticatedUser, scheduledStartAt: string) {
  const run = await runService.createRun(
    lead,
    venomousCreateInput({
      scheduledStartAt,
      desiredTankCount: 0,
      desiredHealerCount: 0,
      desiredDpsCount: 1,
    }),
  );
  createdRunIds.push(run.id);
  await runService.openRun(lead, run.id);
  return run;
}

const lead = asUser(ids.lead, "CRC Lead", "RAID_LEAD");
const owner = asUser(ids.owner, "CRC Owner", "USER");
const admin = asUser(ids.admin, "CRC Admin", "ADMIN");
const other = asUser(ids.other, "CRC Other", "USER");

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  await ensureUser(ids.lead, "CRC Lead", "RAID_LEAD");
  await ensureUser(ids.owner, "CRC Owner", "USER");
  await ensureUser(ids.admin, "CRC Admin", "ADMIN");
  await ensureUser(ids.other, "CRC Other", "USER");
  await boosterQualificationService.grant(admin, { userId: ids.owner, difficulty: "HEROIC" }).catch(() => {});
  await boosterQualificationService.grant(admin, { userId: ids.other, difficulty: "HEROIC" }).catch(() => {});
});

afterAll(async () => {
  for (const runId of createdRunIds.splice(0)) {
    await cleanupRun(runId);
  }
  for (const id of createdCharacterIds.splice(0)) {
    await orm.Character.where({ id }).delete().catch(() => {});
  }
  await orm.BoosterQualification.where({ userId: ids.owner }).delete().catch(() => {});
  await orm.BoosterQualification.where({ userId: ids.other }).delete().catch(() => {});
});

describe("deriveCharacterRunCommitmentState", () => {
  it("maps SELECTED to COMMITTED and draft-only to RESERVED", () => {
    expect(deriveCharacterRunCommitmentState("SELECTED", false)).toBe("COMMITTED");
    expect(deriveCharacterRunCommitmentState("SELECTED", true)).toBe("COMMITTED");
    expect(deriveCharacterRunCommitmentState("PENDING", true)).toBe("RESERVED");
    expect(deriveCharacterRunCommitmentState("PENDING", false)).toBeNull();
    expect(deriveCharacterRunCommitmentState("WITHDRAWN", true)).toBeNull();
  });
});

describe("character run commitments (roster informational)", () => {
  it("exposes RESERVED for draft selection and COMMITTED for published SELECTED / IN_PROGRESS", async () => {
    const characterId = await createCharacter(ids.owner, "Crcdraft");
    const runDraft = await createOpenRun(lead, futureIso(48));
    const runPub = await createOpenRun(lead, futureIso(72));
    const runTarget = await createOpenRun(lead, futureIso(96));

    await signupService.createBoosterSignup(owner, {
      runId: runDraft.id,
      characterId,
      role: "DPS",
      isBackup: false,
    });
    const draftView = await rosterService.getRosterManagementView(lead, runDraft.id);
    const draftSignup = draftView.boosters.find((row) => row.character?.id === characterId)!;
    await rosterService.saveDraftSelection(lead, {
      runId: runDraft.id,
      version: draftView.roster.version,
      selections: [{ signupId: draftSignup.id, selectedRole: "DPS" }],
    });

    await signupService.createBoosterSignup(owner, {
      runId: runPub.id,
      characterId,
      role: "DPS",
      isBackup: false,
    });
    const pubView = await rosterService.getRosterManagementView(lead, runPub.id);
    const pubSignup = pubView.boosters.find((row) => row.character?.id === characterId)!;
    await rosterService.saveDraftSelection(lead, {
      runId: runPub.id,
      version: pubView.roster.version,
      selections: [{ signupId: pubSignup.id, selectedRole: "DPS" }],
    });
    await rosterService.publishRoster(lead, {
      runId: runPub.id,
      version: (await rosterService.getRosterManagementView(lead, runPub.id)).roster.version,
      acknowledgeWarnings: true,
    });

    await signupService.createBoosterSignup(owner, {
      runId: runTarget.id,
      characterId,
      role: "DPS",
      isBackup: false,
    });

    const targetView = await rosterService.getRosterManagementView(lead, runTarget.id);
    const row = targetView.boosters.find((item) => item.character?.id === characterId)!;
    expect(row.runCommitments.map((c) => c.runId).sort()).toEqual([runDraft.id, runPub.id].sort());
    expect(row.runCommitments.find((c) => c.runId === runDraft.id)?.state).toBe("RESERVED");
    expect(row.runCommitments.find((c) => c.runId === runPub.id)?.state).toBe("COMMITTED");
    expect(row.runCommitments.some((c) => c.runId === runTarget.id)).toBe(false);

    await orm.Run.where({ id: runPub.id }).update({ status: "IN_PROGRESS" });
    const afterStart = await rosterService.getRosterManagementView(lead, runTarget.id);
    const afterRow = afterStart.boosters.find((item) => item.character?.id === characterId)!;
    expect(afterRow.runCommitments.find((c) => c.runId === runPub.id)?.state).toBe("COMMITTED");
    expect(afterRow.runCommitments.find((c) => c.runId === runPub.id)?.runStatus).toBe("IN_PROGRESS");
  });

  it("hides COMPLETED and CANCELLED commitments", async () => {
    const characterId = await createCharacter(ids.owner, "Crcterm");
    const runDone = await createOpenRun(lead, futureIso(40));
    const runCancel = await createOpenRun(lead, futureIso(44));
    const runTarget = await createOpenRun(lead, futureIso(100));

    for (const run of [runDone, runCancel]) {
      await signupService.createBoosterSignup(owner, {
        runId: run.id,
        characterId,
        role: "DPS",
        isBackup: false,
      });
      const view = await rosterService.getRosterManagementView(lead, run.id);
      const signup = view.boosters.find((row) => row.character?.id === characterId)!;
      await rosterService.saveDraftSelection(lead, {
        runId: run.id,
        version: view.roster.version,
        selections: [{ signupId: signup.id, selectedRole: "DPS" }],
      });
      await rosterService.publishRoster(lead, {
        runId: run.id,
        version: (await rosterService.getRosterManagementView(lead, run.id)).roster.version,
        acknowledgeWarnings: true,
      });
    }

    await runService.cancelRun(lead, runCancel.id);
    await orm.Run.where({ id: runDone.id }).update({ status: "COMPLETED" });

    await signupService.createBoosterSignup(owner, {
      runId: runTarget.id,
      characterId,
      role: "DPS",
      isBackup: false,
    });
    const targetView = await rosterService.getRosterManagementView(lead, runTarget.id);
    const row = targetView.boosters.find((item) => item.character?.id === characterId)!;
    expect(row.runCommitments).toEqual([]);
  });

  it("shows non-conflicting commitments without schedule conflict and keeps selection allowed", async () => {
    expect(CROSS_RUN_RESERVATION_MIN_GAP_MS).toBe(2 * 60 * 60 * 1000);
    const characterId = await createCharacter(ids.owner, "Crcgap");
    const t0 = Date.now() + 50 * 60 * 60 * 1000;
    const runA = await createOpenRun(lead, new Date(t0).toISOString());
    const runB = await createOpenRun(lead, new Date(t0 + 3 * 60 * 60 * 1000).toISOString());

    await signupService.createBoosterSignup(owner, {
      runId: runA.id,
      characterId,
      role: "DPS",
      isBackup: false,
    });
    const viewA = await rosterService.getRosterManagementView(lead, runA.id);
    const signupA = viewA.boosters.find((row) => row.character?.id === characterId)!;
    await rosterService.saveDraftSelection(lead, {
      runId: runA.id,
      version: viewA.roster.version,
      selections: [{ signupId: signupA.id, selectedRole: "DPS" }],
    });
    await rosterService.publishRoster(lead, {
      runId: runA.id,
      version: (await rosterService.getRosterManagementView(lead, runA.id)).roster.version,
      acknowledgeWarnings: true,
    });

    await signupService.createBoosterSignup(owner, {
      runId: runB.id,
      characterId,
      role: "DPS",
      isBackup: false,
    });
    const viewB = await rosterService.getRosterManagementView(lead, runB.id);
    const rowB = viewB.boosters.find((item) => item.character?.id === characterId)!;
    expect(rowB.runCommitments).toHaveLength(1);
    expect(rowB.runCommitments[0]?.state).toBe("COMMITTED");
    expect(rowB.scheduleConflicts).toEqual([]);

    await rosterService.saveDraftSelection(lead, {
      runId: runB.id,
      version: viewB.roster.version,
      selections: [{ signupId: rowB.id, selectedRole: "DPS" }],
    });
    const saved = await rosterService.getRosterManagementView(lead, runB.id);
    expect(saved.boosters.find((item) => item.id === rowB.id)?.draftSelected).toBe(true);
  });

  it("allows exactly 2h gap with commitment visible and no schedule conflict", async () => {
    const characterId = await createCharacter(ids.owner, "Crc2h");
    const t0 = Date.now() + 55 * 60 * 60 * 1000;
    const runA = await createOpenRun(lead, new Date(t0).toISOString());
    const runB = await createOpenRun(lead, new Date(t0 + CROSS_RUN_RESERVATION_MIN_GAP_MS).toISOString());

    await signupService.createBoosterSignup(owner, {
      runId: runA.id,
      characterId,
      role: "DPS",
      isBackup: false,
    });
    const viewA = await rosterService.getRosterManagementView(lead, runA.id);
    const signupA = viewA.boosters.find((row) => row.character?.id === characterId)!;
    await rosterService.saveDraftSelection(lead, {
      runId: runA.id,
      version: viewA.roster.version,
      selections: [{ signupId: signupA.id, selectedRole: "DPS" }],
    });

    await signupService.createBoosterSignup(owner, {
      runId: runB.id,
      characterId,
      role: "DPS",
      isBackup: false,
    });
    const viewB = await rosterService.getRosterManagementView(lead, runB.id);
    const rowB = viewB.boosters.find((item) => item.character?.id === characterId)!;
    expect(rowB.runCommitments).toHaveLength(1);
    expect(rowB.scheduleConflicts).toEqual([]);
    await rosterService.saveDraftSelection(lead, {
      runId: runB.id,
      version: viewB.roster.version,
      selections: [{ signupId: rowB.id, selectedRole: "DPS" }],
    });
  });

  it("keeps schedule conflict blocking when another commitment is within 2h", async () => {
    const characterId = await createCharacter(ids.owner, "Crc1h");
    const t0 = Date.now() + 60 * 60 * 60 * 1000;
    const runA = await createOpenRun(lead, new Date(t0).toISOString());
    const runB = await createOpenRun(lead, new Date(t0 + 60 * 60 * 1000).toISOString());

    // Sign up both first — eligibility blocks a second signup after draft-select
    // when the gap is under 2h (unchanged reservation rule).
    await signupService.createBoosterSignup(owner, {
      runId: runA.id,
      characterId,
      role: "DPS",
      isBackup: false,
    });
    await signupService.createBoosterSignup(owner, {
      runId: runB.id,
      characterId,
      role: "DPS",
      isBackup: false,
    });

    const viewA = await rosterService.getRosterManagementView(lead, runA.id);
    const signupA = viewA.boosters.find((row) => row.character?.id === characterId)!;
    await rosterService.saveDraftSelection(lead, {
      runId: runA.id,
      version: viewA.roster.version,
      selections: [{ signupId: signupA.id, selectedRole: "DPS" }],
    });

    const viewB = await rosterService.getRosterManagementView(lead, runB.id);
    const rowB = viewB.boosters.find((item) => item.character?.id === characterId)!;
    expect(rowB.runCommitments).toHaveLength(1);
    expect(rowB.scheduleConflicts.some((c) => c.source === "RUN_RESERVATION")).toBe(true);

    await expectDomainCode(
      rosterService.saveDraftSelection(lead, {
        runId: runB.id,
        version: viewB.roster.version,
        selections: [{ signupId: rowB.id, selectedRole: "DPS" }],
      }),
      "CHARACTER_SCHEDULE_CONFLICT",
    );
  });

  it("returns multiple commitments in deterministic order", async () => {
    const characterId = await createCharacter(ids.owner, "Crcmulti");
    const t0 = Date.now() + 70 * 60 * 60 * 1000;
    const runLate = await createOpenRun(lead, new Date(t0 + 6 * 60 * 60 * 1000).toISOString());
    const runEarly = await createOpenRun(lead, new Date(t0).toISOString());
    const runTarget = await createOpenRun(lead, new Date(t0 + 12 * 60 * 60 * 1000).toISOString());

    for (const run of [runLate, runEarly]) {
      await signupService.createBoosterSignup(owner, {
        runId: run.id,
        characterId,
        role: "DPS",
        isBackup: false,
      });
      const view = await rosterService.getRosterManagementView(lead, run.id);
      const signup = view.boosters.find((row) => row.character?.id === characterId)!;
      await rosterService.saveDraftSelection(lead, {
        runId: run.id,
        version: view.roster.version,
        selections: [{ signupId: signup.id, selectedRole: "DPS" }],
      });
    }

    await signupService.createBoosterSignup(owner, {
      runId: runTarget.id,
      characterId,
      role: "DPS",
      isBackup: false,
    });
    const targetView = await rosterService.getRosterManagementView(lead, runTarget.id);
    const row = targetView.boosters.find((item) => item.character?.id === characterId)!;
    expect(row.runCommitments.map((c) => c.runId)).toEqual([runEarly.id, runLate.id]);
  });

  it("returns empty commitments for characterless lootbuddy cards", async () => {
    const run = await createOpenRun(lead, futureIso(80));
    await signupService.setLootbuddies(owner, {
      runId: run.id,
      lootbuddies: [{ wowClass: "MAGE", mode: "LOOT_ONLY", verification: "NONE" }],
    });
    const view = await rosterService.getRosterManagementView(lead, run.id);
    const lootbuddy = view.groups.lootbuddies.find((row) => row.participationType === "LOOTBUDDY")!;
    expect(lootbuddy.runCommitments).toEqual([]);
  });

  it("keeps published COMMITTED while a replacement draft deselects the Character", async () => {
    const characterId = await createCharacter(ids.owner, "Crcpubdraft");
    const runA = await createOpenRun(lead, futureIso(85));
    const runTarget = await createOpenRun(lead, futureIso(110));

    await signupService.createBoosterSignup(owner, {
      runId: runA.id,
      characterId,
      role: "DPS",
      isBackup: false,
    });
    const viewA = await rosterService.getRosterManagementView(lead, runA.id);
    const signupA = viewA.boosters.find((row) => row.character?.id === characterId)!;
    await rosterService.saveDraftSelection(lead, {
      runId: runA.id,
      version: viewA.roster.version,
      selections: [{ signupId: signupA.id, selectedRole: "DPS" }],
    });
    await rosterService.publishRoster(lead, {
      runId: runA.id,
      version: (await rosterService.getRosterManagementView(lead, runA.id)).roster.version,
      acknowledgeWarnings: true,
    });

    const published = await rosterService.getRosterManagementView(lead, runA.id);
    await rosterService.preparePublishedRosterForEditing(lead, {
      runId: runA.id,
      version: published.roster.version,
    });
    const editing = await rosterService.getRosterManagementView(lead, runA.id);
    await rosterService.saveDraftSelection(lead, {
      runId: runA.id,
      version: editing.roster.version,
      selections: [],
    });

    await signupService.createBoosterSignup(owner, {
      runId: runTarget.id,
      characterId,
      role: "DPS",
      isBackup: false,
    });
    const targetView = await rosterService.getRosterManagementView(lead, runTarget.id);
    const row = targetView.boosters.find((item) => item.character?.id === characterId)!;
    expect(row.runCommitments).toHaveLength(1);
    expect(row.runCommitments[0]?.state).toBe("COMMITTED");
    expect(row.runCommitments[0]?.runId).toBe(runA.id);
    expect(published.boosters.find((item) => item.id === signupA.id)?.status).toBe("SELECTED");
  });

  it("drops the commitment after republish without the Character", async () => {
    const characterId = await createCharacter(ids.owner, "Crcgone");
    const otherChar = await createCharacter(ids.other, "Crcfill");
    const runA = await createOpenRun(lead, futureIso(90));
    const runTarget = await createOpenRun(lead, futureIso(120));

    await signupService.createBoosterSignup(owner, {
      runId: runA.id,
      characterId,
      role: "DPS",
      isBackup: false,
    });
    await signupService.createBoosterSignup(other, {
      runId: runA.id,
      characterId: otherChar,
      role: "DPS",
      isBackup: false,
    });
    const viewA = await rosterService.getRosterManagementView(lead, runA.id);
    const signupOwner = viewA.boosters.find((row) => row.character?.id === characterId)!;
    const signupOther = viewA.boosters.find((row) => row.character?.id === otherChar)!;
    await rosterService.saveDraftSelection(lead, {
      runId: runA.id,
      version: viewA.roster.version,
      selections: [{ signupId: signupOwner.id, selectedRole: "DPS" }],
    });
    await rosterService.publishRoster(lead, {
      runId: runA.id,
      version: (await rosterService.getRosterManagementView(lead, runA.id)).roster.version,
      acknowledgeWarnings: true,
    });

    const afterPublish = await rosterService.getRosterManagementView(lead, runA.id);
    await rosterService.preparePublishedRosterForEditing(lead, {
      runId: runA.id,
      version: afterPublish.roster.version,
    });
    const editing = await rosterService.getRosterManagementView(lead, runA.id);
    await rosterService.saveDraftSelection(lead, {
      runId: runA.id,
      version: editing.roster.version,
      selections: [{ signupId: signupOther.id, selectedRole: "DPS" }],
    });
    await rosterService.publishRoster(lead, {
      runId: runA.id,
      version: (await rosterService.getRosterManagementView(lead, runA.id)).roster.version,
      acknowledgeWarnings: true,
    });

    await signupService.createBoosterSignup(owner, {
      runId: runTarget.id,
      characterId,
      role: "DPS",
      isBackup: false,
    });
    const targetView = await rosterService.getRosterManagementView(lead, runTarget.id);
    const row = targetView.boosters.find((item) => item.character?.id === characterId)!;
    expect(row.runCommitments).toEqual([]);
  });

  it("batches commitment lookup once for multiple Characters (no N+1)", async () => {
    const charA = await createCharacter(ids.owner, "Crcn1a");
    const charB = await createCharacter(ids.other, "Crcn1b");
    const runOther = await createOpenRun(lead, futureIso(130));
    const runTarget = await createOpenRun(lead, futureIso(150));

    for (const [user, characterId] of [
      [owner, charA],
      [other, charB],
    ] as const) {
      await signupService.createBoosterSignup(user, {
        runId: runOther.id,
        characterId,
        role: "DPS",
        isBackup: false,
      });
      await signupService.createBoosterSignup(user, {
        runId: runTarget.id,
        characterId,
        role: "DPS",
        isBackup: false,
      });
    }

    const otherView = await rosterService.getRosterManagementView(lead, runOther.id);
    await rosterService.saveDraftSelection(lead, {
      runId: runOther.id,
      version: otherView.roster.version,
      selections: otherView.boosters
        .filter((row) => row.character?.id === charA || row.character?.id === charB)
        .map((row) => ({ signupId: row.id, selectedRole: "DPS" as const })),
    });

    const spy = vi.spyOn(signupRepository, "listReservingCommitmentsByCharacterIds");
    const targetView = await rosterService.getRosterManagementView(lead, runTarget.id);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(targetView.boosters.find((row) => row.character?.id === charA)?.runCommitments).toHaveLength(1);
    expect(targetView.boosters.find((row) => row.character?.id === charB)?.runCommitments).toHaveLength(1);
    spy.mockRestore();
  });
});

describe("projectCharacterRunCommitment", () => {
  it("projects repository rows into the roster DTO", () => {
    const projected = projectCharacterRunCommitment({
      signupId: "s1",
      characterId: "c1",
      status: "PENDING",
      draftSelected: true,
      selectedRole: "DPS",
      publishedRole: null,
      run: {
        id: "r1",
        title: "Title",
        status: "ROSTERING",
        difficulty: "HEROIC",
        scheduledStartAt: "2026-11-01T20:00:00.000Z",
        productLabel: "Season 2 Bundle",
        contentSummary: "summary",
      },
    });
    expect(projected).toEqual({
      runId: "r1",
      runTitle: "Title",
      productLabel: "Season 2 Bundle",
      difficulty: "HEROIC",
      scheduledStartAt: "2026-11-01T20:00:00.000Z",
      runStatus: "ROSTERING",
      state: "RESERVED",
    });
  });
});

describe("getRunCommitmentsForCharacters empty input", () => {
  it("returns an empty map with no query characters", async () => {
    const map = await getRunCommitmentsForCharacters({ characterIds: [], excludeRunId: "x" });
    expect([...map.keys()]).toEqual([]);
  });
});
