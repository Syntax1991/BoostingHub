import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { VENOMOUS_ABYSS_RAID_ID } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { runRepository } from "@/repositories/run.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";

const raidId = VENOMOUS_ABYSS_RAID_ID;
const ids = {
  lead: "aaaaaaaa-aaaa-4aaa-8aaa-so0000000001",
  target: "aaaaaaaa-aaaa-4aaa-8aaa-so0000000002",
  otherUser: "aaaaaaaa-aaaa-4aaa-8aaa-so0000000003",
};
const createdUserIds = Object.values(ids);
const createdRunIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdQualificationIds: string[] = [];

function asUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"] = "USER"): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@sotest.boostting.local`,
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

async function createTestUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]) {
  await orm.User.create({
    id,
    name,
    email: `${id}@sotest.boostting.local`,
    emailVerified: true,
    accountRole,
    accountStatus: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function deleteIfPresent(table: string, id: string) {
  try {
    if (table === "User") await orm.User.where({ id }).delete();
    else if (table === "Character") await orm.Character.where({ id }).delete();
    else if (table === "RunSignup") await orm.RunSignup.where({ id }).delete();
    else if (table === "Run") await orm.Run.where({ id }).delete();
    else if (table === "BoosterQualification") await orm.BoosterQualification.where({ id }).delete();
  } catch {
    // Already gone.
  }
}

function futureIso(days = 10) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function createCharacter(
  userId: string,
  name: string,
  options: { wowClass?: "HUNTER" | "PALADIN"; specialization?: string; primaryRole?: "TANK" | "HEALER" | "DPS"; isActive?: boolean } = {},
) {
  const id = crypto.randomUUID();
  createdCharacterIds.push(id);
  await orm.Character.create({
    id,
    userId,
    name,
    realm: "Offer Lab",
    normalizedName: normalizeCharacterIdentity(name),
    normalizedRealm: normalizeCharacterIdentity("Offer Lab"),
    region: "EU",
    wowClass: options.wowClass ?? "HUNTER",
    specialization: options.specialization ?? "Beast Mastery",
    primaryRole: options.primaryRole ?? "DPS",
    itemLevel: 700,
    isActive: options.isActive ?? true,
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
    await deleteIfPresent("RunSignup", (row as { id: string }).id);
  }
  await deleteIfPresent("Run", runId);
}

const lead = asUser(ids.lead, "Offer Lead", "RAID_LEAD");
const target = asUser(ids.target, "Offer Target", "USER");

let hunterA = "";
let hunterB = "";
let hunterC = "";
let hunterInactive = "";
let paladinHybrid = "";
let foreignHunter = "";
let mainRunId = "";
let mythicRunId = "";

beforeAll(async () => {
  await raidRepository.ensureReferenceRaids();
  for (const userId of createdUserIds) {
    const runs = await orm.Run.where({ raidLeadId: userId }).select("id").all();
    for (const row of runs) {
      await cleanupRun((row as { id: string }).id);
    }
    const quals = await orm.BoosterQualification.where({ userId }).select("id").all();
    for (const row of quals) {
      await deleteIfPresent("BoosterQualification", (row as { id: string }).id);
    }
    const chars = await orm.Character.where({ userId }).select("id").all();
    for (const row of chars) {
      await deleteIfPresent("Character", (row as { id: string }).id);
    }
    await deleteIfPresent("User", userId);
  }

  await createTestUser(ids.lead, "Offer Lead", "RAID_LEAD");
  await createTestUser(ids.target, "Offer Target", "USER");
  await createTestUser(ids.otherUser, "Offer Other", "USER");

  hunterA = await createCharacter(ids.target, "Sooffera");
  hunterB = await createCharacter(ids.target, "Sooffereb");
  hunterC = await createCharacter(ids.target, "Sooofferc");
  hunterInactive = await createCharacter(ids.target, "Sooofferinactive", { isActive: false });
  paladinHybrid = await createCharacter(ids.target, "Soofferpala", {
    wowClass: "PALADIN",
    specialization: "Retribution",
    primaryRole: "DPS",
  });
  foreignHunter = await createCharacter(ids.otherUser, "Soofferforeign");

  const qualId = crypto.randomUUID();
  createdQualificationIds.push(qualId);
  await orm.BoosterQualification.create({
    id: qualId,
    userId: ids.target,
    difficulty: "HEROIC",
    status: "APPROVED",
    notes: null,
    grantedAt: new Date().toISOString(),
    grantedById: null,
    revokedAt: null,
    revokedById: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  mainRunId = await runService
    .createRun(lead, {
      raidId,
      difficulty: "HEROIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt: futureIso(),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    })
    .then((run) => run.id);
  createdRunIds.push(mainRunId);
  await runService.openRun(lead, mainRunId);

  mythicRunId = await runService
    .createRun(lead, {
      raidId,
      difficulty: "MYTHIC",
      lootType: "UNSAVED",
      plannedBossCount: 8,
      scheduledStartAt: futureIso(),
      desiredTankCount: 2,
      desiredHealerCount: 4,
      desiredDpsCount: 14,
    })
    .then((run) => run.id);
  createdRunIds.push(mythicRunId);
  await runService.openRun(lead, mythicRunId);
}, 60_000);

afterAll(async () => {
  for (const runId of createdRunIds) {
    await cleanupRun(runId);
  }
  for (const id of createdQualificationIds) {
    await deleteIfPresent("BoosterQualification", id);
  }
  for (const id of createdCharacterIds) {
    await deleteIfPresent("Character", id);
  }
  for (const id of createdUserIds) {
    await deleteIfPresent("User", id);
  }
}, 60_000);

async function activeRowsFor(runId: string, userId: string) {
  const rows = await signupRepository.listByRunAndUser(runId, userId);
  return rows.filter((row) => row.status !== "WITHDRAWN");
}

describe("signupService.setCharacterOffers — basic offer sets", () => {
  it("creates one offer", async () => {
    const result = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: hunterA, role: "DPS" }],
    });
    expect(result.created).toBe(1);
    const active = await activeRowsFor(mainRunId, ids.target);
    expect(active.map((row) => row.character?.id)).toEqual([hunterA]);
  });

  it("expands to multiple offers in one call", async () => {
    const result = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: hunterA, role: "DPS" }, { characterId: hunterB, role: "DPS" }],
    });
    expect(result.created).toBe(1);
    expect(result.kept).toBe(1);
    const active = await activeRowsFor(mainRunId, ids.target);
    expect(active.map((row) => row.character?.id).sort()).toEqual([hunterA, hunterB].sort());
  });

  it("reconciles A+B to B+C: withdraws A, keeps B, creates C", async () => {
    const result = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: hunterB, role: "DPS" }, { characterId: hunterC, role: "DPS" }],
    });
    expect(result.withdrawn).toBe(1);
    expect(result.kept).toBe(1);
    expect(result.created).toBe(1);

    const all = await signupRepository.listByRunAndUser(mainRunId, ids.target);
    const rowA = all.find((row) => row.character?.id === hunterA);
    const rowB = all.find((row) => row.character?.id === hunterB);
    const rowC = all.find((row) => row.character?.id === hunterC);
    expect(rowA?.status).toBe("WITHDRAWN");
    expect(rowB?.status).toBe("PENDING");
    expect(rowC?.status).toBe("PENDING");
  });

  it("reactivates the withdrawn A row instead of inserting a duplicate", async () => {
    const before = await signupRepository.listByRunAndUser(mainRunId, ids.target);
    const withdrawnARowId = before.find((row) => row.character?.id === hunterA)?.id;
    expect(withdrawnARowId).toBeTruthy();

    const result = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: hunterA, role: "DPS" }, { characterId: hunterB, role: "DPS" }, { characterId: hunterC, role: "DPS" }],
    });
    expect(result.reactivated).toBe(1);
    expect(result.created).toBe(0);

    const after = await signupRepository.listByRunAndUser(mainRunId, ids.target);
    const rowA = after.find((row) => row.character?.id === hunterA);
    expect(rowA?.id).toBe(withdrawnARowId);
    expect(rowA?.status).toBe("PENDING");
  });

  it("getSignupOptions reports the User's current active Booster offer, for the signup dialog/bot to preselect on reopen", async () => {
    const options = await signupService.getSignupOptions(target, mainRunId);
    expect(options.activeBoosterOffers.characterIds.sort()).toEqual([hunterA, hunterB, hunterC].sort());
    expect(options.activeBoosterOffers.roleByCharacterId[hunterA]).toBe("DPS");
  });

  it("is a no-op when resubmitting the exact same desired set", async () => {
    const result = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: hunterA, role: "DPS" }, { characterId: hunterB, role: "DPS" }, { characterId: hunterC, role: "DPS" }],
    });
    expect(result.created).toBe(0);
    expect(result.reactivated).toBe(0);
    expect(result.withdrawn).toBe(0);
    expect(result.kept).toBe(3);
  });

  it("clears all offers when submitting an empty desired set", async () => {
    const result = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [],
    });
    expect(result.withdrawn).toBe(3);
    const active = await activeRowsFor(mainRunId, ids.target);
    expect(active).toEqual([]);
  });
});

