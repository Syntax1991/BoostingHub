import { describe, expect, it } from "vitest";
import {
  isValidCharacterName,
  isValidRealmName,
  normalizeCharacterIdentity,
  prepareCharacterName,
  prepareRealmName,
} from "@/lib/character-identity";
import { findSpecialization, roleForSpecialization } from "@/lib/wow-specializations";

describe("character identity normalization", () => {
  it("treats case and surrounding whitespace as the same identity", () => {
    expect(normalizeCharacterIdentity("  Synblast ")).toBe("synblast");
    expect(normalizeCharacterIdentity("Tarren Mill")).toBe(normalizeCharacterIdentity("tarren mill"));
  });

  it("keeps diacritics so accented names stay distinct from ASCII lookalikes", () => {
    expect(normalizeCharacterIdentity("Éowyn")).not.toBe(normalizeCharacterIdentity("Eowyn"));
    expect(isValidCharacterName(prepareCharacterName("Éowyn"))).toBe(true);
  });

  it("rejects blank and oversized names", () => {
    expect(isValidCharacterName("")).toBe(false);
    expect(isValidCharacterName("A")).toBe(false);
    expect(isValidCharacterName("ThisNameIsWayTooLong")).toBe(false);
  });

  it("accepts realm names with spaces and digits", () => {
    expect(isValidRealmName(prepareRealmName("Area 52"))).toBe(true);
    expect(isValidRealmName(prepareRealmName("  Tarren   Mill "))).toBe(true);
    expect(prepareRealmName("  Tarren   Mill ")).toBe("Tarren Mill");
  });
});

describe("specialization catalog", () => {
  it("derives Restoration Shaman as HEALER and rejects Restoration Warrior", () => {
    expect(roleForSpecialization("SHAMAN", "Restoration")).toBe("HEALER");
    expect(findSpecialization("WARRIOR", "Restoration")).toBeNull();
  });
});
