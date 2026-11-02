import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import { anyContentRunInput } from "@/lib/test-run-input";
import { raidRepository } from "@/repositories/raid.repository";
import { rosterRepository } from "@/repositories/roster.repository";
import { runService } from "@/services/run.service";
import { testActor } from "@/test/actors";
import { assertIsolatedTestDatabase, createTestCharacter, createTestUser, deleteCreatedRows } from "@/test/db-fixtures";
import { expectDomainError } from "@/test/domain-error";
import { CURRENT_WEEK_RUN_START, HOUR_MS, RAID_WEEK_TEST_CLOCK, freezeSystemTime, restoreSystemTime } from "@/test/time";

const syncMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/character-blizzard-sync.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/character-blizzard-sync.service")>();
  return { ...actual, syncLinkedCharacterProfile: syncMock };
});

const { rosterCharacterSyncService } = await import("@/services/roster-character-sync.service");
const { rosterService } = await import("@/services/roster.service");
const { signupService } = await import("@/services/signup.service");

/** Runs, signups and rosters cascade with the Run; Characters with their owner. */
const created = { runIds: [] as string[], userIds: [] as string[] };
let lead: AuthenticatedUser;
let member: AuthenticatedUser;

/** Per test: an owner with three Healer Characters on an OPEN Run, two of them picked. */
let owner: AuthenticatedUser;
let runId = "";
const characters = { stale: "", fresh: "", unpicked: "" };
const signups = { stale: "", fresh: "", unpicked: "" };

function priest(name: string, lastSyncedAt: string | null) {
  return createTestCharacter({
    userId: owner.id,
    name,
    realm: "Blackrock",
    wowClass: "PRIEST",
    specialization: "Holy",
    primaryRole: "HEALER",
    lastSyncedAt,
  });
}

/** A PENDING Healer offer, written directly: the test needs it regardless of signup eligibility rules. */
async function healerSignup(characterId: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await orm.RunSignup.create({
    id,
    runId,
    userId: owner.id,
    characterId,
    participationType: "BOOSTER",
    isBackup: false,
    status: "PENDING",
    publishedRole: null,
    createdAt: now,
    updatedAt: now,
  });
  await orm.RunSignupRole.create({ id: crypto.randomUUID(), signupId: id, role: "HEALER", createdAt: now });
  return id;
}

async function pickHealers(signupIds: string[]) {
  const roster = await rosterRepository.ensure(runId);
  await rosterRepository.replaceSelectedSignupIds(
    roster.id,
    roster.version,
    signupIds.map((signupId) => ({ signupId, selectedRole: "HEALER" as const })),
  );
}

const syncStaleSelected = (actor: AuthenticatedUser = lead) => rosterCharacterSyncService.syncStaleSelected(actor, runId);

beforeAll(async () => {
  assertIsolatedTestDatabase();
  freezeSystemTime(RAID_WEEK_TEST_CLOCK, { advance: true });
  await raidRepository.ensureReferenceRaids();
  const leadId = await createTestUser({ name: "Rcs Lead", accountRole: "RAID_LEAD" });
  const memberId = await createTestUser({ name: "Rcs Member" });
  created.userIds.push(leadId, memberId);
  lead = testActor(leadId, "RAID_LEAD");
  member = testActor(memberId);
});

beforeEach(async () => {
  syncMock.mockReset();
  syncMock.mockResolvedValue({ lockoutSynced: true });

  const ownerId = await createTestUser({ name: "Rcs Owner", isBooster: true });
  created.userIds.push(ownerId);
  owner = testActor(ownerId);
  characters.stale = await priest("RcsStale", null);
  characters.fresh = await priest("RcsFresh", new Date().toISOString());
  characters.unpicked = await priest("RcsUnpicked", null);

  const run = await runService.createRun(lead, anyContentRunInput({ scheduledStartAt: CURRENT_WEEK_RUN_START }));
  created.runIds.push(run.id);
  runId = run.id;
  await runService.openRun(lead, runId);
  signups.stale = await healerSignup(characters.stale);
  signups.fresh = await healerSignup(characters.fresh);
  signups.unpicked = await healerSignup(characters.unpicked);
  await pickHealers([signups.stale, signups.fresh]);
});

afterAll(async () => {
  try {
    await deleteCreatedRows(created);
  } finally {
    restoreSystemTime();
  }
});

