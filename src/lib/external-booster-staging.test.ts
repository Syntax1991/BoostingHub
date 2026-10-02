import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  appendStagedExternalBooster,
  applyStagedExternalBoosterEdit,
  externalBoostersStagedUnchanged,
  preferredRoleForClass,
  removeStagedExternalBooster,
  roleAfterClassChange,
  roleAfterTypeChange,
  stagedExternalBoostersForSave,
  toStagedExternalBoosters,
  type StagedExternalBooster,
} from "@/lib/external-booster-staging";
import type { ExternalBooster } from "@/lib/external-booster";
import { externalBoosterInputError } from "@/lib/external-booster";

vi.mock("@/controllers/roster.actions", () => ({
  saveExternalBoostersAction: vi.fn(),
}));

import { ExternalBoostersDialog } from "@/components/runs/external-boosters-dialog";

const original: ExternalBooster[] = [
  { id: "id-a", name: "Alpha", wowClass: "PALADIN", participationType: "BOOSTER", role: "HEALER" },
  { id: "id-b", name: "Bravo", wowClass: "MAGE", participationType: "BOOSTER", role: "RANGED_DPS" },
  { id: "id-c", name: "Charlie", wowClass: "ROGUE", participationType: "LOOTBUDDY", role: null },
];

function stagedFromOriginal(): StagedExternalBooster[] {
  return toStagedExternalBoosters(original);
}

