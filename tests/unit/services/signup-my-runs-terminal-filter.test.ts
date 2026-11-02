import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunStatus, SignupStatus } from "@/models/enums";
import { rosterRepository } from "@/repositories/roster.repository";
import type { SignupListRecord } from "@/repositories/signup.repository";
import { signupRepository } from "@/repositories/signup.repository";
import * as scheduleConflictService from "@/services/character-schedule-conflict.service";
import { signupService } from "@/services/signup.service";
import { testActor } from "@tests/fixtures/actors";

const user = testActor("user-my-runs");

function makeSignup(input: {
  id: string;
  runId: string;
  runStatus: RunStatus;
  status: SignupStatus;
  characterId?: string | null;
  participationType?: "BOOSTER" | "LOOTBUDDY";
}): SignupListRecord {
  const characterId = input.characterId === undefined ? `char-${input.id}` : input.characterId;
  return {
    id: input.id,
    userId: user.id,
    status: input.status,
    participationType: input.participationType ?? "BOOSTER",
    isBackup: false,
    offeredRoles: input.participationType === "LOOTBUDDY" ? [] : ["DPS"],
    publishedRole: input.status === "SELECTED" ? "DPS" : null,
    lootbuddyClass: null,
    lootbuddyMode: null,
    lootbuddyVerification: null,
    character:
      characterId == null
        ? null
        : {
            id: characterId,
            name: `Char ${input.id}`,
            realm: "Silvermoon",
            region: "EU",
            wowClass: "MAGE",
          },
    run: {
      id: input.runId,
      title: `Run ${input.runId}`,
      status: input.runStatus,
      difficulty: "HEROIC",
      scheduledStartAt: "2026-10-01T18:00:00.000Z",
      productLabel: "The Venomous Abyss",
      contentSummary: "The Venomous Abyss 8/8",
      contentTitle: "Venom",
    },
  };
}

function allBuckets(result: Awaited<ReturnType<typeof signupService.getMyRuns>>) {
  return [...result.pending, ...result.selected, ...result.notSelected, ...result.withdrawn];
}

