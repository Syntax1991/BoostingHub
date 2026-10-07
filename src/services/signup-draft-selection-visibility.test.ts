import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { orm } from "@/lib/prisma";
import { venomousCreateInput } from "@/lib/test-run-input";
import { attendanceRepository } from "@/repositories/attendance.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { userNotificationRepository } from "@/repositories/user-notification.repository";
import { boostingRoleService } from "@/services/boosting-role.service";
import { characterService } from "@/services/character.service";
import { rosterBuilderService } from "@/services/roster-builder.service";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";

const ids = {
  owner: "dddddddd-dddd-4ddd-8ddd-dsv000000001",
  other: "dddddddd-dddd-4ddd-8ddd-dsv000000002",
  lead: "dddddddd-dddd-4ddd-8ddd-dsv000000003",
  admin: "dddddddd-dddd-4ddd-8ddd-dsv000000004",
};

const createdCharacterIds: string[] = [];
const createdRunIds: string[] = [];
let nameSeq = 0;

function charName(prefix: string) {
  nameSeq += 1;
  // Letters only (WoW name rules); unique within this suite run.
  return `${prefix}${String.fromCharCode(96 + (nameSeq % 26 || 26))}${String.fromCharCode(96 + ((nameSeq * 3) % 26 || 26))}`.slice(
    0,
    12,
  );
}

function asUser(
  id: string,
  name: string,
  accountRole: AuthenticatedUser["accountRole"] = "USER",
): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@dsv.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

async function ensureUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  await orm.User.create({
    id,
    name,
    email: `${id}@dsv.boostting.local`,
    emailVerified: false,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).catch(() => {});
}

async function createOpenRun(
  lead: AuthenticatedUser,
  scheduledStartAt: string,
  targets: { tanks?: number; healers?: number; dps?: number } = {},
) {
  const run = await runService.createRun(
    lead,
    venomousCreateInput({
      scheduledStartAt,
      desiredTankCount: targets.tanks ?? 0,
      desiredHealerCount: targets.healers ?? 1,
      desiredDpsCount: targets.dps ?? 0,
    }),
  );
  createdRunIds.push(run.id);
  await runService.openRun(lead, run.id);
  return run;
}

async function cleanupRun(runId: string) {
  await orm.RunAttendance.where({ runId }).delete().catch(() => {});
  await orm.UserNotification.where({ runId }).delete().catch(() => {});
  const roster = await orm.RunRoster.where({ runId }).first();
  if (roster) {
    const rosterId = (roster as { id: string }).id;
    await orm.RunExternalBooster.where({ rosterId }).delete().catch(() => {});
    await orm.RunRosterEntry.where({ rosterId }).delete().catch(() => {});
    await orm.RunRoster.where({ id: rosterId }).delete().catch(() => {});
  }
  const signups = (await orm.RunSignup.where({ runId }).all()) as Array<{ id: string }>;
  for (const signup of signups) {
    await orm.RunSignupRole.where({ signupId: signup.id }).delete().catch(() => {});
  }
  await orm.RunSignup.where({ runId }).delete().catch(() => {});
  await orm.RunRaidContent.where({ runId }).delete().catch(() => {});
  await orm.Run.where({ id: runId }).delete().catch(() => {});
}

const owner = asUser(ids.owner, "DSV Owner");
const other = asUser(ids.other, "DSV Other");
const lead = asUser(ids.lead, "DSV Lead", "RAID_LEAD");
const admin = asUser(ids.admin, "DSV Admin", "ADMIN");

beforeAll(async () => {
  await ensureUser(ids.owner, "DSV Owner", "USER");
  await ensureUser(ids.other, "DSV Other", "USER");
  await ensureUser(ids.lead, "DSV Lead", "RAID_LEAD");
  await ensureUser(ids.admin, "DSV Admin", "ADMIN");
  await boostingRoleService.setRole(admin, { userId: ids.owner, role: "BOOSTER", enabled: true }).catch(() => {});
  await boostingRoleService.setRole(admin, { userId: ids.other, role: "BOOSTER", enabled: true }).catch(() => {});
  // Prior failed runs may leave Characters for this fixture owner.
  const leftover = (await orm.Character.where({ userId: ids.owner }).all()) as Array<{ id: string }>;
  for (const row of leftover) {
    await orm.Character.where({ id: row.id }).delete().catch(() => {});
  }
});

afterAll(async () => {
  for (const runId of createdRunIds) {
    await cleanupRun(runId);
  }
  for (const id of createdCharacterIds) {
    await orm.Character.where({ id }).delete().catch(() => {});
  }
});

