import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RAIDER_IO_BULK_MAX } from "@/lib/map-with-concurrency";
import {
  emptyRow,
  normalizeCreateRows,
  type CreateRow,
} from "@/components/characters/character-form-dialog";

function filled(id: string, url = `https://raider.io/characters/eu/antonidas/${id}`): CreateRow {
  return { ...emptyRow(id), url };
}

function resolved(id: string, name: string): CreateRow {
  return {
    ...filled(id),
    url: `https://raider.io/characters/eu/antonidas/${name}`,
    resolvedUrl: `https://raider.io/characters/eu/antonidas/${name}`,
    lookupStatus: "resolved",
    name,
    realm: "Antonidas",
    region: "EU",
    wowClass: "SHAMAN",
    itemLevel: 300,
    specialization: "Restoration",
  };
}

describe("normalizeCreateRows", () => {
  it("keeps exactly one empty row when given none or only unused empties", () => {
    expect(normalizeCreateRows([])).toHaveLength(1);
    expect(normalizeCreateRows([])[0]!.url).toBe("");

    const a = emptyRow("a");
    const b = emptyRow("b");
    const normalized = normalizeCreateRows([a, b]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]!.id).toBe("a");
  });

  it("appends one empty trailing row after the first filled URL", () => {
    const row = filled("r1");
    const normalized = normalizeCreateRows([row]);
    expect(normalized).toHaveLength(2);
    expect(normalized[0]!.id).toBe("r1");
    expect(normalized[1]!.url).toBe("");
    expect(normalized[1]!.id).not.toBe("r1");
  });

  it("does not append another empty when typing further in the same filled row", () => {
    const trailing = emptyRow("trail");
    const updated = { ...filled("r1"), url: "https://raider.io/characters/eu/antonidas/FooMore" };
    const normalized = normalizeCreateRows([updated, trailing]);
    expect(normalized).toHaveLength(2);
    expect(normalized[1]!.id).toBe("trail");
  });

  it("grows to a third empty after a second filled row", () => {
    const normalized = normalizeCreateRows([filled("r1"), filled("r2")]);
    expect(normalized.map((row) => row.url === "" )).toEqual([false, false, true]);
    expect(normalized).toHaveLength(3);
  });

  it("caps at 10: 9 filled + empty, and 10 filled with no 11th", () => {
    const nine = Array.from({ length: 9 }, (_, i) => filled(`r${i}`));
    const withEmpty = normalizeCreateRows(nine);
    expect(withEmpty).toHaveLength(10);
    expect(withEmpty[9]!.url).toBe("");

    const ten = Array.from({ length: 10 }, (_, i) => filled(`r${i}`));
    const full = normalizeCreateRows(ten);
    expect(full).toHaveLength(10);
    expect(full.every((row) => row.url.trim() !== "")).toBe(true);
  });

  it("never allows more than RAIDER_IO_BULK_MAX rows", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => filled(`r${i}`));
    expect(normalizeCreateRows(eleven)).toHaveLength(RAIDER_IO_BULK_MAX);
  });

  it("editing an earlier row keeps a single trailing empty without adding extras", () => {
    const trailing = emptyRow("trail");
    const rows = [filled("r1"), filled("r2"), trailing];
    const edited = [{ ...rows[0]!, url: "https://raider.io/characters/eu/antonidas/Changed" }, rows[1]!, trailing];
    const normalized = normalizeCreateRows(edited);
    expect(normalized).toHaveLength(3);
    expect(normalized[2]!.id).toBe("trail");
  });

  it("clearing a middle row collapses redundant trailing empties", () => {
    const trailing = emptyRow("trail");
    const cleared = { ...emptyRow("r2"), url: "" };
    const normalized = normalizeCreateRows([filled("r1"), cleared, trailing]);
    expect(normalized).toHaveLength(2);
    expect(normalized[0]!.id).toBe("r1");
    expect(normalized[1]!.url).toBe("");
  });

  it("removing a populated row leaves remaining filled + one trailing empty", () => {
    const trailing = emptyRow("trail");
    const afterRemove = normalizeCreateRows([filled("r2"), trailing]);
    expect(afterRemove).toHaveLength(2);
    expect(afterRemove[0]!.id).toBe("r2");
    expect(afterRemove[1]!.id).toBe("trail");
  });

  it("removing all populated rows leaves exactly one empty row", () => {
    const normalized = normalizeCreateRows([emptyRow("only")]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]!.url).toBe("");
  });

  it("preserves resolved / added lifecycle rows even with blank URL edge cases", () => {
    const added = { ...emptyRow("added"), createStatus: "added" as const, name: "Kept" };
    const resolvedBlankUrl = {
      ...emptyRow("res"),
      lookupStatus: "resolved" as const,
      resolvedUrl: "https://raider.io/characters/eu/antonidas/Kept",
      name: "Kept",
      realm: "Antonidas",
      region: "EU" as const,
      specialization: "Restoration",
    };
    const normalized = normalizeCreateRows([added, resolvedBlankUrl]);
    expect(normalized.map((row) => row.id)).toEqual(["added", "res"]);
  });

  it("preserves stable ids for populated and reusable trailing empty rows", () => {
    const r1 = filled("stable-1");
    const trail = emptyRow("stable-trail");
    const again = normalizeCreateRows([r1, trail]);
    expect(again[0]!.id).toBe("stable-1");
    expect(again[1]!.id).toBe("stable-trail");
  });
});

