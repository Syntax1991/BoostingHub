import { describe, expect, it } from "vitest";
import { diffRoster, type RosterDiffMember } from "@/lib/roster-diff";
import type { CharacterRole } from "@/models/enums";

function booster(signupId: string, userId: string, role: CharacterRole, label = signupId): RosterDiffMember {
  return { signupId, userId, participationType: "BOOSTER", role, label };
}

function lootbuddy(signupId: string, userId: string, label = "Mage"): RosterDiffMember {
  return { signupId, userId, participationType: "LOOTBUDDY", role: null, label };
}

const published = [
  booster("s-mist", "u-mist", "HEALER", "Synmist-Antonidas"),
  booster("s-blast", "u-blast", "HEALER", "Synblast-Antonidas"),
  booster("s-tank", "u-tank", "TANK", "Syntank-Antonidas"),
];

describe("diffRoster — Update Roster preview", () => {
  it("no change → empty", () => {
    expect(diffRoster(published, [...published].reverse())).toEqual([]);
  });

  it("added", () => {
    const changes = diffRoster(published, [...published, booster("s-light", "u-light", "HEALER", "Synlight-Antonidas")]);
    expect(changes).toEqual([{ kind: "ADDED", member: expect.objectContaining({ signupId: "s-light", role: "HEALER" }) }]);
  });

  it("removed", () => {
    const changes = diffRoster(published, published.filter((row) => row.signupId !== "s-mist"));
    expect(changes).toEqual([{ kind: "REMOVED", member: expect.objectContaining({ signupId: "s-mist" }) }]);
  });

  it("role change keeps identity by signup", () => {
    const changes = diffRoster(
      published,
      published.map((row) => (row.signupId === "s-blast" ? { ...row, role: "RANGED_DPS" as const } : row)),
    );
    expect(changes).toEqual([
      { kind: "ROLE_CHANGED", member: expect.objectContaining({ signupId: "s-blast", role: "RANGED_DPS" }), fromRole: "HEALER" },
    ]);
  });

  it("Character swap of the same User is one change, not add + remove", () => {
    const changes = diffRoster(published, [
      booster("s-mist-alt", "u-mist", "HEALER", "Synmistalt-Antonidas"),
      published[1]!,
      published[2]!,
    ]);
    expect(changes).toEqual([
      {
        kind: "CHARACTER_CHANGED",
        from: expect.objectContaining({ signupId: "s-mist" }),
        to: expect.objectContaining({ signupId: "s-mist-alt" }),
      },
    ]);
  });

  it("multiple changes: + first, then −, then swaps, then role changes", () => {
    const changes = diffRoster(published, [
      booster("s-light", "u-light", "HEALER", "Synlight-Antonidas"),
      { ...published[1]!, role: "RANGED_DPS" },
      published[2]!,
    ]);
    expect(changes.map((change) => change.kind)).toEqual(["ADDED", "REMOVED", "ROLE_CHANGED"]);
    expect(changes).toHaveLength(3);
  });

  it("Lootbuddy added / removed are their own entries and never pair as a Character swap", () => {
    const changes = diffRoster(
      [...published, lootbuddy("lb-1", "u-mist")],
      [...published, lootbuddy("lb-2", "u-mist", "Priest")],
    );
    expect(changes.map((change) => [change.kind, change.kind === "CHARACTER_CHANGED" ? null : change.member.signupId])).toEqual([
      ["ADDED", "lb-2"],
      ["REMOVED", "lb-1"],
    ]);
  });

  it("does not depend on row order", () => {
    const draft = [booster("s-light", "u-light", "HEALER"), published[2]!, published[1]!];
    expect(diffRoster(published, draft)).toEqual(diffRoster([...published].reverse(), [...draft].reverse()));
  });
});