describe("rosterCharacterSyncService.syncStaleSelected", () => {
  it("syncs only the selected Characters without a fresh sync — server-chosen, through the one sync entry point", async () => {
    expect(await syncStaleSelected()).toEqual({ synced: 1, failed: 0, skipped: 0 });
    expect(syncMock).toHaveBeenCalledTimes(1);
    const [syncOwner, character, , options] = syncMock.mock.calls[0]!;
    expect(syncOwner).toMatchObject({ id: owner.id });
    expect(character).toMatchObject({ id: characters.stale });
    expect(options).toMatchObject({ trigger: "ROSTER_MANAGER", writeActivity: false });
  });

  it("respects the manual refresh cooldown and a sync already in progress", async () => {
    await orm.Character.where({ id: characters.stale }).update({ lastSyncAttemptAt: new Date().toISOString() });
    expect(await syncStaleSelected()).toEqual({ synced: 0, failed: 0, skipped: 1 });

    await orm.Character.where({ id: characters.stale }).update({ lastSyncAttemptAt: null });
    syncMock.mockRejectedValueOnce(new DomainError("CHARACTER_SYNC_IN_PROGRESS", "busy", 409));
    expect(await syncStaleSelected()).toEqual({ synced: 0, failed: 0, skipped: 1 });

    syncMock.mockRejectedValueOnce(new Error("Blizzard down"));
    expect(await syncStaleSelected()).toEqual({ synced: 0, failed: 1, skipped: 0 });
  });

  it("a failing Character lookup counts as failed for that Character only; the others still sync", async () => {
    await pickHealers([signups.stale, signups.fresh, signups.unpicked]);
    const { characterRepository } = await import("@/repositories/character.repository");
    const original = characterRepository.findById.bind(characterRepository);
    const lookup = vi.spyOn(characterRepository, "findById").mockImplementation(async (id: string) => {
      if (id === characters.stale) throw new Error("connection reset");
      return original(id);
    });
    try {
      expect(await syncStaleSelected()).toEqual({ synced: 1, failed: 1, skipped: 0 });
      expect(syncMock).toHaveBeenCalledTimes(1);
      expect(syncMock.mock.calls[0]![1]).toMatchObject({ id: characters.unpicked });
    } finally {
      lookup.mockRestore();
    }
  });

  it("is manager-only and refused once the Run has started", async () => {
    await expectDomainError(syncStaleSelected(member), "RUN_NOT_MANAGEABLE");
    await orm.Run.where({ id: runId }).update({ status: "IN_PROGRESS" });
    await expectDomainError(syncStaleSelected(), "INVALID_ROSTER_SELECTION");
    expect(syncMock).not.toHaveBeenCalled();
  });
});

describe("roster view model — Smart Replacement inputs (no extra queries per candidate)", () => {
  it("carries each Character's sync health and the picked players who withdrew", async () => {
    const view = await rosterService.getRosterManagementView(lead, runId);
    const health = new Map(view.boosters.map((row) => [row.id, row.syncHealth]));
    expect(health.get(signups.stale)).toBe("NEVER_SYNCED");
    expect(health.get(signups.fresh)).toBe("HEALTHY");
    expect(view.withdrawnPicks).toEqual([]);
    expect(view.run.lateFill).toBe(false);

    await signupService.withdrawPickedSignup(owner, { signupId: signups.stale, reason: "Raid with my guild" });
    const after = await rosterService.getRosterManagementView(lead, runId);
    expect(after.boosters.some((row) => row.id === signups.stale)).toBe(false);
    expect(after.withdrawnPicks).toEqual([
      expect.objectContaining({
        signupId: signups.stale,
        characterLabel: "RcsStale-Blackrock",
        reason: "Raid with my guild",
        assignableRoles: ["HEALER"],
      }),
    ]);
  });

  it("Late Fill is flagged close to the start without changing the Run status", async () => {
    const threeHoursAhead = new Date(Date.now() + 3 * HOUR_MS).toISOString();
    await orm.Run.where({ id: runId }).update({ scheduledStartAt: threeHoursAhead });
    const view = await rosterService.getRosterManagementView(lead, runId);
    expect(view.run.lateFill).toBe(true);
    expect(view.run.status).toBe("OPEN");
  });
});
