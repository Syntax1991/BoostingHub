import { describe, expect, it } from "vitest";
import {
  applyRangeAssignment,
  bossesInRange,
  bossExceptionsPayload,
  bossPlanIsDirty,
  bossPlanRows,
  choicesWithCurrent,
  evaluateLiveBossPlan,
  nextBossRange,
  rangeAssignment,
  resetSlotBosses,
  slotCharacterChoices,
  slotHasBossChoices,
  type BossPlanEditorSignup,
} from "@/components/manage/roster-boss-plan-editor";
import { describeSlotBossPlan, plannedRunBosses, type RosterBossException } from "@/lib/roster-boss-plan";
import type { CharacterRole } from "@/models/enums";

/** Venom 6/8 + Tide 1/1 — a Bundle; Run order Venom 1–6, Tide 1. */
const bosses = plannedRunBosses([
  {
    id: "venom",
    raidName: "Venomous Abyss",
    raidShortName: "Venom",
    sortOrder: 1,
    plannedBossCount: 6,
    bosses: Array.from({ length: 8 }, (_, index) => ({ id: `v${index + 1}`, name: `Venom Boss ${index + 1}`, sortOrder: index + 1 })),
  },
  {
    id: "tide",
    raidName: "Tidebound Grotto",
    raidShortName: "Tide",
    sortOrder: 2,
    plannedBossCount: 1,
    bosses: [{ id: "t1", name: "Tide Boss", sortOrder: 1 }],
  },
]);
const venom = (n: number) => bosses[n - 1]!;
const tide = bosses[6]!;

function signup(id: string, userId: string, name: string, roles: CharacterRole[], extra: Partial<BossPlanEditorSignup> = {}): BossPlanEditorSignup {
  return {
    id,
    userId,
    status: "PENDING",
    participationType: "BOOSTER",
    character: { id: `char-${id}`, name, realm: "Antonidas" },
    characterActive: true,
    boosterApproved: true,
    assignableRoles: roles,
    scheduleConflicts: [],
    contentSaves: [],
    ...extra,
  };
}

const sham = signup("sham", "userA", "Bexsham", ["HEALER", "RANGED_DPS"]);
const priest = signup("priest", "userA", "Bexpriest", ["HEALER"]);
const mage = signup("mage", "userB", "Bexmage", ["RANGED_DPS"]);
const signups = [sham, priest, mage];
const staged = new Map<string, CharacterRole | null>([
  ["sham", "HEALER"],
  ["mage", "RANGED_DPS"],
]);

