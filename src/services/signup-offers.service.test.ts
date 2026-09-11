import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { normalizeCharacterIdentity } from "@/lib/character-identity";
import { orm } from "@/lib/prisma";
import { WOW_RAID_CATALOG } from "@/lib/wow-raid-catalog";
import { raidRepository } from "@/repositories/raid.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { signupRepository } from "@/repositories/signup.repository";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";

const raidId = WOW_RAID_CATALOG[0].id;
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
      participationType: "BOOSTER",
      offers: [{ characterId: hunterA }],
    });
    expect(result.created).toBe(1);
    const active = await activeRowsFor(mainRunId, ids.target);
    expect(active.map((row) => row.character?.id)).toEqual([hunterA]);
  });

  it("expands to multiple offers in one call", async () => {
    const result = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      participationType: "BOOSTER",
      offers: [{ characterId: hunterA }, { characterId: hunterB }],
    });
    expect(result.created).toBe(1);
    expect(result.kept).toBe(1);
    const active = await activeRowsFor(mainRunId, ids.target);
    expect(active.map((row) => row.character?.id).sort()).toEqual([hunterA, hunterB].sort());
  });

  it("reconciles A+B to B+C: withdraws A, keeps B, creates C", async () => {
    const result = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      participationType: "BOOSTER",
      offers: [{ characterId: hunterB }, { characterId: hunterC }],
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
      participationType: "BOOSTER",
      offers: [{ characterId: hunterA }, { characterId: hunterB }, { characterId: hunterC }],
    });
    expect(result.reactivated).toBe(1);
    expect(result.created).toBe(0);

    const after = await signupRepository.listByRunAndUser(mainRunId, ids.target);
    const rowA = after.find((row) => row.character?.id === hunterA);
    expect(rowA?.id).toBe(withdrawnARowId);
    expect(rowA?.status).toBe("PENDING");
  });

  it("getSignupOptions reports the User's current active offer, for the signup dialog/bot to preselect on reopen", async () => {
    const options = await signupService.getSignupOptions(target, mainRunId);
    expect(options.activeOffer.participationType).toBe("BOOSTER");
    expect(options.activeOffer.characterIds.sort()).toEqual([hunterA, hunterB, hunterC].sort());
    expect(options.activeOffer.roleByCharacterId[hunterA]).toBe("DPS");
  });

  it("is a no-op when resubmitting the exact same desired set", async () => {
    const result = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      participationType: "BOOSTER",
      offers: [{ characterId: hunterA }, { characterId: hunterB }, { characterId: hunterC }],
    });
    expect(result.created).toBe(0);
    expect(result.reactivated).toBe(0);
    expect(result.withdrawn).toBe(0);
    expect(result.kept).toBe(3);
  });

  it("clears all offers when submitting an empty desired set", async () => {
    const result = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      participationType: "BOOSTER",
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
        participationType: "BOOSTER",
        offers: [{ characterId: hunterA }, { characterId: hunterA }],
      }),
      "SIGNUP_OFFER_DUPLICATE_CHARACTER",
    );
  });

  it("rejects a character owned by another user", async () => {
    await expectDomainCode(
      signupService.setCharacterOffers(target, {
        runId: mainRunId,
        participationType: "BOOSTER",
        offers: [{ characterId: foreignHunter }],
      }),
      "CHARACTER_NOT_OWNED",
    );
  });

  it("rejects an inactive character", async () => {
    await expectDomainCode(
      signupService.setCharacterOffers(target, {
        runId: mainRunId,
        participationType: "BOOSTER",
        offers: [{ characterId: hunterInactive }],
      }),
      "CHARACTER_INACTIVE",
    );
  });

  it("rejects a role invalid for the character's class", async () => {
    await expectDomainCode(
      signupService.setCharacterOffers(target, {
        runId: mainRunId,
        participationType: "BOOSTER",
        offers: [{ characterId: hunterA, role: "TANK" }],
      }),
      "INVALID_CHARACTER_ROLE",
    );
  });

  it("defaults an omitted role to the character's specialization-derived role, and rejects a conflicting explicit role", async () => {
    const result = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      participationType: "BOOSTER",
      offers: [{ characterId: paladinHybrid }],
    });
    expect(result.created).toBe(1);
    const active = await activeRowsFor(mainRunId, ids.target);
    expect(active[0]?.role).toBe("DPS"); // paladinHybrid is specced Retribution

    // An explicit role matching the current specialization is accepted.
    const kept = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      participationType: "BOOSTER",
      offers: [{ characterId: paladinHybrid, role: "DPS" }],
    });
    expect(kept.kept).toBe(1);

    // The Character's specialization is the sole role authority — a client can never override it.
    await expectDomainCode(
      signupService.setCharacterOffers(target, {
        runId: mainRunId,
        participationType: "BOOSTER",
        offers: [{ characterId: paladinHybrid, role: "TANK" }],
      }),
      "INVALID_CHARACTER_ROLE",
    );

    await signupService.setCharacterOffers(target, { runId: mainRunId, participationType: "BOOSTER", offers: [] });
  });

  it("enforces exact-difficulty booster qualification", async () => {
    await expectDomainCode(
      signupService.setCharacterOffers(target, {
        runId: mythicRunId,
        participationType: "BOOSTER",
        offers: [{ characterId: hunterA }],
      }),
      "BOOSTER_ACCESS_DIFFICULTY_MISMATCH",
    );
  });

  it("rolls back the whole request when one offered character is invalid (all-or-nothing)", async () => {
    await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      participationType: "BOOSTER",
      offers: [{ characterId: hunterA }],
    });

    await expectDomainCode(
      signupService.setCharacterOffers(target, {
        runId: mainRunId,
        participationType: "BOOSTER",
        offers: [{ characterId: hunterB }, { characterId: hunterInactive }],
      }),
      "CHARACTER_INACTIVE",
    );

    const active = await activeRowsFor(mainRunId, ids.target);
    expect(active.map((row) => row.character?.id)).toEqual([hunterA]);

    await signupService.setCharacterOffers(target, { runId: mainRunId, participationType: "BOOSTER", offers: [] });
  });
});