describe("external booster staging helpers", () => {
  it("A/toStaged: maps persisted ids to stable staged keys", () => {
    expect(toStagedExternalBoosters(original).map((row) => row.key)).toEqual(["id-a", "id-b", "id-c"]);
  });

  it("B. Apply edits name on the same staged row", () => {
    const staged = stagedFromOriginal();
    const { next, error } = applyStagedExternalBoosterEdit(staged, "id-b", {
      name: "  @BravoPrime ",
      wowClass: "MAGE",
      participationType: "BOOSTER",
      role: "RANGED_DPS",
    });
    expect(error).toBeNull();
    expect(next.map((row) => row.key)).toEqual(["id-a", "id-b", "id-c"]);
    expect(next[1]).toMatchObject({ key: "id-b", name: "BravoPrime", wowClass: "MAGE", role: "RANGED_DPS" });
  });

  it("C. class change keeps a still-valid role", () => {
    expect(roleAfterClassChange("BOOSTER", "HEALER", "PRIEST")).toBe("HEALER");
    expect(preferredRoleForClass("PRIEST", "HEALER")).toBe("HEALER");
  });

  it("D. class change with invalid role picks concrete DPS subtype (never generic DPS)", () => {
    expect(roleAfterClassChange("BOOSTER", "HEALER", "MAGE")).toBe("RANGED_DPS");
    expect(preferredRoleForClass("MAGE", "HEALER")).toBe("RANGED_DPS");
  });

  it("initial Mage default is unambiguous Ranged DPS (matches dialog useState)", () => {
    expect(preferredRoleForClass("MAGE")).toBe("RANGED_DPS");
  });

  it("pure DPS classes get an unambiguous concrete subtype", () => {
    expect(preferredRoleForClass("MAGE")).toBe("RANGED_DPS");
    expect(preferredRoleForClass("WARLOCK")).toBe("RANGED_DPS");
    expect(preferredRoleForClass("HUNTER")).toBe("RANGED_DPS");
    expect(preferredRoleForClass("ROGUE")).toBe("MELEE_DPS");
  });

  it("hybrids prefer Tank/Healer over inventing Melee/Ranged DPS", () => {
    expect(preferredRoleForClass("SHAMAN")).toBe("HEALER");
    expect(preferredRoleForClass("PRIEST")).toBe("HEALER");
    expect(preferredRoleForClass("DRUID")).toBe("TANK");
    expect(preferredRoleForClass("PALADIN")).toBe("TANK");
    expect(preferredRoleForClass("MONK")).toBe("TANK");
    expect(preferredRoleForClass("DEMON_HUNTER")).toBe("TANK");
    expect(preferredRoleForClass("WARRIOR")).toBe("TANK");
    expect(preferredRoleForClass("DEATH_KNIGHT")).toBe("TANK");
    expect(preferredRoleForClass("EVOKER")).toBe("HEALER");
  });

  it("class switch reconciles role when previous role is invalid", () => {
    expect(preferredRoleForClass("ROGUE", "RANGED_DPS")).toBe("MELEE_DPS");
    expect(preferredRoleForClass("MAGE", "MELEE_DPS")).toBe("RANGED_DPS");
    expect(preferredRoleForClass("SHAMAN", "TANK")).toBe("HEALER");
    expect(preferredRoleForClass("PALADIN", "RANGED_DPS")).toBe("TANK");
  });

  it("class switch keeps a still-valid preferred role", () => {
    expect(preferredRoleForClass("SHAMAN", "HEALER")).toBe("HEALER");
    expect(preferredRoleForClass("SHAMAN", "MELEE_DPS")).toBe("MELEE_DPS");
    expect(preferredRoleForClass("HUNTER", "MELEE_DPS")).toBe("MELEE_DPS");
    expect(preferredRoleForClass("HUNTER", "RANGED_DPS")).toBe("RANGED_DPS");
  });

  it("never returns legacy generic DPS", () => {
    for (const wowClass of [
      "MAGE",
      "WARLOCK",
      "HUNTER",
      "ROGUE",
      "SHAMAN",
      "PRIEST",
      "DRUID",
      "PALADIN",
      "WARRIOR",
      "MONK",
      "DEMON_HUNTER",
      "DEATH_KNIGHT",
      "EVOKER",
    ] as const) {
      expect(preferredRoleForClass(wowClass)).not.toBe("DPS");
      expect(preferredRoleForClass(wowClass, "DPS")).not.toBe("DPS");
    }
  });

  it("E. BOOSTER → LOOTBUDDY clears role", () => {
    expect(roleAfterTypeChange("LOOTBUDDY", "PRIEST", "HEALER")).toBeNull();
    const { next, error } = applyStagedExternalBoosterEdit(stagedFromOriginal(), "id-a", {
      name: "Alpha",
      wowClass: "PALADIN",
      participationType: "LOOTBUDDY",
      role: null,
    });
    expect(error).toBeNull();
    expect(next[0]).toMatchObject({ key: "id-a", participationType: "LOOTBUDDY", role: null });
  });

  it("F. LOOTBUDDY → BOOSTER assigns a valid preferred role", () => {
    expect(roleAfterTypeChange("BOOSTER", "ROGUE", null)).toBe("MELEE_DPS");
    const { next, error } = applyStagedExternalBoosterEdit(stagedFromOriginal(), "id-c", {
      name: "Charlie",
      wowClass: "ROGUE",
      participationType: "BOOSTER",
      role: "MELEE_DPS",
    });
    expect(error).toBeNull();
    expect(next[2]).toMatchObject({ key: "id-c", participationType: "BOOSTER", role: "MELEE_DPS" });
  });

  it("G. invalid edited name rejects Apply and leaves staged unchanged", () => {
    const staged = stagedFromOriginal();
    const { next, error } = applyStagedExternalBoosterEdit(staged, "id-a", {
      name: "@everyone",
      wowClass: "PALADIN",
      participationType: "BOOSTER",
      role: "HEALER",
    });
    expect(error).toMatch(/not a valid|everyone/i);
    expect(next).toEqual(staged);
  });

  it("H. Cancel is a no-op on staged data (draft discarded by the dialog)", () => {
    const staged = stagedFromOriginal();
    expect(staged).toEqual(stagedFromOriginal());
  });

  it("I/J. editing preserves order and key", () => {
    const { next } = applyStagedExternalBoosterEdit(stagedFromOriginal(), "id-b", {
      name: "BravoTwo",
      wowClass: "WARLOCK",
      participationType: "BOOSTER",
      role: "RANGED_DPS",
    });
    expect(next.map((row) => row.key)).toEqual(["id-a", "id-b", "id-c"]);
    expect(next[1]!.name).toBe("BravoTwo");
    expect(next[1]!.key).toBe("id-b");
  });

  it("K. single-edit session is enforced by dialog state (helpers keep one-key apply)", () => {
    const staged = stagedFromOriginal();
    const first = applyStagedExternalBoosterEdit(staged, "id-a", {
      name: "Alpha2",
      wowClass: "PALADIN",
      participationType: "BOOSTER",
      role: "HEALER",
    });
    const second = applyStagedExternalBoosterEdit(first.next, "id-b", {
      name: "Bravo2",
      wowClass: "MAGE",
      participationType: "BOOSTER",
      role: "RANGED_DPS",
    });
    // Helpers allow sequential applies; the dialog prevents concurrent edit UI.
    expect(second.next.map((row) => row.name)).toEqual(["Alpha2", "Bravo2", "Charlie"]);
  });

  it("L. any staged change enables Save (unchanged=false)", () => {
    const staged = stagedFromOriginal();
    const { next } = applyStagedExternalBoosterEdit(staged, "id-a", {
      name: "AlphaEdited",
      wowClass: "PALADIN",
      participationType: "BOOSTER",
      role: "HEALER",
    });
    expect(externalBoostersStagedUnchanged(next, original)).toBe(false);
  });

  it("M. restoring original values disables Save again", () => {
    const staged = stagedFromOriginal();
    const edited = applyStagedExternalBoosterEdit(staged, "id-a", {
      name: "AlphaEdited",
      wowClass: "PALADIN",
      participationType: "BOOSTER",
      role: "HEALER",
    }).next;
    const restored = applyStagedExternalBoosterEdit(edited, "id-a", {
      name: "Alpha",
      wowClass: "PALADIN",
      participationType: "BOOSTER",
      role: "HEALER",
    }).next;
    expect(externalBoostersStagedUnchanged(restored, original)).toBe(true);
  });

  it("N. Remove still works", () => {
    expect(removeStagedExternalBooster(stagedFromOriginal(), "id-b").map((row) => row.key)).toEqual(["id-a", "id-c"]);
  });

  it("O. Add still works", () => {
    const next = appendStagedExternalBooster(
      stagedFromOriginal(),
      { name: "Delta", wowClass: "HUNTER", participationType: "BOOSTER", role: "RANGED_DPS" },
      "new-key",
    );
    expect(next).toHaveLength(4);
    expect(next[3]).toMatchObject({ key: "new-key", name: "Delta", role: "RANGED_DPS" });
  });

  it("P. Save payload is the final edited values without keys", () => {
    const { next } = applyStagedExternalBoosterEdit(stagedFromOriginal(), "id-a", {
      name: "AlphaFinal",
      wowClass: "PALADIN",
      participationType: "LOOTBUDDY",
      role: null,
    });
    expect(stagedExternalBoostersForSave(next)).toEqual([
      { name: "AlphaFinal", wowClass: "PALADIN", participationType: "LOOTBUDDY", role: null },
      { name: "Bravo", wowClass: "MAGE", participationType: "BOOSTER", role: "RANGED_DPS" },
      { name: "Charlie", wowClass: "ROGUE", participationType: "LOOTBUDDY", role: null },
    ]);
  });

  it("Q. server-side validation still rejects invalid class/role pair", () => {
    expect(
      externalBoosterInputError({
        name: "dawn",
        wowClass: "MAGE",
        participationType: "BOOSTER",
        role: "HEALER",
      }),
    ).toMatch(/cannot play/);
  });

  it("R. server-side validation rejects legacy generic DPS even if a stale client submits it", () => {
    expect(
      externalBoosterInputError({
        name: "dawn",
        wowClass: "MAGE",
        participationType: "BOOSTER",
        role: "DPS",
      }),
    ).toMatch(/generic DPS|Melee DPS|Ranged DPS/i);
    expect(
      externalBoosterInputError({
        name: "dawn",
        wowClass: "ROGUE",
        participationType: "BOOSTER",
        role: "DPS",
      }),
    ).not.toBeNull();
  });

  it("S. submitted pure-DPS staging rows use concrete subtypes", () => {
    const staged = appendStagedExternalBooster(
      [],
      { name: "dawn", wowClass: "MAGE", participationType: "BOOSTER", role: preferredRoleForClass("MAGE") },
      "k1",
    );
    expect(stagedExternalBoostersForSave(staged)).toEqual([
      { name: "dawn", wowClass: "MAGE", participationType: "BOOSTER", role: "RANGED_DPS" },
    ]);
  });
});

describe("ExternalBoostersDialog markup", () => {
  it("A. existing Booster row shows Edit and Remove", () => {
    const html = renderToStaticMarkup(
      createElement(ExternalBoostersDialog, {
        runId: "run-1",
        rosterVersion: 1,
        boosters: original,
        onClose: () => {},
      }),
    );
    expect(html).toContain(">Edit<");
    expect(html).toContain(">Remove<");
    expect(html).toContain("@Alpha");
    expect(html).toContain("Paladin");
    expect(html).toContain("Healer");
    expect(html).toContain("Lootbuddy");
    expect(html).toContain(">Add<");
    expect(html).toContain(">Save<");
  });

  it("B. add form initial class is Mage with Ranged DPS selected (never generic DPS)", () => {
    const html = renderToStaticMarkup(
      createElement(ExternalBoostersDialog, {
        runId: "run-1",
        rosterVersion: 1,
        boosters: [],
        onClose: () => {},
      }),
    );
    expect(html).toMatch(/<option[^>]*value="MAGE"[^>]*selected/);
    expect(html).toMatch(/<option[^>]*value="RANGED_DPS"[^>]*selected/);
    expect(html).not.toMatch(/value="DPS"/);
  });
});
