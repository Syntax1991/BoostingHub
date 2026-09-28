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
  isSameRaidIdForCharacter,
  projectCharacterRunCommitment,
} from "@/services/character-run-commitment";
import { regionalWeeklyResetStart } from "@/lib/wow-weekly-reset";
import type { WowRegion } from "@/models/enums";
import { boostingRoleService } from "@/services/boosting-role.service";
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

const HOUR = 60 * 60 * 1000;
/**
 * Start of one EU raid ID (Wednesday 04:00 UTC) at least a week ahead. Every Run
 * in this file is placed relative to it, so "same raid ID" never depends on
 * the weekday the tests run (commitments are raid-ID scoped).
 */
const EU_WEEK = regionalWeeklyResetStart("EU", new Date(Date.now() + 14 * 24 * HOUR)).getTime();

/** Hours after EU_WEEK's reset (0–167 = the same EU raid ID). */
function futureIso(hoursIntoWeek: number) {
  return new Date(EU_WEEK + hoursIntoWeek * HOUR).toISOString();
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

async function createCharacter(userId: string, name: string, region: WowRegion = "EU") {
  const id = crypto.randomUUID();
  createdCharacterIds.push(id);
  await orm.Character.create({
    id,
    userId,
    name,
    realm: "Commitment Lab",
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity("Commitment Lab"),
    region,
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
  await boostingRoleService.setRole(admin, { userId: ids.owner, role: "BOOSTER", enabled: true }).catch(() => {});
  await boostingRoleService.setRole(admin, { userId: ids.other, role: "BOOSTER", enabled: true }).catch(() => {});
});

afterAll(async () => {
  for (const runId of createdRunIds.splice(0)) {
    await cleanupRun(runId);
  }
  for (const id of createdCharacterIds.splice(0)) {
    await orm.Character.where({ id }).delete().catch(() => {});
  }
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
    const t0 = EU_WEEK + 50 * HOUR;
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
    const t0 = EU_WEEK + 55 * HOUR;
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
    const t0 = EU_WEEK + 60 * HOUR;
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
    const t0 = EU_WEEK + 70 * HOUR;
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
    const map = await getRunCommitmentsForCharacters({ characters: [], excludeRunId: "x", targetScheduledStartAt: "2026-11-01T20:00:00.000Z" });
    expect([...map.keys()]).toEqual([]);
  });
});

