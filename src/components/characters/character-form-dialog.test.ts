import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CharacterFormDialog — Raider.IO bulk Add Character", () => {
  const source = readFileSync(new URL("./character-form-dialog.tsx", import.meta.url), "utf8");

  it("starts create mode with one Raider.IO row and no manual Name/Realm/Region lookup", () => {
    expect(source).toContain("emptyRow()");
    expect(source).toContain('useState<CreateRow[]>(() => [emptyRow("create-row-0")])');
    expect(source).toContain("Raider.IO character link");
    expect(source).toContain("Look up characters");
    expect(source).toContain("+ Add another character");

    // Manual CREATE controls must be gone (edit mode may still use Name/Realm/Region).
    const createFormMatch = source.match(
      /mode === "create" \? \([\s\S]*?\) : \([\s\S]*?submitEdit/,
    );
    expect(createFormMatch?.[0] ?? "").not.toContain('name="name"');
    expect(createFormMatch?.[0] ?? "").not.toContain('name="realm"');
    expect(createFormMatch?.[0] ?? "").not.toContain("or enter manually");
    // Plural bulk button only — never the old singular manual "Look up character".
    expect(source).toContain("Look up characters");
    expect(source).not.toMatch(/Look up character(?!s)/);
    expect(source).not.toContain("lookupCharacterAction");
  });

  it("caps rows at RAIDER_IO_BULK_MAX and never allows an 11th row", () => {
    expect(source).toContain("RAIDER_IO_BULK_MAX");
    expect(source).toContain("if (current.length >= RAIDER_IO_BULK_MAX) return current");
    expect(source).toContain("rows.length >= RAIDER_IO_BULK_MAX");
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
  });
});