describe("signupService.setCharacterOffers — participation type switching", () => {
  it("withdraws active BOOSTER offers when switching to LOOTBUDDY, and vice versa", async () => {
    await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      participationType: "BOOSTER",
      offers: [{ characterId: hunterA }, { characterId: hunterB }],
    });

    const switched = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      participationType: "LOOTBUDDY",
      offers: [{ characterId: hunterC }],
      lootbuddyMode: "LOOT_ONLY",
      lootbuddyVerification: "NONE",
    });
    expect(switched.withdrawn).toBe(2);
    expect(switched.created).toBe(1);

    const all = await signupRepository.listByRunAndUser(mainRunId, ids.target);
    expect(all.find((row) => row.character?.id === hunterA)?.status).toBe("WITHDRAWN");
    expect(all.find((row) => row.character?.id === hunterB)?.status).toBe("WITHDRAWN");
    const lootRow = all.find((row) => row.character?.id === hunterC && row.participationType === "LOOTBUDDY");
    expect(lootRow?.status).toBe("PENDING");
    expect(lootRow?.participationType).toBe("LOOTBUDDY");

    const active = await activeRowsFor(mainRunId, ids.target);
    const types = new Set(active.map((row) => row.participationType));
    expect(types.size).toBeLessThanOrEqual(1);

    const backToBooster = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      participationType: "BOOSTER",
      offers: [{ characterId: hunterA }],
    });
    expect(backToBooster.withdrawn).toBe(1);
    expect(backToBooster.reactivated).toBe(1);

    await signupService.setCharacterOffers(target, { runId: mainRunId, participationType: "BOOSTER", offers: [] });
  });
});

describe("signupService.setCharacterOffers — signup window", () => {
  it("rejects creating a new offer once the signup window is closed but still allows removal", async () => {
    await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      participationType: "BOOSTER",
      offers: [{ characterId: hunterA }],
    });
    await runService.setSignupWindow(lead, mainRunId, false);

    await expectDomainCode(
      signupService.setCharacterOffers(target, {
        runId: mainRunId,
        participationType: "BOOSTER",
        offers: [{ characterId: hunterA }, { characterId: hunterB }],
      }),
      "SIGNUP_CLOSED",
    );

    const removal = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      participationType: "BOOSTER",
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
      participationType: "BOOSTER",
      offers: [{ characterId: hunterA }, { characterId: hunterB }],
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
        participationType: "BOOSTER",
        offers: [{ characterId: hunterB }],
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
      participationType: "BOOSTER",
      offers: [{ characterId: hunterB }],
    });
    expect(released.withdrawn).toBe(1);
    expect(released.kept).toBe(1);

    await signupService.setCharacterOffers(target, { runId: mainRunId, participationType: "BOOSTER", offers: [] });
  });

  it("manager selects an offered character and cannot select an unoffered one; a second selection replaces the first", async () => {
    await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      participationType: "BOOSTER",
      offers: [{ characterId: hunterA }, { characterId: hunterB }],
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
    await signupService.setCharacterOffers(target, { runId: mainRunId, participationType: "BOOSTER", offers: [] });
  });
});