describe("commitments are scoped to the target Run's raid ID (not the 2h conflict window)", () => {
  /**
   * Character signed up on both Runs, draft-selected (RESERVED) on `otherAt`,
   * optionally published (COMMITTED); returns the Character's row on the target roster.
   */
  async function rowOnTarget(input: { name: string; otherAt: number; targetAt: number; publish?: boolean; region?: WowRegion }) {
    const characterId = await createCharacter(ids.owner, input.name, input.region);
    const runOther = await createOpenRun(lead, new Date(input.otherAt).toISOString());
    const runTarget = await createOpenRun(lead, new Date(input.targetAt).toISOString());
    for (const runId of [runOther.id, runTarget.id]) {
      await signupService.createBoosterSignup(owner, { runId, characterId, role: "DPS", isBackup: false });
    }
    const otherView = await rosterService.getRosterManagementView(lead, runOther.id);
    await rosterService.saveDraftSelection(lead, {
      runId: runOther.id,
      version: otherView.roster.version,
      selections: [{ signupId: otherView.boosters.find((row) => row.character?.id === characterId)!.id, selectedRole: "DPS" }],
    });
    if (input.publish) {
      await rosterService.publishRoster(lead, {
        runId: runOther.id,
        version: (await rosterService.getRosterManagementView(lead, runOther.id)).roster.version,
        acknowledgeWarnings: true,
      });
    }
    const view = await rosterService.getRosterManagementView(lead, runTarget.id);
    return { row: view.boosters.find((row) => row.character?.id === characterId)!, runOther, runTarget, characterId };
  }

  it("A: same raid ID, draft-selected elsewhere → Reserved elsewhere", async () => {
    const { row, runOther } = await rowOnTarget({ name: "Crcida", otherAt: EU_WEEK + 10 * HOUR, targetAt: EU_WEEK + 60 * HOUR });
    expect(row.runCommitments.map((c) => [c.runId, c.state])).toEqual([[runOther.id, "RESERVED"]]);
    expect(row.scheduleConflicts).toEqual([]);
  });

  it("B: same raid ID, published SELECTED elsewhere → Committed elsewhere", async () => {
    const { row } = await rowOnTarget({ name: "Crcidb", otherAt: EU_WEEK + 12 * HOUR, targetAt: EU_WEEK + 62 * HOUR, publish: true });
    expect(row.runCommitments.map((c) => c.state)).toEqual(["COMMITTED"]);
  });

  it("C: other Run in the current raid ID, target in the next (production: Tue 21:30 UTC reserved, target Mon next week)", async () => {
    // Synmist: reserved Tue 29/09 23:30 CEST (21:30 UTC, before Wed 04:00 UTC reset); target roster Mon 05/10 17:30 UTC.
    const otherAt = EU_WEEK + (6 * 24 + 17.5) * HOUR; // Tuesday 21:30 UTC
    const targetAt = EU_WEEK + (7 * 24 + 5 * 24 + 13.5) * HOUR; // next Monday 17:30 UTC
    const { row } = await rowOnTarget({ name: "Crcidc", otherAt, targetAt });
    expect(row.runCommitments).toEqual([]);
    expect(row.scheduleConflicts).toEqual([]);
    // Published SELECTED in the previous raid ID is not "Committed elsewhere" either.
    const committed = await rowOnTarget({ name: "Crcidc2", otherAt: otherAt - 2 * HOUR, targetAt, publish: true });
    expect(committed.row.runCommitments).toEqual([]);
  });

  it("D: other Run in the next raid ID → not shown on a target in the current one", async () => {
    const { row } = await rowOnTarget({ name: "Crcidd", otherAt: EU_WEEK + (7 * 24 + 20) * HOUR, targetAt: EU_WEEK + 40 * HOUR });
    expect(row.runCommitments).toEqual([]);
  });

  it("E: same raid ID six days apart → shown (reset-based), no schedule conflict (>= 2h)", async () => {
    const { row } = await rowOnTarget({ name: "Crcide", otherAt: EU_WEEK + 2 * HOUR, targetAt: EU_WEEK + 150 * HOUR });
    expect(row.runCommitments).toHaveLength(1);
    expect(row.scheduleConflicts).toEqual([]);
  });

  it("F: across the reset but < 2h apart → no commitment shown, the schedule conflict still blocks", async () => {
    const reset = EU_WEEK + 7 * 24 * HOUR; // next Wednesday 04:00 UTC
    const { row, runTarget } = await rowOnTarget({ name: "Crcidf", otherAt: reset - HOUR, targetAt: reset + 30 * 60 * 1000 });
    expect(row.runCommitments).toEqual([]);
    expect(row.scheduleConflicts.some((c) => c.source === "RUN_RESERVATION")).toBe(true);
    await expectDomainCode(
      rosterService.saveDraftSelection(lead, {
        runId: runTarget.id,
        version: (await rosterService.getRosterManagementView(lead, runTarget.id)).roster.version,
        selections: [{ signupId: row.id, selectedRole: "DPS" }],
      }),
      "CHARACTER_SCHEDULE_CONFLICT",
    );
  });

  it("G: each Character uses its own region's reset (US resets Tuesday 15:00 UTC, EU Wednesday 04:00 UTC)", async () => {
    const tuesday14 = EU_WEEK + (6 * 24 + 10) * HOUR; // Tue 14:00 UTC — before the US reset
    const tuesday16 = tuesday14 + 2 * HOUR; // Tue 16:00 UTC — after it; exactly 2h: no schedule conflict
    const eu = await rowOnTarget({ name: "Crcideu", otherAt: tuesday14, targetAt: tuesday16, region: "EU" });
    const us = await rowOnTarget({ name: "Crcidus", otherAt: tuesday14, targetAt: tuesday16, region: "US" });
    expect(eu.row.runCommitments).toHaveLength(1); // same EU raid ID
    expect(us.row.runCommitments).toEqual([]); // the US raid ID changed in between
    expect(isSameRaidIdForCharacter("EU", new Date(tuesday14).toISOString(), new Date(tuesday16).toISOString())).toBe(true);
    expect(isSameRaidIdForCharacter("US", new Date(tuesday14).toISOString(), new Date(tuesday16).toISOString())).toBe(false);
  });

  it("H: the target Run is never its own commitment", async () => {
    const { runTarget, characterId } = await rowOnTarget({ name: "Crcidh", otherAt: EU_WEEK + 20 * HOUR, targetAt: EU_WEEK + 80 * HOUR });
    const targetView = await rosterService.getRosterManagementView(lead, runTarget.id);
    await rosterService.saveDraftSelection(lead, {
      runId: runTarget.id,
      version: targetView.roster.version,
      selections: [{ signupId: targetView.boosters.find((row) => row.character?.id === characterId)!.id, selectedRole: "DPS" }],
    });
    const map = await getRunCommitmentsForCharacters({
      characters: [{ id: characterId, region: "EU" }],
      excludeRunId: runTarget.id,
      targetScheduledStartAt: new Date(EU_WEEK + 80 * HOUR).toISOString(),
    });
    expect(map.get(characterId)?.map((c) => c.runId)).not.toContain(runTarget.id);
  });

  it("reads all Characters' commitments in one repository call", async () => {
    const spy = vi.spyOn(signupRepository, "listReservingCommitmentsByCharacterIds");
    await getRunCommitmentsForCharacters({
      characters: [
        { id: crypto.randomUUID(), region: "EU" },
        { id: crypto.randomUUID(), region: "US" },
      ],
      excludeRunId: crypto.randomUUID(),
      targetScheduledStartAt: new Date(EU_WEEK).toISOString(),
    });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("isSameRaidIdForCharacter", () => {
  it("compares regional reset windows, not calendar weeks or dates", () => {
    // EU: Tue 23:00 UTC and Wed 03:59 UTC share a raid ID; Wed 04:00 starts the next.
    expect(isSameRaidIdForCharacter("EU", "2026-09-29T23:00:00.000Z", "2026-09-30T03:59:00.000Z")).toBe(true);
    expect(isSameRaidIdForCharacter("EU", "2026-09-30T03:59:00.000Z", "2026-09-30T04:00:00.000Z")).toBe(false);
    // Synmist production case: Tue 29/09 21:30 UTC vs Mon 05/10 17:30 UTC.
    expect(isSameRaidIdForCharacter("EU", "2026-09-29T21:30:00.000Z", "2026-10-05T17:30:00.000Z")).toBe(false);
    // Same calendar week (Mon + Thu) but across the Wednesday reset → different raid IDs.
    expect(isSameRaidIdForCharacter("EU", "2026-09-28T20:00:00.000Z", "2026-10-01T20:00:00.000Z")).toBe(false);
    // Different calendar weeks (Thu + next Mon) but one raid ID.
    expect(isSameRaidIdForCharacter("EU", "2026-10-01T20:00:00.000Z", "2026-10-05T20:00:00.000Z")).toBe(true);
    // Across the winter-time change (last Sunday of October): still UTC reset instants.
    expect(isSameRaidIdForCharacter("EU", "2026-10-22T20:00:00.000Z", "2026-10-27T20:00:00.000Z")).toBe(true);
  });
});