describe("signupService.setCharacterOffers — validation", () => {
  it("rejects a duplicate character within one request", async () => {
    await expectDomainCode(
      signupService.setCharacterOffers(target, {
        runId: mainRunId,
        offers: [{ characterId: hunterA, role: "DPS" }, { characterId: hunterA, role: "DPS" }],
      }),
      "SIGNUP_OFFER_DUPLICATE_CHARACTER",
    );
  });

  it("rejects a character owned by another user", async () => {
    await expectDomainCode(
      signupService.setCharacterOffers(target, {
        runId: mainRunId,
        offers: [{ characterId: foreignHunter }],
      }),
      "CHARACTER_NOT_OWNED",
    );
  });

  it("rejects an inactive character", async () => {
    await expectDomainCode(
      signupService.setCharacterOffers(target, {
        runId: mainRunId,
        offers: [{ characterId: hunterInactive }],
      }),
      "CHARACTER_INACTIVE",
    );
  });

  it("rejects a role invalid for the character's class", async () => {
    await expectDomainCode(
      signupService.setCharacterOffers(target, {
        runId: mainRunId,
        offers: [{ characterId: hunterA, role: "TANK" }],
      }),
      "INVALID_CHARACTER_ROLE",
    );
  });

  it("requires an explicit role for every BOOSTER offer — an omitted role is rejected, never guessed", async () => {
    await expectDomainCode(
      signupService.setCharacterOffers(target, {
        runId: mainRunId,
        offers: [{ characterId: paladinHybrid }],
      }),
      "INVALID_CHARACTER_ROLE",
    );
  });

  it("accepts any role the character's class can perform, not only its specialization-derived default", async () => {
    // paladinHybrid is specced Retribution (DPS default), but Paladins can also Tank or Heal —
    // the class, not the specialization, is what bounds the choice.
    const tanked = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: paladinHybrid, role: "TANK" }],
    });
    expect(tanked.created).toBe(1);
    const active = await activeRowsFor(mainRunId, ids.target);
    expect(active[0]?.role).toBe("TANK");
    const rowId = active[0]?.id;

    // Changing to a different class-valid role updates the same row — no duplicate.
    const healed = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: paladinHybrid, role: "HEALER" }],
    });
    expect(healed.kept).toBe(1);
    const afterChange = await activeRowsFor(mainRunId, ids.target);
    expect(afterChange).toHaveLength(1);
    expect(afterChange[0]?.id).toBe(rowId);
    expect(afterChange[0]?.role).toBe("HEALER");

    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
  });

  it("enforces exact-difficulty booster qualification", async () => {
    await expectDomainCode(
      signupService.setCharacterOffers(target, {
        runId: mythicRunId,
        offers: [{ characterId: hunterA, role: "DPS" }],
      }),
      "BOOSTER_ACCESS_DIFFICULTY_MISMATCH",
    );
  });

  it("rolls back the whole request when one offered character is invalid (all-or-nothing)", async () => {
    await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: hunterA, role: "DPS" }],
    });

    await expectDomainCode(
      signupService.setCharacterOffers(target, {
        runId: mainRunId,
        offers: [{ characterId: hunterB, role: "DPS" }, { characterId: hunterInactive }],
      }),
      "CHARACTER_INACTIVE",
    );

    const active = await activeRowsFor(mainRunId, ids.target);
    expect(active.map((row) => row.character?.id)).toEqual([hunterA]);

    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
  });
});

