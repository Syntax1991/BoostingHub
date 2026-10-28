import { describe, expect, it } from "vitest";
import {
  bossCompositionWarnings,
  bossExceptionFingerprint,
  bossLockoutWarnings,
  describeSlotBossPlan,
  effectiveBossRoster,
  formatBossRanges,
  normalizeBossExceptions,
  plannedRunBosses,
  runBossKey,
  validateBossExceptions,
  type BossPlanSignup,
  type BossPlanSlot,
  type RosterBossException,
} from "@/lib/roster-boss-plan";
import { diffBossPlans } from "@/lib/roster-diff";
import { hasUnpublishedRosterChanges } from "@/services/roster-publish-state";

const venomBosses = Array.from({ length: 8 }, (_, index) => ({ id: `v${index + 1}`, name: `Venom Boss ${index + 1}`, sortOrder: index + 1 }));
const VENOM_6_OF_8 = { id: "c-venom", raidName: "The Venomous Abyss", raidShortName: "Venom", sortOrder: 1, plannedBossCount: 6, bosses: [...venomBosses].reverse() };
const VENOM_8 = { ...VENOM_6_OF_8, plannedBossCount: 8 };
const TIDE = { id: "c-tide", raidName: "The Tidebound Grotto", raidShortName: "Tide", sortOrder: 2, plannedBossCount: 1, bosses: [{ id: "t1", name: "Tide Boss", sortOrder: 1 }] };

const bosses8 = plannedRunBosses([VENOM_8]);

function exception(slot: string, boss: number, role: RosterBossException["role"], play: string | null = null): RosterBossException {
  return { slotSignupId: slot, runRaidContentId: "c-venom", raidBossId: `v${boss}`, playSignupId: play, role };
}

function signup(id: string, userId: string, overrides: Partial<BossPlanSignup> = {}): BossPlanSignup {
  return {
    id,
    userId,
    status: "PENDING",
    participationType: "BOOSTER",
    characterId: `char-${id}`,
    characterLabel: `${id}-Antonidas`,
    characterActive: true,
    boosterApproved: true,
    assignableRoles: ["HEALER", "RANGED_DPS"],
    scheduleConflictCount: 0,
    ...overrides,
  };
}

const slotA: BossPlanSlot = { signupId: "a", userId: "u-a", participationType: "BOOSTER", characterId: "char-a", role: "HEALER" };
const slotB: BossPlanSlot = { signupId: "b", userId: "u-b", participationType: "BOOSTER", characterId: "char-b", role: "RANGED_DPS" };

describe("plannedRunBosses / formatBossRanges", () => {
  it("6/8 plans exactly bosses 1–6, in boss sortOrder", () => {
    expect(plannedRunBosses([VENOM_6_OF_8]).map((boss) => boss.raidBossId)).toEqual(["v1", "v2", "v3", "v4", "v5", "v6"]);
  });

  it("Bundles keep content order and identify each boss by content + boss", () => {
    const bosses = plannedRunBosses([TIDE, VENOM_6_OF_8]);
    expect(bosses.map((boss) => boss.key)).toEqual([
      ...["v1", "v2", "v3", "v4", "v5", "v6"].map((id) => runBossKey("c-venom", id)),
      runBossKey("c-tide", "t1"),
    ]);
    expect(formatBossRanges([bosses[4]!, bosses[5]!, bosses[6]!], bosses)).toBe("Venom 5–6, Tide 1");
  });

  it("single content: Boss ranges with gaps", () => {
    expect(formatBossRanges([bosses8[0]!, bosses8[1]!, bosses8[3]!, bosses8[6]!, bosses8[7]!], bosses8)).toBe("Boss 1–2, 4, 7–8");
  });
});

