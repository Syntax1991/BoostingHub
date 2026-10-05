import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CharacterFormDialog — Raider.IO Add Character", () => {
  const source = readFileSync(new URL("./character-form-dialog.tsx", import.meta.url), "utf8");

  it("exposes a Raider.IO character link field and lookup in create mode", () => {
    expect(source).toContain("Raider.IO character link");
    expect(source).toContain("Look up from Raider.IO");
    expect(source).toContain("lookupCharacterFromRaiderIoAction");
    expect(source).toContain("or enter manually");
    expect(source).toContain("https://raider.io/characters/eu/antonidas/Synblast");
  });

  it("keeps the manual Name / Realm / Region lookup flow", () => {
    expect(source).toContain("Look up character");
    expect(source).toContain("lookupCharacterAction");
    expect(source).toContain('name="name"');
    expect(source).toContain('name="realm"');
    expect(source).toContain('aria-label="Region"');
  });

  it("populates Blizzard-canonical identity and leaves specs empty after Raider.IO lookup", () => {
    expect(source).toContain("data.name");
    expect(source).toContain("data.realm");
    expect(source).toContain("data.region");
    expect(source).toContain('setSpecialization("")');
    expect(source).toContain("setPlayableSpecs([])");
  });

  it("still creates via createCharacterAction (server re-resolves Blizzard)", () => {
    expect(source).toContain("createCharacterAction");
    expect(source).toContain("{ ...identity, specialization, playableSpecs }");
  });

  it("invalidates lookup when identity fields change", () => {
    expect(source).toContain("function updateIdentity");
    expect(source).toContain("clearLookupState()");
    expect(source).toMatch(/function updateIdentity[\s\S]*clearLookupState\(\)/);
  });

  it("keeps Primary Spec / Offspecs and Blizzard Class/Item Level labels", () => {
    expect(source).toContain("Primary specialization");
    expect(source).toContain("Other playable specializations");
    expect(source).toContain("(Blizzard)");
    expect(source).not.toContain("Battle.net-linked");
  });
});