describe("signupService.setCharacterOffers / setLootbuddies — coexistence", () => {
  it("saving Booster offers never withdraws the User's Lootbuddy entries, and vice versa", async () => {
    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
    await signupService.setLootbuddies(target, { runId: mainRunId, lootbuddies: [] });

    const boosted = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: hunterA, role: "DPS" }],
    });
    expect(boosted.created + boosted.reactivated).toBe(1);

    const lootbuddied = await signupService.setLootbuddies(target, {
      runId: mainRunId,
      lootbuddies: [{ wowClass: "MAGE", mode: "LOOT_ONLY" }],
    });
    expect(lootbuddied.created).toBe(1);

    const all = await signupRepository.listByRunAndUser(mainRunId, ids.target);
    const boosterRow = all.find((row) => row.participationType === "BOOSTER" && row.character?.id === hunterA);
    const lootRow = all.find((row) => row.participationType === "LOOTBUDDY");
    expect(boosterRow?.status).toBe("PENDING");
    expect(lootRow?.status).toBe("PENDING");
    expect(lootRow?.lootbuddyClass).toBe("MAGE");

    // Updating Booster offers again must not touch the Lootbuddy row.
    await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: hunterB, role: "DPS" }],
    });
    const afterBoosterUpdate = await signupRepository.listByRunAndUser(mainRunId, ids.target);
    expect(afterBoosterUpdate.find((row) => row.id === boosterRow!.id)?.status).toBe("WITHDRAWN");
    expect(afterBoosterUpdate.find((row) => row.id === lootRow!.id)?.status).toBe("PENDING");

    // Updating Lootbuddy entries again must not touch the Booster row.
    await signupService.setLootbuddies(target, {
      runId: mainRunId,
      lootbuddies: [{ signupId: lootRow!.id, wowClass: "PRIEST", mode: "PLAYING" }],
    });
    const afterLootbuddyUpdate = await signupRepository.listByRunAndUser(mainRunId, ids.target);
    const currentBooster = afterLootbuddyUpdate.find(
      (row) => row.participationType === "BOOSTER" && row.character?.id === hunterB,
    );
    expect(currentBooster?.status).toBe("PENDING");
    expect(afterLootbuddyUpdate.find((row) => row.id === lootRow!.id)?.lootbuddyClass).toBe("PRIEST");

    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
    await signupService.setLootbuddies(target, { runId: mainRunId, lootbuddies: [] });
  });

  it("supports N lootbuddies including duplicates, edit/remove one, and cancel booster without clearing lootbuddies", async () => {
    await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: hunterA, role: "DPS" }],
    });
    const created = await signupService.setLootbuddies(target, {
      runId: mainRunId,
      lootbuddies: [
        { wowClass: "MAGE", mode: "LOOT_ONLY" },
        { wowClass: "MAGE", mode: "LOOT_ONLY" },
        { wowClass: "DRUID", mode: "PLAYING" },
      ],
    });
    expect(created.created).toBe(3);

    let rows = await signupRepository.listByRunAndUser(mainRunId, ids.target);
    const lootRows = rows.filter((row) => row.participationType === "LOOTBUDDY" && row.status === "PENDING");
    expect(lootRows).toHaveLength(3);
    const [first, second, third] = lootRows;
    expect(first!.id).not.toBe(second!.id);

    await signupService.setLootbuddies(target, {
      runId: mainRunId,
      lootbuddies: [
        { signupId: first!.id, wowClass: "WARLOCK", mode: "LOOT_ONLY" },
        { signupId: third!.id, wowClass: "DRUID", mode: "PLAYING" },
      ],
    });
    rows = await signupRepository.listByRunAndUser(mainRunId, ids.target);
    expect(rows.find((row) => row.id === second!.id)?.status).toBe("WITHDRAWN");
    expect(rows.find((row) => row.id === first!.id)?.lootbuddyClass).toBe("WARLOCK");
    expect(rows.find((row) => row.id === third!.id)?.status).toBe("PENDING");
    expect(rows.find((row) => row.participationType === "BOOSTER" && row.status === "PENDING")).toBeTruthy();

    await signupService.cancelBoosterSignup(target, { runId: mainRunId });
    rows = await signupRepository.listByRunAndUser(mainRunId, ids.target);
    expect(rows.filter((row) => row.participationType === "BOOSTER" && row.status !== "WITHDRAWN")).toHaveLength(0);
    expect(rows.filter((row) => row.participationType === "LOOTBUDDY" && row.status === "PENDING")).toHaveLength(2);

    await signupService.setLootbuddies(target, { runId: mainRunId, lootbuddies: [] });
    rows = await signupRepository.listByRunAndUser(mainRunId, ids.target);
    expect(rows.filter((row) => row.participationType === "LOOTBUDDY" && row.status !== "WITHDRAWN")).toHaveLength(0);
  });
});