describe("validateBossExceptions — hard rules", () => {
  const slots = new Map([
    ["a", slotA],
    ["b", slotB],
  ]);
  const signups = new Map<string, BossPlanSignup>([
    ["a", signup("a", "u-a")],
    ["b", signup("b", "u-b")],
    ["a-alt", signup("a-alt", "u-a", { assignableRoles: ["HEALER"] })],
    ["a-gone", signup("a-gone", "u-a", { status: "WITHDRAWN" })],
    ["a-busy", signup("a-busy", "u-a", { scheduleConflictCount: 1 })],
    ["a-off", signup("a-off", "u-a", { characterActive: false })],
  ]);
  const run = (exceptions: RosterBossException[], bossList = bosses8) =>
    validateBossExceptions({ bosses: bossList, slots, signups, exceptions }).map((issue) => issue.code);

  it("accepts a role change and an alternate Character of the same player", () => {
    expect(run([exception("a", 7, "RANGED_DPS"), exception("a", 8, "HEALER", "a-alt")])).toEqual([]);
  });

  it("rejects a boss that is not planned (6/8 Run, boss 7)", () => {
    expect(run([exception("a", 7, "RANGED_DPS")], plannedRunBosses([VENOM_6_OF_8]))).toEqual(["BOSS_EXCEPTION_BOSS_NOT_PLANNED"]);
  });

  it("rejects another player's Character — one Booster slot per player per boss", () => {
    expect(run([exception("a", 7, "RANGED_DPS", "b")])).toEqual(["BOSS_EXCEPTION_CHARACTER_INVALID"]);
  });

  it("rejects withdrawn, conflicted and inactive alternate Characters", () => {
    expect(run([exception("a", 6, "HEALER", "a-gone")])).toEqual(["BOSS_EXCEPTION_CHARACTER_INVALID"]);
    expect(run([exception("a", 6, "HEALER", "a-busy")])).toEqual(["BOSS_EXCEPTION_CHARACTER_INVALID"]);
    expect(run([exception("a", 6, "HEALER", "a-off")])).toEqual(["BOSS_EXCEPTION_CHARACTER_INVALID"]);
  });

  it("rejects a role the playing Character did not offer, and generic DPS", () => {
    expect(run([exception("a", 7, "TANK")])).toEqual(["BOSS_EXCEPTION_ROLE_INVALID"]);
    expect(run([exception("a", 7, "RANGED_DPS", "a-alt")])).toEqual(["BOSS_EXCEPTION_ROLE_INVALID"]);
    expect(run([exception("a", 7, "DPS")])).toEqual(["BOSS_EXCEPTION_ROLE_INVALID"]);
  });

  it("rejects a slot that is not a selected Booster slot and duplicate boss assignments", () => {
    expect(run([exception("zz", 7, "HEALER")])).toEqual(["BOSS_EXCEPTION_SLOT_INVALID"]);
    expect(run([exception("a", 7, "RANGED_DPS"), exception("a", 7, "HEALER", "a-alt")])).toEqual(["BOSS_EXCEPTION_DUPLICATE"]);
  });
});

describe("normalizeBossExceptions / fingerprint", () => {
  it("drops rows that restate the default and folds playSignupId === slot", () => {
    const slots = new Map([["a", slotA]]);
    const normalized = normalizeBossExceptions(
      [exception("a", 8, "RANGED_DPS"), exception("a", 7, "HEALER"), exception("a", 6, "RANGED_DPS", "a")],
      slots,
    );
    expect(normalized).toEqual([exception("a", 6, "RANGED_DPS"), exception("a", 8, "RANGED_DPS")]);
  });

  it("is order-independent", () => {
    const rows = [exception("a", 7, "RANGED_DPS"), exception("a", 8, "RANGED_DPS")];
    expect(bossExceptionFingerprint(rows)).toBe(bossExceptionFingerprint([...rows].reverse()));
  });
});

describe("effectiveBossRoster + per-boss warnings", () => {
  const charBySignup = new Map<string, string | null>([
    ["a", "char-a"],
    ["b", "char-b"],
    ["a-alt", "char-a-alt"],
  ]);

  it("no exceptions → every boss is the default roster and no warning", () => {
    const effective = effectiveBossRoster({ bosses: bosses8, slots: [slotA, slotB], exceptions: [], characterBySignupId: charBySignup });
    expect(effective.get(bosses8[7]!.key)!.map((row) => [row.playSignupId, row.role, row.isException])).toEqual([
      ["a", "HEALER", false],
      ["b", "RANGED_DPS", false],
    ]);
    expect(
      bossCompositionWarnings({ bosses: bosses8, effective, externalRoles: [], targets: { tanks: 0, healers: 2, dps: 0 } }),
    ).toEqual([]);
  });

  it("a Healer → DPS switch on bosses 7–8 is reported once, grouped: Boss 7–8: 0 of 1 Healer", () => {
    const effective = effectiveBossRoster({
      bosses: bosses8,
      slots: [slotA, slotB],
      exceptions: [exception("a", 7, "RANGED_DPS"), exception("a", 8, "RANGED_DPS")],
      characterBySignupId: charBySignup,
    });
    const warnings = bossCompositionWarnings({
      bosses: bosses8,
      effective,
      externalRoles: [],
      targets: { tanks: 0, healers: 1, dps: 1 },
    });
    expect(warnings.map((row) => row.message)).toEqual(["Boss 7–8: 0 of 1 Healer.", "Boss 7–8: 2 of 1 DPS."]);
  });

  it("External Boosters count on every boss", () => {
    const effective = effectiveBossRoster({
      bosses: bosses8,
      slots: [slotA, slotB],
      exceptions: [exception("a", 8, "RANGED_DPS")],
      characterBySignupId: charBySignup,
    });
    expect(
      bossCompositionWarnings({ bosses: bosses8, effective, externalRoles: ["HEALER"], targets: { tanks: 0, healers: 1, dps: 2 } }),
    ).toEqual([]);
  });

  it("boss-exact lockout warning for the Character that actually plays the boss", () => {
    const effective = effectiveBossRoster({
      bosses: bosses8,
      slots: [slotA, slotB],
      exceptions: [exception("a", 7, "HEALER", "a-alt"), exception("a", 8, "HEALER", "a-alt")],
      characterBySignupId: charBySignup,
    });
    const warnings = bossLockoutWarnings({
      bosses: bosses8,
      effective,
      isSavedOnBoss: (characterId, boss) => characterId === "char-a-alt" && boss.raidBossId === "v8",
      characterLabelBySignupId: new Map([["a-alt", "Synalt-Antonidas"]]),
    });
    expect(warnings.map((row) => row.message)).toEqual(["Boss 8: Synalt-Antonidas is already saved."]);
  });
});