describe("Create readiness / lookup ignore trailing empty (source contracts)", () => {
  const source = readFileSync(new URL("./character-form-dialog.tsx", import.meta.url), "utf8");

  it("ignores blank URLs in lookup and create readiness filters", () => {
    expect(source).toContain("function rowsNeedingLookup");
    expect(source).toMatch(/const url = row\.url\.trim\(\);\s*if \(!url\) return false/);
    expect(source).toContain("row.lookupStatus === \"resolved\"");
    expect(source).toContain("Add ${pendingCreateRows.length} characters");
    expect(source).toContain("readyToBulkAdd");
  });

  it("excludes unresolved rows from batch duplicate detection", () => {
    expect(source).toContain("batchDuplicateIds");
    expect(source).toContain('row.lookupStatus !== "resolved"');
  });
});

describe("CharacterFormDialog — Raider.IO bulk Add Character", () => {
  const source = readFileSync(new URL("./character-form-dialog.tsx", import.meta.url), "utf8");

  it("starts create mode with one Raider.IO row and no manual Name/Realm/Region lookup", () => {
    expect(source).toContain("emptyRow()");
    expect(source).toContain('useState<CreateRow[]>(() => [emptyRow("create-row-0")])');
    expect(source).toContain("Raider.IO character link");
    expect(source).toContain('placeholder="Paste Raider.IO character link"');
    expect(source).not.toContain("antonidas/Synblast");
    expect(source).toContain("Look up characters");
    expect(source).not.toContain("+ Add another character");
    expect(source).not.toContain("function addRow");

    const createFormMatch = source.match(
      /mode === "create" \? \([\s\S]*?\) : \([\s\S]*?submitEdit/,
    );
    expect(createFormMatch?.[0] ?? "").not.toContain('name="name"');
    expect(createFormMatch?.[0] ?? "").not.toContain('name="realm"');
    expect(createFormMatch?.[0] ?? "").not.toContain("or enter manually");
    expect(source).toContain("Look up characters");
    expect(source).not.toMatch(/Look up character(?!s)/);
    expect(source).not.toContain("lookupCharacterAction");
  });

  it("puts Raider.IO input and Remove on the same controls row under the label", () => {
    // Number + content column; label above; input and Remove share one flex row.
    expect(source).toContain('className="flex gap-2"');
    expect(source).toContain("self-end");
    expect(source).toContain('htmlFor={`raiderIoUrl-${row.id}`}');
    expect(source).toContain('className="flex items-center gap-2"');
    expect(source).toContain('className="h-9 min-w-0 flex-1 rounded-md border border-border bg-surface px-2"');
    expect(source).toContain('className="h-9 shrink-0"');
    expect(source).not.toMatch(/flex items-(start|end) gap-2[\s\S]{0,400}Remove/);
  });

  it("auto-grows rows via normalizeCreateRows and never allows an 11th row", () => {
    expect(source).toContain("function normalizeCreateRows");
    expect(source).toContain("return normalizeCreateRows(updated)");
    expect(source).toContain("normalizeCreateRows(current.filter");
    expect(source).toContain("RAIDER_IO_BULK_MAX");
    expect(source).toContain("kept.slice(0, RAIDER_IO_BULK_MAX)");
  });

  it("uses stable row ids and row-local invalidation", () => {
    expect(source).toContain("crypto.randomUUID()");
    expect(source).toContain("key={row.id}");
    expect(source).toContain("function changeRowUrl");
    expect(source).toContain("clearRowPreview(row)");
    expect(source).toMatch(/if \(row\.id !== id\) return row/);
  });

  it("retries only unresolved/changed rows on lookup", () => {
    expect(source).toContain("function rowsNeedingLookup");
    expect(source).toContain('row.lookupStatus === "resolved" && row.resolvedUrl?.trim() === url');
    expect(source).toContain("lookupCharactersFromRaiderIoAction");
  });

  it("routes Enter in a Raider.IO row to Raider.IO lookup", () => {
    expect(source).toContain("onKeyDown={onRaiderIoKeyDown}");
    expect(source).toMatch(
      /function onRaiderIoKeyDown[\s\S]*key !== "Enter"[\s\S]*preventDefault\(\)[\s\S]*runBulkLookup/,
    );
  });

  it("shows Blizzard-canonical identity and independent Primary Spec / Offspecs per row", () => {
    expect(source).toContain("{row.name}-{row.realm} · {row.region}");
    expect(source).toContain("Identity from Raider.IO link · verified by Blizzard");
    expect(source).toContain("changeRowPrimarySpec");
    expect(source).toContain("toggleRowPlayableSpec");
    expect(source).toContain("Other playable specializations");
  });

  it("blocks batch duplicates and supports Add N characters + partial failure", () => {
    expect(source).toContain("batchDuplicateIds");
    expect(source).toContain("This character is already included in this batch.");
    expect(source).toContain("Add ${pendingCreateRows.length} characters");
    expect(source).toContain("createCharactersAction");
    expect(source).toContain('createStatus: "added"');
    expect(source).toContain("Adding characters…");
    expect(source).toContain("readyToBulkAdd");
  });

  it("keeps Edit Character as a single-character editor", () => {
    expect(source).toContain('mode === "create" ? "Add Character" : "Edit Character"');
    expect(source).toContain("updateCharacterAction");
    expect(source).toContain("Save changes");
    expect(source).toContain('name="name"');
    expect(source).toContain('name="realm"');
  });
});

describe("trailing empty ignored by create readiness math", () => {
  it("3 resolved ready rows + trailing empty still count as 3 for Add N", () => {
    const rows = [
      resolved("a", "Alpha"),
      resolved("b", "Bravo"),
      resolved("c", "Charlie"),
      emptyRow("trail"),
    ];
    const pending = rows.filter(
      (row) =>
        row.lookupStatus === "resolved" &&
        row.createStatus !== "added" &&
        Boolean(row.specialization) &&
        !row.alreadyOwned,
    );
    expect(pending).toHaveLength(3);
    expect(`Add ${pending.length} characters`).toBe("Add 3 characters");
  });
});