describe("signupService.setCharacterOffers — signup window", () => {
  it("rejects creating a new offer once the signup window is closed but still allows removal", async () => {
    await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: hunterA, role: "DPS" }],
    });
    await runService.setSignupWindow(lead, mainRunId, false);

    await expectDomainCode(
      signupService.setCharacterOffers(target, {
        runId: mainRunId,
        offers: [{ characterId: hunterA, role: "DPS" }, { characterId: hunterB, role: "DPS" }],
      }),
      "SIGNUP_CLOSED",
    );

    const removal = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [],
    });
    expect(removal.withdrawn).toBe(1);

    await runService.setSignupWindow(lead, mainRunId, true);
  });
});

describe("signupService.setCharacterOffers — roster protection", () => {
  it("blocks removing a currently roster-draft-selected offer", async () => {
    const created = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: hunterA, role: "DPS" }, { characterId: hunterB, role: "DPS" }],
    });
    expect(created.created + created.reactivated).toBeGreaterThan(0);

    const active = await activeRowsFor(mainRunId, ids.target);
    const selectedSignupId = active.find((row) => row.character?.id === hunterA)!.id;

    const view = await rosterService.getRosterManagementView(lead, mainRunId);
    await rosterService.setDraftSelection(lead, {
      runId: mainRunId,
      signupId: selectedSignupId,
      selected: true,
      version: view.roster.version,
    });

    await expectDomainCode(
      signupService.setCharacterOffers(target, {
        runId: mainRunId,
        offers: [{ characterId: hunterB, role: "DPS" }],
      }),
      "SIGNUP_OFFER_ROSTER_SELECTED",
    );

    // Raid lead deselects first, then the User can freely reconcile.
    const view2 = await rosterService.getRosterManagementView(lead, mainRunId);
    await rosterService.setDraftSelection(lead, {
      runId: mainRunId,
      signupId: selectedSignupId,
      selected: false,
      version: view2.roster.version,
    });
    const released = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: hunterB, role: "DPS" }],
    });
    expect(released.withdrawn).toBe(1);
    expect(released.kept).toBe(1);

    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
  });

  it("manager selects an offered character and cannot select an unoffered one; a second selection replaces the first", async () => {
    await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: hunterA, role: "DPS" }, { characterId: hunterB, role: "DPS" }],
    });
    const active = await activeRowsFor(mainRunId, ids.target);
    const rowA = active.find((row) => row.character?.id === hunterA)!;
    const rowB = active.find((row) => row.character?.id === hunterB)!;

    const view = await rosterService.getRosterManagementView(lead, mainRunId);
    await rosterService.setDraftSelection(lead, {
      runId: mainRunId,
      signupId: rowA.id,
      selected: true,
      version: view.roster.version,
    });
    const afterFirst = await rosterService.getRosterManagementView(lead, mainRunId);
    const rosterAfterFirst = await rosterRepository.findByRunId(mainRunId);
    expect(rosterAfterFirst?.selectedSignupIds).toContain(rowA.id);

    await rosterService.setDraftSelection(lead, {
      runId: mainRunId,
      signupId: rowB.id,
      selected: true,
      version: afterFirst.roster.version,
    });
    const rosterAfterSecond = await rosterRepository.findByRunId(mainRunId);
    expect(rosterAfterSecond?.selectedSignupIds).toContain(rowB.id);
    expect(rosterAfterSecond?.selectedSignupIds).not.toContain(rowA.id);

    await expectDomainCode(
      rosterService.setDraftSelection(lead, {
        runId: mainRunId,
        signupId: "s0000000-0000-4000-8000-000000000000",
        selected: true,
        version: rosterAfterSecond!.version,
      }),
      "NOT_FOUND",
    );

    const cleanupView = await rosterService.getRosterManagementView(lead, mainRunId);
    await rosterService.setDraftSelection(lead, {
      runId: mainRunId,
      signupId: rowB.id,
      selected: false,
      version: cleanupView.roster.version,
    });
    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
  });
});

