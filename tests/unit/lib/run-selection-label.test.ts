import { describe, expect, it } from "vitest";
import { runSelectionLabel, runSetupDefaultName, runSetupSelectionLabel } from "@/lib/run-selection-label";

describe("run-selection-label", () => {
  it("multi-raid Run Setup options use the short content title, never the full raid names", () => {
    const label = runSetupSelectionLabel({
      name: "HC 10/10 VIP",
      contentTitle: "Venom & Tide & Kithix",
      difficulty: "HEROIC",
      lootType: "VIP",
      titleCoverage: "10/10",
    });
    expect(label).toBe("HC 10/10 VIP · Venom & Tide & Kithix");
    expect(label).not.toContain("The Venomous Abyss");
  });

  it("adds the run type only where the name does not already say it", () => {
    expect(
      runSetupSelectionLabel({ name: "Monday Bundle", contentTitle: "Venom & Tide", difficulty: "HEROIC", lootType: "VIP", titleCoverage: "9/9" }),
    ).toBe("Monday Bundle · Venom & Tide · HC VIP 9/9");
    expect(
      runSetupSelectionLabel({ name: "HC VIP late", contentTitle: "Venom", difficulty: "HEROIC", lootType: "VIP", titleCoverage: "8/8" }),
    ).toBe("HC VIP late · Venom · 8/8");
  });

  it("single-raid labels stay concise; a name that already names the content is not repeated", () => {
    expect(
      runSetupSelectionLabel({ name: "Venom HC", contentTitle: "Venom", difficulty: "HEROIC", lootType: "UNSAVED", titleCoverage: "8/8" }),
    ).toBe("Venom HC · Unsaved 8/8");
  });

  it("a name that names every raid in another order is not followed by the content again", () => {
    expect(
      runSetupSelectionLabel({ name: "HC VIP 9/9 · Venom & Tide", contentTitle: "Tide & Venom", difficulty: "HEROIC", lootType: "VIP", titleCoverage: "9/9" }),
    ).toBe("HC VIP 9/9 · Venom & Tide");
    expect(
      runSetupSelectionLabel({ name: "HC VIP 9/9 · Venom", contentTitle: "Tide & Venom", difficulty: "HEROIC", lootType: "VIP", titleCoverage: "9/9" }),
    ).toBe("HC VIP 9/9 · Venom · Tide & Venom");
  });

  it("default Run Setup names are compact", () => {
    expect(runSetupDefaultName({ contentTitle: "Venom & Tide & Kithix", difficulty: "HEROIC", lootType: "VIP", titleCoverage: "10/10" })).toBe(
      "HC VIP 10/10 · Venom & Tide & Kithix",
    );
  });

  it("existing-Run options are the Run title, plus the status unless Open", () => {
    expect(runSelectionLabel({ title: "Mon 20:00 HC VIP 10/10 Alantra", status: "OPEN" })).toBe("Mon 20:00 HC VIP 10/10 Alantra");
    expect(runSelectionLabel({ title: "Mon 20:00 HC VIP 10/10 Alantra", status: "PUBLISHED" })).toMatch(/^Mon 20:00 HC VIP 10\/10 Alantra · /);
  });
});