describe("signupService.getMyRuns — terminal Run filter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(scheduleConflictService, "getScheduleConflictsForCharacters").mockResolvedValue(
      new Map(),
    );
    vi.spyOn(rosterRepository, "listDraftSelectedRolesBySignupIds").mockResolvedValue(new Map());
  });

  /*
   * The repository already narrows by Run status (run-list-bounds.test.ts). Each test hands the
   * service its rows unfiltered, so the exclusions below prove the service's own filter.
   */
  const repositoryReturns = (rows: SignupListRecord[]) =>
    vi.spyOn(signupRepository, "listByUserIdForRunStatuses").mockResolvedValue(rows);

  it("includes OPEN + PENDING under pending", async () => {
    repositoryReturns([
      makeSignup({ id: "s1", runId: "r-open", runStatus: "OPEN", status: "PENDING" }),
    ]);
    const mine = await signupService.getMyRuns(user);
    expect(mine.pending.map((row) => row.id)).toEqual(["s1"]);
    expect(mine.selected).toEqual([]);
    expect(mine.notSelected).toEqual([]);
    expect(mine.withdrawn).toEqual([]);
  });

  it("includes ROSTERING + NOT_SELECTED under notSelected", async () => {
    repositoryReturns([
      makeSignup({ id: "s2", runId: "r-rost", runStatus: "ROSTERING", status: "NOT_SELECTED" }),
    ]);
    const mine = await signupService.getMyRuns(user);
    expect(mine.notSelected.map((row) => row.id)).toEqual(["s2"]);
  });

  it("includes PUBLISHED + SELECTED under selected", async () => {
    repositoryReturns([
      makeSignup({ id: "s3", runId: "r-pub", runStatus: "PUBLISHED", status: "SELECTED" }),
    ]);
    const mine = await signupService.getMyRuns(user);
    expect(mine.selected.map((row) => row.id)).toEqual(["s3"]);
    expect(mine.selected[0]?.selectionState).toBe("PUBLISHED");
  });

  it("includes OPEN + PENDING draft pick under selected as DRAFT", async () => {
    repositoryReturns([
      makeSignup({ id: "s-draft", runId: "r-open-draft", runStatus: "OPEN", status: "PENDING" }),
      makeSignup({ id: "s-offer", runId: "r-open-draft", runStatus: "OPEN", status: "PENDING" }),
    ]);
    vi.spyOn(rosterRepository, "listDraftSelectedRolesBySignupIds").mockResolvedValue(
      new Map([["s-draft", "HEALER"]]),
    );
    const mine = await signupService.getMyRuns(user);
    expect(mine.selected.map((row) => row.id)).toEqual(["s-draft"]);
    expect(mine.selected[0]?.selectionState).toBe("DRAFT");
    expect(mine.selected[0]?.displayRole).toBe("HEALER");
    expect(mine.pending.map((row) => row.id)).toEqual(["s-offer"]);
    expect(mine.pending[0]?.selectionState).toBe("OFFERED");
  });

  it("includes IN_PROGRESS + SELECTED under selected", async () => {
    repositoryReturns([
      makeSignup({ id: "s4", runId: "r-ip", runStatus: "IN_PROGRESS", status: "SELECTED" }),
    ]);
    const mine = await signupService.getMyRuns(user);
    expect(mine.selected.map((row) => row.id)).toEqual(["s4"]);
  });

  it("excludes COMPLETED + SELECTED from every bucket", async () => {
    repositoryReturns([
      makeSignup({ id: "s5", runId: "r-done", runStatus: "COMPLETED", status: "SELECTED" }),
    ]);
    const mine = await signupService.getMyRuns(user);
    expect(allBuckets(mine)).toEqual([]);
  });

  it("excludes COMPLETED + NOT_SELECTED from every bucket", async () => {
    repositoryReturns([
      makeSignup({ id: "s6", runId: "r-done2", runStatus: "COMPLETED", status: "NOT_SELECTED" }),
    ]);
    const mine = await signupService.getMyRuns(user);
    expect(allBuckets(mine)).toEqual([]);
  });

  it("excludes CANCELLED + PENDING from every bucket", async () => {
    repositoryReturns([
      makeSignup({ id: "s7", runId: "r-cancel", runStatus: "CANCELLED", status: "PENDING" }),
    ]);
    const mine = await signupService.getMyRuns(user);
    expect(allBuckets(mine)).toEqual([]);
  });

  it("excludes CANCELLED + WITHDRAWN from every bucket", async () => {
    repositoryReturns([
      makeSignup({ id: "s8", runId: "r-cancel2", runStatus: "CANCELLED", status: "WITHDRAWN" }),
    ]);
    const mine = await signupService.getMyRuns(user);
    expect(allBuckets(mine)).toEqual([]);
  });

  it("excludes DRAFT signup rows from every bucket", async () => {
    repositoryReturns([
      makeSignup({ id: "s9", runId: "r-draft", runStatus: "DRAFT", status: "PENDING" }),
    ]);
    const mine = await signupService.getMyRuns(user);
    expect(allBuckets(mine)).toEqual([]);
  });

  it("keeps WITHDRAWN visible only for upcoming Runs", async () => {
    repositoryReturns([
      makeSignup({ id: "s10", runId: "r-open-w", runStatus: "OPEN", status: "WITHDRAWN" }),
      makeSignup({ id: "s11", runId: "r-done-w", runStatus: "COMPLETED", status: "WITHDRAWN" }),
    ]);
    const mine = await signupService.getMyRuns(user);
    expect(mine.withdrawn.map((row) => row.id)).toEqual(["s10"]);
    expect(allBuckets(mine).map((row) => row.id)).toEqual(["s10"]);
  });

  it("projects schedule conflicts for active booster rows unchanged", async () => {
    const conflict: scheduleConflictService.CharacterScheduleConflict = {
      source: "RUN_RESERVATION",
      conflictingRunId: "other",
      conflictingRunTitle: "Other",
      conflictingScheduledStartAt: "2026-10-01T19:00:00.000Z",
      message: "Another Manawyrm Hub Run: Other at …",
    };
    vi.spyOn(scheduleConflictService, "getScheduleConflictsForCharacters").mockResolvedValue(
      new Map([["char-s12", [conflict]]]),
    );
    repositoryReturns([
      makeSignup({
        id: "s12",
        runId: "r-active",
        runStatus: "OPEN",
        status: "SELECTED",
        characterId: "char-s12",
      }),
    ]);
    const mine = await signupService.getMyRuns(user);
    expect(mine.selected[0]?.scheduleConflicts).toEqual([conflict]);
    expect(scheduleConflictService.getScheduleConflictsForCharacters).toHaveBeenCalledTimes(1);
    expect(scheduleConflictService.getScheduleConflictsForCharacters).toHaveBeenCalledWith(
      expect.objectContaining({ targetRunId: "r-active" }),
    );
  });

  it("does not project schedule conflicts for terminal Runs", async () => {
    const spy = vi
      .spyOn(scheduleConflictService, "getScheduleConflictsForCharacters")
      .mockResolvedValue(new Map());
    repositoryReturns([
      makeSignup({
        id: "s13",
        runId: "r-completed",
        runStatus: "COMPLETED",
        status: "SELECTED",
        characterId: "char-s13",
      }),
      makeSignup({
        id: "s14",
        runId: "r-cancelled",
        runStatus: "CANCELLED",
        status: "PENDING",
        characterId: "char-s14",
      }),
      makeSignup({
        id: "s15",
        runId: "r-draft",
        runStatus: "DRAFT",
        status: "PENDING",
        characterId: "char-s15",
      }),
    ]);
    await signupService.getMyRuns(user);
    expect(spy).not.toHaveBeenCalled();
  });

  it("loads only signups on upcoming Runs from the repository", async () => {
    const load = repositoryReturns([]);
    await signupService.getMyRuns(user);
    expect(load).toHaveBeenCalledWith(user.id, ["OPEN", "ROSTERING", "PUBLISHED", "IN_PROGRESS"]);
  });
});