describe("signupService.cancelBoosterSignup", () => {
  it("withdraws the entire active offer-set atomically", async () => {
    await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: hunterA, role: "DPS" }, { characterId: hunterB, role: "DPS" }],
    });

    const result = await signupService.cancelBoosterSignup(target, { runId: mainRunId });
    expect(result.withdrawn).toBe(2);
    const active = await activeRowsFor(mainRunId, ids.target);
    expect(active).toEqual([]);
  });

  it("reports NOT_FOUND when there is nothing active to cancel", async () => {
    await expectDomainCode(signupService.cancelBoosterSignup(target, { runId: mainRunId }), "NOT_FOUND");
  });

  it("blocks cancellation when an offer is protected by roster selection (all-or-nothing)", async () => {
    await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: hunterA, role: "DPS" }, { characterId: hunterB, role: "DPS" }],
    });
    const active = await activeRowsFor(mainRunId, ids.target);
    const rowA = active.find((row) => row.character?.id === hunterA)!;

    const view = await rosterService.getRosterManagementView(lead, mainRunId);
    await rosterService.setDraftSelection(lead, {
      runId: mainRunId,
      signupId: rowA.id,
      selected: true,
      version: view.roster.version,
    });

    await expectDomainCode(
      signupService.cancelBoosterSignup(target, { runId: mainRunId }),
      "SIGNUP_OFFER_ROSTER_SELECTED",
    );

    const stillActive = await activeRowsFor(mainRunId, ids.target);
    expect(stillActive.length).toBe(2);

    const view2 = await rosterService.getRosterManagementView(lead, mainRunId);
    await rosterService.setDraftSelection(lead, {
      runId: mainRunId,
      signupId: rowA.id,
      selected: false,
      version: view2.roster.version,
    });
    await signupService.cancelBoosterSignup(target, { runId: mainRunId });
  });
});

