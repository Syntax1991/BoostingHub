import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { anyContentRunInput } from "@/lib/test-run-input";
import { orm } from "@/lib/prisma";
import type { SignupStatus } from "@/models/enums";
import { raidRepository } from "@/repositories/raid.repository";
import { rosterService } from "@/services/roster.service";
import { runService } from "@/services/run.service";
import { signupService } from "@/services/signup.service";
import { testActor } from "@/test/actors";
import { assertIsolatedTestDatabase, createTestCharacter, createTestUser, deleteCreatedRows } from "@/test/db-fixtures";
import { CURRENT_WEEK_RUN_START, RAID_WEEK_TEST_CLOCK, freezeSystemTime, restoreSystemTime } from "@/test/time";

/**
 * Isolated integration coverage for Class Buff Checker wiring through
 * getRosterManagementView / draft selection. Pure mapping rules live in
 * roster-raid-buffs.test.ts — this file only proves selected draft rows
 * drive the DTO (including the PR #27 multi-participation case). Each test
 * gets its own OPEN Run; the users and the Shaman are shared and never change.
 */

const created = { runIds: [] as string[], characterIds: [] as string[], userIds: [] as string[] };
let lead: AuthenticatedUser;
let player: AuthenticatedUser;
let shamanId = "";
let runId = "";

type RosterView = Awaited<ReturnType<typeof rosterService.getRosterManagementView>>;

const loadView = () => rosterService.getRosterManagementView(lead, runId);

function isCovered(view: RosterView, buffId: string) {
  return view.raidBuffCoverage.buffs.find((buff) => buff.id === buffId)?.covered;
}

async function setDraftSelected(view: RosterView, signupId: string, selected: boolean) {
  await rosterService.setDraftSelection(lead, { runId, signupId, selected, version: view.roster.version });
  return loadView();
}

async function offerShamanAsHealer() {
  await signupService.setCharacterOffers(player, { runId, offers: [{ characterId: shamanId, offeredRoles: ["HEALER"] }] });
}

beforeAll(async () => {
  assertIsolatedTestDatabase();
  freezeSystemTime(RAID_WEEK_TEST_CLOCK, { advance: true });
  await raidRepository.ensureReferenceRaids();
  const leadId = await createTestUser({ name: "Rbc Lead", accountRole: "RAID_LEAD" });
  const playerId = await createTestUser({ name: "Rbc Player", isBooster: true });
  created.userIds.push(leadId, playerId);
  lead = testActor(leadId, "RAID_LEAD");
  player = testActor(playerId);
  shamanId = await createTestCharacter({
    userId: playerId,
    name: "Rbcshaman",
    realm: "Antonidas",
    wowClass: "SHAMAN",
    specialization: "Restoration",
    primaryRole: "HEALER",
  });
  created.characterIds.push(shamanId);
}, 60_000);

beforeEach(async () => {
  const run = await runService.createRun(lead, anyContentRunInput({ scheduledStartAt: CURRENT_WEEK_RUN_START }));
  created.runIds.push(run.id);
  runId = run.id;
  await runService.openRun(lead, runId);
});

afterAll(async () => {
  try {
    await deleteCreatedRows(created);
  } finally {
    restoreSystemTime();
  }
}, 60_000);

describe("rosterService Class Buff Checker integration", () => {
  it("updates coverage when a Shaman Booster is draft-selected and deselected", async () => {
    await offerShamanAsHealer();

    let view = await loadView();
    const booster = view.boosters.find((item) => item.character?.id === shamanId)!;
    expect(booster).toBeTruthy();
    expect(isCovered(view, "SKYFURY")).toBe(false);

    view = await setDraftSelected(view, booster.id, true);
    expect(isCovered(view, "SKYFURY")).toBe(true);
    expect(
      view.raidBuffCoverage.buffs
        .find((item) => item.id === "SKYFURY")
        ?.providers.some((provider) => provider.signupId === booster.id),
    ).toBe(true);

    // A draft-selected row that is later WITHDRAWN no longer counts toward coverage.
    const { status } = (await orm.RunSignup.where({ id: booster.id }).select("status").first()) as { status: SignupStatus };
    await orm.RunSignup.where({ id: booster.id }).update({ status: "WITHDRAWN" });
    view = await loadView();
    expect(isCovered(view, "SKYFURY")).toBe(false);
    await orm.RunSignup.where({ id: booster.id }).update({ status });
    view = await loadView();
    expect(isCovered(view, "SKYFURY")).toBe(true);

    view = await setDraftSelected(view, booster.id, false);
    expect(isCovered(view, "SKYFURY")).toBe(false);
  });

  it("PR #27: same User Booster + Mage PLAYING + Priest LOOT_ONLY", async () => {
    await offerShamanAsHealer();
    await signupService.setLootbuddies(player, {
      runId,
      lootbuddies: [
        { wowClass: "MAGE", mode: "PLAYING" },
        { wowClass: "PRIEST", mode: "LOOT_ONLY" },
      ],
    });

    let view = await loadView();
    const booster = view.boosters.find((item) => item.character?.id === shamanId)!;
    const mage = view.groups.lootbuddies.find((item) => item.lootbuddyClass === "MAGE" && item.lootbuddyMode === "PLAYING")!;
    const priest = view.groups.lootbuddies.find(
      (item) => item.lootbuddyClass === "PRIEST" && item.lootbuddyMode === "LOOT_ONLY",
    )!;

    for (const signupId of [booster.id, mage.id, priest.id]) view = await setDraftSelected(view, signupId, true);

    expect(isCovered(view, "SKYFURY")).toBe(true);
    expect(isCovered(view, "ARCANE_INTELLECT")).toBe(true);
    // A LOOT_ONLY Lootbuddy is in the raid too and brings its class buff.
    expect(isCovered(view, "POWER_WORD_FORTITUDE")).toBe(true);
  });
});