describe("draft selection user visibility", () => {
  it("signup only stays offered; manual draft select/deselect/change/publish update projection", async () => {
    const charA = await characterService.createCharacter(owner, {
      name: charName("Dsvmist"),
      realm: "Antonidas",
      region: "EU",
      wowClass: "PRIEST",
      specialization: "Holy",
      itemLevel: 640,
    });
    const charB = await characterService.createCharacter(owner, {
      name: charName("Dsvlight"),
      realm: "Antonidas",
      region: "EU",
      wowClass: "PRIEST",
      specialization: "Discipline",
      itemLevel: 640,
    });
    const charC = await characterService.createCharacter(owner, {
      name: charName("Dsvbloom"),
      realm: "Antonidas",
      region: "EU",
      wowClass: "DRUID",
      specialization: "Restoration",
      itemLevel: 640,
    });
    createdCharacterIds.push(charA.id, charB.id, charC.id);

    const run = await createOpenRun(lead, "2026-12-01T18:00:00.000Z", { healers: 1 });

    const offerA = await signupService.createBoosterSignup(owner, {
      runId: run.id,
      characterId: charA.id,
      role: "HEALER",
      isBackup: false,
    });
    const offerB = await signupService.createBoosterSignup(owner, {
      runId: run.id,
      characterId: charB.id,
      role: "HEALER",
      isBackup: false,
    });
    const offerC = await signupService.createBoosterSignup(owner, {
      runId: run.id,
      characterId: charC.id,
      role: "HEALER",
      isBackup: false,
    });
    const notesBeforeDraft = await userNotificationRepository.listForUser(ids.owner);

    let mine = await signupService.getMyRuns(owner);
    expect(mine.pending.filter((row) => row.runId === run.id)).toHaveLength(3);
    expect(mine.selected.filter((row) => row.runId === run.id)).toHaveLength(0);
    expect(
      mine.pending.filter((row) => row.runId === run.id).every((row) => row.selectionState === "OFFERED"),
    ).toBe(true);

    let detail = await signupService.listOwnForRun(owner, run.id);
    expect(detail.every((row) => row.selectionState === "OFFERED")).toBe(true);

    const before = await rosterService.getRosterManagementView(lead, run.id);
    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: before.roster.version,
      selections: [{ signupId: offerA.id, selectedRole: "HEALER" }],
    });

    mine = await signupService.getMyRuns(owner);
    const draftSelected = mine.selected.filter((row) => row.runId === run.id);
    const stillPending = mine.pending.filter((row) => row.runId === run.id);
    expect(draftSelected).toHaveLength(1);
    expect(draftSelected[0]?.id).toBe(offerA.id);
    expect(draftSelected[0]?.selectionState).toBe("DRAFT");
    expect(draftSelected[0]?.displayRole).toBe("HEALER");
    expect(draftSelected[0]?.status).toBe("PENDING");
    expect(stillPending).toHaveLength(2);
    expect(stillPending.every((row) => row.selectionState === "OFFERED")).toBe(true);

    detail = await signupService.listOwnForRun(owner, run.id);
    expect(detail.find((row) => row.id === offerA.id)?.selectionState).toBe("DRAFT");
    expect(detail.filter((row) => row.selectionState === "DRAFT")).toHaveLength(1);

    const otherMine = await signupService.getMyRuns(other);
    expect([...otherMine.pending, ...otherMine.selected].some((row) => row.runId === run.id)).toBe(
      false,
    );

    const runAfterDraft = await runRepository.findById(run.id);
    // Existing draft-save may advance OPEN → ROSTERING; must not publish/start/complete.
    expect(["OPEN", "ROSTERING"]).toContain(runAfterDraft?.status);
    expect(runAfterDraft?.status).not.toBe("PUBLISHED");
    expect(await attendanceRepository.listByRunId(run.id)).toHaveLength(0);
    const notesAfterDraft = await userNotificationRepository.listForUser(ids.owner);
    // Established Save Roster path already emits ROSTER_SELECTED on draft save —
    // leave that unchanged; draft visibility must not invent publish-only types.
    const newNotes = notesAfterDraft.filter(
      (row) => !notesBeforeDraft.some((before) => before.id === row.id),
    );
    expect(newNotes.every((row) => row.type === "ROSTER_SELECTED")).toBe(true);

    const mid = await rosterService.getRosterManagementView(lead, run.id);
    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: mid.roster.version,
      selections: [{ signupId: offerB.id, selectedRole: "HEALER" }],
    });

    mine = await signupService.getMyRuns(owner);
    expect(mine.selected.filter((row) => row.runId === run.id).map((row) => row.id)).toEqual([
      offerB.id,
    ]);
    expect(mine.pending.filter((row) => row.runId === run.id).map((row) => row.id).sort()).toEqual(
      [offerA.id, offerC.id].sort(),
    );

    const cleared = await rosterService.getRosterManagementView(lead, run.id);
    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: cleared.roster.version,
      selections: [],
    });

    mine = await signupService.getMyRuns(owner);
    expect(mine.selected.filter((row) => row.runId === run.id)).toHaveLength(0);
    expect(mine.pending.filter((row) => row.runId === run.id)).toHaveLength(3);

    const reselect = await rosterService.getRosterManagementView(lead, run.id);
    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: reselect.roster.version,
      selections: [{ signupId: offerA.id, selectedRole: "HEALER" }],
    });

    const publishedView = await rosterService.getRosterManagementView(lead, run.id);
    await rosterService.publishRoster(lead, {
      runId: run.id,
      version: publishedView.roster.version,
      acknowledgeWarnings: true,
    });

    mine = await signupService.getMyRuns(owner);
    const publishedSelected = mine.selected.filter((row) => row.runId === run.id);
    expect(publishedSelected).toHaveLength(1);
    expect(publishedSelected[0]?.id).toBe(offerA.id);
    expect(publishedSelected[0]?.selectionState).toBe("PUBLISHED");
    expect(publishedSelected[0]?.status).toBe("SELECTED");
    expect(mine.pending.filter((row) => row.runId === run.id)).toHaveLength(0);
    expect(mine.notSelected.filter((row) => row.runId === run.id)).toHaveLength(2);
    // Same Run appears once in selected — no duplicate selected entry after publish.
    expect(publishedSelected.map((row) => row.id)).toEqual([offerA.id]);
  });

  it("offspec draft role is shown, not character primary role", async () => {
    const character = await characterService.createCharacter(owner, {
      name: charName("Dsvoff"),
      realm: "Antonidas",
      region: "EU",
      wowClass: "PRIEST",
      specialization: "Holy",
      playableSpecs: ["Shadow"],
      itemLevel: 640,
    });
    createdCharacterIds.push(character.id);

    const run = await createOpenRun(lead, "2026-12-02T18:00:00.000Z", { healers: 0, dps: 1 });
    const signup = await signupService.createBoosterSignup(owner, {
      runId: run.id,
      characterId: character.id,
      role: "RANGED_DPS",
      isBackup: false,
    });

    const before = await rosterService.getRosterManagementView(lead, run.id);
    await rosterService.saveDraftSelection(lead, {
      runId: run.id,
      version: before.roster.version,
      selections: [{ signupId: signup.id, selectedRole: "RANGED_DPS" }],
    });

    const mine = await signupService.getMyRuns(owner);
    const selected = mine.selected.find((row) => row.id === signup.id);
    expect(selected?.selectionState).toBe("DRAFT");
    expect(selected?.displayRole).toBe("RANGED_DPS");
    expect(character.primaryRole).toBe("HEALER");
  });

  it("Auto Build Apply surfaces SELECTED_DRAFT without publish", async () => {
    const healer = await characterService.createCharacter(owner, {
      name: charName("Dsvauto"),
      realm: "Antonidas",
      region: "EU",
      wowClass: "PRIEST",
      specialization: "Holy",
      itemLevel: 640,
    });
    createdCharacterIds.push(healer.id);

    const run = await createOpenRun(lead, "2026-12-03T18:00:00.000Z", { healers: 1, dps: 0 });
    const signup = await signupService.createBoosterSignup(owner, {
      runId: run.id,
      characterId: healer.id,
      role: "HEALER",
      isBackup: false,
    });

    const proposal = await rosterBuilderService.proposeRoster(lead, run.id);
    expect(proposal.applySelections.some((row) => row.signupId === signup.id)).toBe(true);

    await rosterBuilderService.applyRosterProposal(lead, {
      runId: run.id,
      expectedVersion: proposal.rosterVersion,
      selections: proposal.applySelections,
    });

    const roster = await rosterRepository.findByRunId(run.id);
    expect(roster?.publishedAt).toBeNull();

    const mine = await signupService.getMyRuns(owner);
    const selected = mine.selected.find((row) => row.id === signup.id);
    expect(selected?.selectionState).toBe("DRAFT");
    expect(selected?.displayRole).toBe("HEALER");
    expect(selected?.status).toBe("PENDING");

    expect(await attendanceRepository.listByRunId(run.id)).toHaveLength(0);
    const afterApply = await runRepository.findById(run.id);
    expect(["OPEN", "ROSTERING"]).toContain(afterApply?.status);
    expect(afterApply?.status).not.toBe("PUBLISHED");
  });

  it("batches draft selection lookup once for many signups", async () => {
    const chars = await Promise.all(
      ["Dsvba", "Dsvbb", "Dsvbc"].map((prefix) =>
        characterService.createCharacter(owner, {
          name: charName(prefix),
          realm: "Antonidas",
          region: "EU",
          wowClass: "PRIEST",
          specialization: "Holy",
          itemLevel: 640,
        }),
      ),
    );
    createdCharacterIds.push(...chars.map((row) => row.id));

    const run = await createOpenRun(lead, "2026-12-04T18:00:00.000Z", { healers: 1 });
    for (const character of chars) {
      await signupService.createBoosterSignup(owner, {
        runId: run.id,
        characterId: character.id,
        role: "HEALER",
        isBackup: false,
      });
    }

    const spy = vi.spyOn(rosterRepository, "listDraftSelectedRolesBySignupIds");
    await signupService.getMyRuns(owner);
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0]?.[0] as string[];
    expect(arg.length).toBeGreaterThanOrEqual(3);
    spy.mockRestore();
  });
});