describe("concurrency regression coverage", () => {
  it("applyOfferPlan rejects reactivating a row that changed out of WITHDRAWN since the plan was computed", async () => {
    const created = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: hunterA, role: "DPS" }],
    });
    expect(created.created + created.reactivated).toBeGreaterThan(0);
    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });

    const rows = await signupRepository.listByRunAndUser(mainRunId, ids.target);
    const withdrawnRow = rows.find((row) => row.character?.id === hunterA && row.status === "WITHDRAWN")!;
    expect(withdrawnRow).toBeTruthy();

    // Simulate a concurrent actor reactivating the row a moment before this
    // plan's write executes — applyOfferPlan must re-check freshly, not trust
    // the plan blindly.
    await orm.RunSignup.where({ id: withdrawnRow.id }).update({ status: "PENDING" });

    const mainRun = await runRepository.findById(mainRunId);
    await expectDomainCode(
      signupRepository.applyOfferPlan({
        runId: mainRunId,
        userId: ids.target,
        scheduledStartAt: mainRun!.scheduledStartAt,
        toWithdraw: [],
        toReactivate: [{ id: withdrawnRow.id, characterId: hunterA, role: "DPS" }],
        toCreate: [],
        toUpdateRole: [],
      }),
      "INVALID_STATE_TRANSITION",
    );

    await orm.RunSignup.where({ id: withdrawnRow.id }).update({ status: "WITHDRAWN" });
  });

  it("setSignupSelected rejects selecting a signup that became withdrawn since it was loaded", async () => {
    const created = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: hunterA, role: "DPS" }],
    });
    expect(created.created + created.reactivated).toBeGreaterThan(0);
    const active = await activeRowsFor(mainRunId, ids.target);
    const rowA = active.find((row) => row.character?.id === hunterA)!;
    const roster = await rosterRepository.findByRunId(mainRunId);

    // Simulate the User withdrawing between the raid lead's read and their click.
    await orm.RunSignup.where({ id: rowA.id }).update({ status: "WITHDRAWN" });

    const mainRun = await runRepository.findById(mainRunId);
    await expect(
      rosterRepository.setSignupSelected({
        rosterId: roster!.id,
        expectedVersion: roster!.version,
        signupId: rowA.id,
        selected: true,
        replaceSignupIds: [],
        characterId: hunterA,
        targetRunId: mainRunId,
        scheduledStartAt: mainRun!.scheduledStartAt,
      }),
    ).rejects.toThrow();

    await orm.RunSignup.where({ id: rowA.id }).update({ status: "PENDING" });
    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
  });
});