describe("describeSlotBossPlan / diffBossPlans / unpublished changes", () => {
  const labels = new Map([["a-alt", "Synalt-Antonidas"]]);
  const plan = [
    exception("a", 5, "HEALER", "a-alt"),
    exception("a", 6, "HEALER", "a-alt"),
    exception("a", 7, "RANGED_DPS"),
    exception("a", 8, "RANGED_DPS"),
  ];

  it("describes one slot compactly, grouped by Character + role in boss order", () => {
    expect(describeSlotBossPlan({ exceptions: plan, bosses: bosses8, characterLabelBySignupId: labels })).toBe(
      "Boss 5–6: Synalt-Antonidas · Healer; Boss 7–8: Ranged DPS",
    );
  });

  it("diff: changed plan of a kept slot is one line; unchanged plans and added slots are not repeated", () => {
    const member = { signupId: "a", userId: "u-a", participationType: "BOOSTER" as const, role: "HEALER" as const, label: "Synblast-Antonidas" };
    const changes = diffBossPlans({
      published: [exception("a", 8, "RANGED_DPS")],
      draft: plan,
      members: new Map([["a", member], ["new", { ...member, signupId: "new" }]]),
      publishedSlotIds: new Set(["a"]),
      bosses: bosses8,
      characterLabelBySignupId: labels,
    });
    expect(changes).toEqual([
      {
        kind: "BOSS_PLAN_CHANGED",
        member,
        before: "Boss 8: Ranged DPS",
        after: "Boss 5–6: Synalt-Antonidas · Healer; Boss 7–8: Ranged DPS",
      },
    ]);
    expect(
      diffBossPlans({
        published: [...plan].reverse(),
        draft: plan,
        members: new Map([["a", member]]),
        publishedSlotIds: new Set(["a"]),
        bosses: bosses8,
        characterLabelBySignupId: labels,
      }),
    ).toEqual([]);
  });

  it("unpublished changes: exceptions are compared only when given; equal sets are clean", () => {
    const base = {
      publishedAt: "2026-10-28T10:00:00.000Z",
      version: 3,
      runChangedSinceAck: false,
      draft: [{ signupId: "a", selectedRole: "HEALER" as const }],
      signups: [{ id: "a", status: "SELECTED" as const, participationType: "BOOSTER" as const, publishedRole: "HEALER" as const }],
    };
    expect(hasUnpublishedRosterChanges(base)).toBe(false);
    expect(hasUnpublishedRosterChanges({ ...base, bossExceptions: { draft: [], published: [] } })).toBe(false);
    expect(hasUnpublishedRosterChanges({ ...base, bossExceptions: { draft: plan, published: [...plan].reverse() } })).toBe(false);
    expect(hasUnpublishedRosterChanges({ ...base, bossExceptions: { draft: plan, published: [] } })).toBe(true);
    // Exceptions of slots that are not on the roster do not count.
    expect(
      hasUnpublishedRosterChanges({ ...base, bossExceptions: { draft: [exception("gone", 8, "HEALER")], published: [] } }),
    ).toBe(false);
  });
});