describe("boss range picker", () => {
  it("click selects one boss; a second click on another boss makes a contiguous range; a third starts over", () => {
    let range = nextBossRange(null, venom(1).key);
    expect(bossesInRange(bosses, range)).toEqual([venom(1)]);
    range = nextBossRange(range, venom(6).key);
    expect(bossesInRange(bosses, range).map((boss) => boss.bossNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    range = nextBossRange(range, venom(3).key);
    expect(bossesInRange(bosses, range)).toEqual([venom(3)]);
  });

  it("ranges work backwards and across Bundle contents in Run order", () => {
    const range = nextBossRange(nextBossRange(null, tide.key), venom(5).key);
    expect(bossesInRange(bosses, range)).toEqual([venom(5), venom(6), tide]);
  });

  it("clicking the selected boss again keeps it selected; a stale key selects nothing", () => {
    const range = nextBossRange(nextBossRange(null, venom(2).key), venom(2).key);
    expect(bossesInRange(bosses, range)).toEqual([venom(2)]);
    expect(bossesInRange(bosses, { anchor: "gone:boss", end: venom(2).key })).toEqual([]);
  });
});

describe("slot Character choices", () => {
  it("own Character first, then eligible alternates of the same player only", () => {
    const choices = slotCharacterChoices(sham, signups, new Set(staged.keys()));
    expect(choices).toEqual([
      { playSignupId: null, label: "Bexsham-Antonidas", roles: ["HEALER", "RANGED_DPS"] },
      { playSignupId: "priest", label: "Bexpriest-Antonidas", roles: ["HEALER"] },
    ]);
    expect(slotHasBossChoices(choices)).toBe(true);
  });

  it("never offers an alternate that holds its own slot (no double booking), is withdrawn, inactive, conflicted or unapproved", () => {
    const stagedIds = new Set([...staged.keys(), "priest"]);
    expect(slotCharacterChoices(sham, signups, stagedIds)).toHaveLength(1);
    for (const extra of [
      { status: "WITHDRAWN" as const },
      { characterActive: false },
      { boosterApproved: false },
      { scheduleConflicts: [{}] },
    ]) {
      expect(slotCharacterChoices(sham, [sham, { ...priest, ...extra }], new Set(staged.keys()))).toHaveLength(1);
    }
  });

  it("a single-role slot without alternates has nothing to change", () => {
    expect(slotHasBossChoices(slotCharacterChoices(mage, signups, new Set(staged.keys())))).toBe(false);
  });
});

describe("saved pick that is no longer offered (regression)", () => {
  const savedAlt: RosterBossException[] = [venom(5), venom(6)].map((boss) => ({
    slotSignupId: "sham",
    runRaidContentId: boss.runRaidContentId,
    raidBossId: boss.raidBossId,
    playSignupId: "priest",
    role: "HEALER",
  }));
  const inactivePriest = { ...priest, characterActive: false };
  const stagedIds = new Set(staged.keys());

  it("an alternate that became ineligible stays shown and marked instead of the select silently showing the own Character", () => {
    const offered = slotCharacterChoices(sham, [sham, inactivePriest, mage], stagedIds);
    expect(offered.map((choice) => choice.playSignupId)).toEqual([null]);
    const current = rangeAssignment({ exceptions: savedAlt, slotSignupId: "sham", slotRole: "HEALER", range: [venom(5), venom(6)] });
    expect(choicesWithCurrent(offered, current, [sham, inactivePriest, mage])).toEqual([
      ...offered,
      { playSignupId: "priest", label: "Bexpriest-Antonidas (not available)", roles: ["HEALER"], unavailable: true },
    ]);
  });

  it("a role the Character no longer offers stays in the role options; offered picks are unchanged; Mixed adds nothing", () => {
    const offered = slotCharacterChoices(mage, signups, stagedIds);
    expect(choicesWithCurrent(offered, { playSignupId: null, role: "TANK" }, signups)[0]!.roles).toEqual(["RANGED_DPS", "TANK"]);
    expect(choicesWithCurrent(offered, { playSignupId: null, role: "RANGED_DPS" }, signups)).toEqual(offered);
    expect(choicesWithCurrent(offered, "MIXED", signups)).toEqual(offered);
  });

  it("a deviating slot stays listed (and resettable) even without any choice left; a plain fixed slot is not listed", () => {
    const slots = [{ signup: { ...sham, assignableRoles: ["HEALER" as const] } }, { signup: mage }];
    const rows = (exceptions: RosterBossException[]) =>
      bossPlanRows({ slots, signups: [slots[0]!.signup, inactivePriest, mage], stagedSlotIds: stagedIds, exceptions }).map(
        (row) => row.slot.signup.id,
      );
    expect(rows([])).toEqual([]);
    expect(rows(savedAlt)).toEqual(["sham"]);
  });
});

describe("staging range assignments", () => {
  const range56 = [venom(5), venom(6)];

  it("defaults: no exception → the slot's Character and role are preselected", () => {
    expect(rangeAssignment({ exceptions: [], slotSignupId: "sham", slotRole: "HEALER", range: range56 })).toEqual({
      playSignupId: null,
      role: "HEALER",
    });
  });

  it("applying an alternate Character to a range writes one row per boss; the default writes none", () => {
    const next = applyRangeAssignment({
      exceptions: [],
      slotSignupId: "sham",
      slotRole: "HEALER",
      range: range56,
      assignment: { playSignupId: "priest", role: "HEALER" },
    });
    expect(next).toEqual([
      { slotSignupId: "sham", runRaidContentId: "venom", raidBossId: "v5", playSignupId: "priest", role: "HEALER" },
      { slotSignupId: "sham", runRaidContentId: "venom", raidBossId: "v6", playSignupId: "priest", role: "HEALER" },
    ]);
    expect(rangeAssignment({ exceptions: next, slotSignupId: "sham", slotRole: "HEALER", range: range56 })).toEqual({
      playSignupId: "priest",
      role: "HEALER",
    });
    const back = applyRangeAssignment({
      exceptions: next,
      slotSignupId: "sham",
      slotRole: "HEALER",
      range: range56,
      assignment: { playSignupId: null, role: "HEALER" },
    });
    expect(back).toEqual([]);
  });

  it("a range that partly deviates reads as MIXED; reset clears only that range, or every boss", () => {
    const rows = applyRangeAssignment({
      exceptions: [],
      slotSignupId: "sham",
      slotRole: "HEALER",
      range: [venom(6), tide],
      assignment: { playSignupId: null, role: "RANGED_DPS" },
    });
    expect(rangeAssignment({ exceptions: rows, slotSignupId: "sham", slotRole: "HEALER", range: range56 })).toBe("MIXED");
    expect(resetSlotBosses(rows, "sham", range56)).toEqual([rows[1]]);
    expect(resetSlotBosses(rows, "sham")).toEqual([]);
    expect(resetSlotBosses(rows, "mage")).toEqual(rows);
  });
});

describe("Save / Update payload", () => {
  const altRows: RosterBossException[] = [venom(5), venom(6)].map((boss) => ({
    slotSignupId: "sham",
    runRaidContentId: boss.runRaidContentId,
    raidBossId: boss.raidBossId,
    playSignupId: "priest",
    role: "HEALER",
  }));

  it("keeps valid rows in canonical order and compares equal to the saved draft", () => {
    const payload = bossExceptionsPayload({ exceptions: [...altRows].reverse(), staged, signups, bosses });
    expect(payload).toEqual(altRows);
    expect(bossPlanIsDirty(payload, altRows)).toBe(false);
    expect(bossPlanIsDirty([], altRows)).toBe(true);
  });

  it("drops rows of slots that left the draft, alternates that became a slot or left the signups, unplanned bosses", () => {
    expect(bossExceptionsPayload({ exceptions: altRows, staged: new Map([["mage", "RANGED_DPS"]]), signups, bosses })).toEqual([]);
    expect(
      bossExceptionsPayload({ exceptions: altRows, staged: new Map([...staged, ["priest", "HEALER"]]), signups, bosses }),
    ).toEqual([]);
    expect(bossExceptionsPayload({ exceptions: altRows, staged, signups: [sham, mage], bosses })).toEqual([]);
    const unplanned = { ...altRows[0]!, raidBossId: "v7" };
    expect(bossExceptionsPayload({ exceptions: [unplanned], staged, signups, bosses })).toEqual([]);
  });

  it("a role row that now equals the slot's (changed) default role disappears", () => {
    const dpsRow: RosterBossException = { slotSignupId: "sham", runRaidContentId: "venom", raidBossId: "v1", playSignupId: null, role: "RANGED_DPS" };
    expect(bossExceptionsPayload({ exceptions: [dpsRow], staged, signups, bosses })).toEqual([dpsRow]);
    expect(
      bossExceptionsPayload({ exceptions: [dpsRow], staged: new Map([...staged, ["sham", "RANGED_DPS"]]), signups, bosses }),
    ).toEqual([]);
  });

  it("describes the slot compactly in the roster (Bundle bosses named per content)", () => {
    const rows = [
      ...altRows,
      { slotSignupId: "sham", runRaidContentId: "tide", raidBossId: "t1", playSignupId: null, role: "RANGED_DPS" as const },
    ];
    expect(
      describeSlotBossPlan({
        exceptions: rows,
        bosses,
        characterLabelBySignupId: new Map([["priest", "Bexpriest-Antonidas"]]),
      }),
    ).toBe("Venom 5–6: Bexpriest-Antonidas · Healer; Tide 1: Ranged DPS");
  });
});

describe("live per-boss warnings", () => {
  const base = {
    bosses,
    staged,
    signups,
    externalRoles: [],
    targets: { tanks: 0, healers: 1, dps: 1 },
    lootType: "UNSAVED" as const,
  };

  it("no exceptions → nothing (the default roster's own validation is unchanged)", () => {
    expect(evaluateLiveBossPlan({ ...base, payload: [] })).toEqual({ issues: [], warnings: [] });
  });

  it("missing Healer on the bosses where the healer switches to DPS, grouped by range; Save is not blocked", () => {
    const payload = applyRangeAssignment({
      exceptions: [],
      slotSignupId: "sham",
      slotRole: "HEALER",
      range: [venom(5), venom(6)],
      assignment: { playSignupId: null, role: "RANGED_DPS" },
    });
    const result = evaluateLiveBossPlan({ ...base, payload });
    expect(result.issues).toEqual([]);
    expect(result.warnings.map((warning) => warning.message)).toEqual(["Venom 5–6: 0 of 1 Healer.", "Venom 5–6: 2 of 1 DPS."]);
    expect(result.warnings[0]!.bossKeys).toEqual([venom(5).key, venom(6).key]);
  });

  it("boss-exact lockout of the alternate Character, only on fresh-lockout loot types", () => {
    const savedPriest = {
      ...priest,
      contentSaves: [
        {
          sortOrder: 1,
          raidSave: {
            raidId: "venom-raid",
            difficulty: "HEROIC" as const,
            resetIdentifier: "r",
            bossesDefeated: 1,
            totalBossCount: 8,
            isComplete: false,
            killedBossIds: ["v6"],
          },
        },
      ],
    };
    const payload = applyRangeAssignment({
      exceptions: [],
      slotSignupId: "sham",
      slotRole: "HEALER",
      range: [venom(5), venom(6)],
      assignment: { playSignupId: "priest", role: "HEALER" },
    });
    const input = { ...base, signups: [sham, savedPriest, mage], payload };
    expect(evaluateLiveBossPlan(input).warnings.map((warning) => warning.message)).toEqual([
      "Venom 6: Bexpriest-Antonidas is already saved.",
    ]);
    expect(evaluateLiveBossPlan({ ...input, lootType: "SAVED" }).warnings).toEqual([]);
  });

  it("hard issue when the alternate withdrew after the page loaded", () => {
    const payload: RosterBossException[] = [
      { slotSignupId: "sham", runRaidContentId: "venom", raidBossId: "v1", playSignupId: "priest", role: "HEALER" },
    ];
    const result = evaluateLiveBossPlan({ ...base, signups: [sham, { ...priest, status: "WITHDRAWN" }, mage], payload });
    expect(result.issues.map((issue) => issue.code)).toEqual(["BOSS_EXCEPTION_CHARACTER_INVALID"]);
  });
});