describe("signupService.setCharacterOffers — per-Character role choice, restored", () => {
  async function createMonk(name: string, specialization: string) {
    const id = crypto.randomUUID();
    createdCharacterIds.push(id);
    await orm.Character.create({
      id,
      userId: ids.target,
      name,
      realm: "Offer Lab",
      normalizedName: normalizeCharacterIdentity(name),
      normalizedRealm: normalizeCharacterIdentity("Offer Lab"),
      region: "EU",
      wowClass: "MONK",
      specialization,
      primaryRole: "HEALER",
      itemLevel: 700,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return id;
  }

  it("reactivating a WITHDRAWN row sets the role to whatever the User currently selects — never the stale historical role", async () => {
    const monkId = await createMonk("Reoffermist", "Mistweaver");
    const staleRowId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: staleRowId,
      runId: mainRunId,
      userId: ids.target,
      characterId: monkId,
      participationType: "BOOSTER",
      role: "HEALER",
      isBackup: false,
      status: "WITHDRAWN",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: monkId, role: "DPS" }],
    });
    expect(result.reactivated).toBe(1);

    const row = await signupRepository.findById(staleRowId);
    expect(row?.id).toBe(staleRowId);
    expect(row?.status).toBe("PENDING");
    expect(row?.role).toBe("DPS");

    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
  });

  it("changing only the role for an already-offered Character updates the same row in place — no duplicate", async () => {
    const monkId = await createMonk("Keepmist", "Mistweaver");
    const created = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: monkId, role: "HEALER" }],
    });
    expect(created.created).toBe(1);
    const originalRowId = (await activeRowsFor(mainRunId, ids.target)).find(
      (row) => row.character?.id === monkId,
    )?.id;

    const result = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [{ characterId: monkId, role: "TANK" }],
    });
    expect(result.created).toBe(0);
    expect(result.reactivated).toBe(0);
    expect(result.kept).toBe(1);

    const active = await activeRowsFor(mainRunId, ids.target);
    const rows = active.filter((row) => row.character?.id === monkId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(originalRowId);
    expect(rows[0]?.role).toBe("TANK");

    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
  });

  it("persists a different, independent role per Character in one multi-character request — no role leaks between Characters", async () => {
    const tankMonk = await createMonk("Multitank", "Brewmaster");
    const healMonk = await createMonk("Multiheal", "Mistweaver");
    const dpsMonk = await createMonk("Multidps", "Windwalker");

    const result = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      offers: [
        { characterId: tankMonk, role: "TANK" },
        { characterId: healMonk, role: "HEALER" },
        { characterId: dpsMonk, role: "DPS" },
      ],
    });
    expect(result.created).toBe(3);

    const active = await activeRowsFor(mainRunId, ids.target);
    expect(active.find((row) => row.character?.id === tankMonk)?.role).toBe("TANK");
    expect(active.find((row) => row.character?.id === healMonk)?.role).toBe("HEALER");
    expect(active.find((row) => row.character?.id === dpsMonk)?.role).toBe("DPS");

    await signupService.setCharacterOffers(target, { runId: mainRunId, offers: [] });
  });
});