describe("signupService.cancelActiveOffers", () => {
  it("withdraws the entire active offer-set atomically", async () => {
    await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      participationType: "BOOSTER",
      offers: [{ characterId: hunterA }, { characterId: hunterB }],
    });

    const result = await signupService.cancelActiveOffers(target, { runId: mainRunId });
    expect(result.withdrawn).toBe(2);
    const active = await activeRowsFor(mainRunId, ids.target);
    expect(active).toEqual([]);
  });

  it("reports NOT_FOUND when there is nothing active to cancel", async () => {
    await expectDomainCode(signupService.cancelActiveOffers(target, { runId: mainRunId }), "NOT_FOUND");
  });

  it("blocks cancellation when an offer is protected by roster selection (all-or-nothing)", async () => {
    await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      participationType: "BOOSTER",
      offers: [{ characterId: hunterA }, { characterId: hunterB }],
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
      signupService.cancelActiveOffers(target, { runId: mainRunId }),
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
    await signupService.cancelActiveOffers(target, { runId: mainRunId });
  });
});

describe("concurrency regression coverage", () => {
  it("applyOfferPlan rejects reactivating a row that changed out of WITHDRAWN since the plan was computed", async () => {
    const created = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      participationType: "BOOSTER",
      offers: [{ characterId: hunterA }],
    });
    expect(created.created + created.reactivated).toBeGreaterThan(0);
    await signupService.setCharacterOffers(target, { runId: mainRunId, participationType: "BOOSTER", offers: [] });

    const rows = await signupRepository.listByRunAndUser(mainRunId, ids.target);
    const withdrawnRow = rows.find((row) => row.character?.id === hunterA && row.status === "WITHDRAWN")!;
    expect(withdrawnRow).toBeTruthy();

    // Simulate a concurrent actor reactivating the row a moment before this
    // plan's write executes — applyOfferPlan must re-check freshly, not trust
    // the plan blindly.
    await orm.RunSignup.where({ id: withdrawnRow.id }).update({ status: "PENDING" });

    await expectDomainCode(
      signupRepository.applyOfferPlan({
        runId: mainRunId,
        userId: ids.target,
        participationType: "BOOSTER",
        toWithdraw: [],
        toReactivate: [{ id: withdrawnRow.id, characterId: hunterA, role: "DPS", lootbuddyMode: null, lootbuddyVerification: null }],
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
      participationType: "BOOSTER",
      offers: [{ characterId: hunterA }],
    });
    expect(created.created + created.reactivated).toBeGreaterThan(0);
    const active = await activeRowsFor(mainRunId, ids.target);
    const rowA = active.find((row) => row.character?.id === hunterA)!;
    const roster = await rosterRepository.findByRunId(mainRunId);

    // Simulate the User withdrawing between the raid lead's read and their click.
    await orm.RunSignup.where({ id: rowA.id }).update({ status: "WITHDRAWN" });

    await expect(
      rosterRepository.setSignupSelected({
        rosterId: roster!.id,
        expectedVersion: roster!.version,
        signupId: rowA.id,
        selected: true,
        replaceSignupIds: [],
      }),
    ).rejects.toThrow();

    await orm.RunSignup.where({ id: rowA.id }).update({ status: "PENDING" });
    await signupService.setCharacterOffers(target, { runId: mainRunId, participationType: "BOOSTER", offers: [] });
  });
});

describe("signupService.setCharacterOffers — role authority never trusts a stale persisted role", () => {
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

  it("reactivating a WITHDRAWN row with a stale role refreshes it from the Character's current specialization", async () => {
    const monkId = await createMonk("Reoffermist", "Mistweaver");
    const staleRowId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: staleRowId,
      runId: mainRunId,
      userId: ids.target,
      characterId: monkId,
      participationType: "BOOSTER",
      role: "TANK", // stale — the exact shape of the reported Synmist bug
      isBackup: false,
      status: "WITHDRAWN",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      participationType: "BOOSTER",
      offers: [{ characterId: monkId }],
    });
    expect(result.reactivated).toBe(1);

    const row = await signupRepository.findById(staleRowId);
    expect(row?.id).toBe(staleRowId);
    expect(row?.role).toBe("HEALER");

    await signupService.setCharacterOffers(target, { runId: mainRunId, participationType: "BOOSTER", offers: [] });
  });

  it("reconciling a kept offer with a stale persisted role updates it in place, without creating a duplicate row", async () => {
    const monkId = await createMonk("Keepmist", "Mistweaver");
    const staleRowId = crypto.randomUUID();
    await orm.RunSignup.create({
      id: staleRowId,
      runId: mainRunId,
      userId: ids.target,
      characterId: monkId,
      participationType: "BOOSTER",
      role: "TANK", // stale
      isBackup: false,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await signupService.setCharacterOffers(target, {
      runId: mainRunId,
      participationType: "BOOSTER",
      offers: [{ characterId: monkId }],
    });
    expect(result.created).toBe(0);
    expect(result.reactivated).toBe(0);
    expect(result.kept).toBe(1);

    const active = await activeRowsFor(mainRunId, ids.target);
    const rows = active.filter((row) => row.character?.id === monkId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(staleRowId);
    expect(rows[0]?.role).toBe("HEALER");

    await signupService.setCharacterOffers(target, { runId: mainRunId, participationType: "BOOSTER", offers: [] });
  });
});
