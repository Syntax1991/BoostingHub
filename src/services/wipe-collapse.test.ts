import { describe, expect, it } from "vitest";
import type { AuditFightFact, AuditObservationFact, AuditPlayerFact } from "@/services/consumable-audit-policy";
import { deathContextOf, wipeCollapseOnset, wipeCollapseOnsets } from "@/services/wipe-collapse";

const S = 1_000;
const team = (n: number) => new Set(Array.from({ length: n }, (_, i) => `b${i + 1}`));
const died = (playerId: string, sec: number) => ({ playerId, atMs: sec * S });
const onset = (population: Set<string>, deaths: Array<{ playerId: string; atMs: number }>, kill = false) =>
  wipeCollapseOnset({ kill, population, deaths });

describe("boosting-team collapse (raid wipe) — the approved rule", () => {
  const T14 = team(14);

  it("1. three boosters within 10 s but fewer than half within 20 s → no collapse", () => {
    expect(onset(T14, [died("b1", 50), died("b2", 52), died("b3", 55), died("b4", 69)])).toBeNull();
  });

  it("2./3. three within 10 s and half within 20 s → collapse from the FIRST death of the cluster", () => {
    const deaths = [died("b1", 100), died("b2", 101), died("b3", 103), died("b4", 108), died("b5", 110), died("b6", 115), died("b7", 119.9)];
    expect(onset(T14, deaths)).toBe(100 * S);
  });

  it("4./5./6./7. isolated, two early and a three-player mechanic death stay active; the later terminal collapse is the onset", () => {
    const deaths = [
      died("b1", 26.6), // isolated
      died("b2", 40), died("b3", 42), // two early
      died("b4", 60), died("b5", 61), died("b6", 62), // mechanic failure, raid continues
      ...["b7", "b8", "b9", "b10", "b11", "b12", "b13"].map((id, i) => died(id, 112.5 + i * 0.4)), // collapse
    ];
    const at = onset(T14, deaths)!;
    expect(at).toBe(112.5 * S);
    expect([26.6, 40, 60, 62].map((sec) => deathContextOf(at, sec * S))).toEqual(Array(4).fill("ACTIVE_PULL"));
    expect(deathContextOf(at, 112.5 * S)).toBe("WIPE_CASCADE");
  });

  it("8. a trailing survivor (tank) dying 30 s after the collapse is still part of it", () => {
    const at = onset(T14, [...["b1", "b2", "b3", "b4", "b5", "b6", "b7"].map((id, i) => died(id, 100 + i)), died("b8", 140)])!;
    expect(deathContextOf(at, 140 * S)).toBe("WIPE_CASCADE");
  });

  it("9./10./11./12. deaths outside the booster population (buyers, lootbuddies, unmatched, externals) never count", () => {
    const buyers = ["buyer1", "buyer2", "loot1", "unmatched1", "external1"].map((id, i) => died(id, 50 + i));
    expect(onset(T14, [...buyers, died("b1", 51), died("b2", 52)])).toBeNull();
    // Five non-boosters + two boosters would be "3 in 10 s" and "half of 14" if they counted.
  });

  it("13. fewer than 5 boosters in the pull → never a collapse (conservative)", () => {
    expect(onset(team(4), [died("b1", 10), died("b2", 11), died("b3", 12), died("b4", 13)])).toBeNull();
  });

  it("14. exactly 5 boosters, 3 dying quickly → half reached, collapse", () => {
    expect(onset(team(5), [died("b1", 10), died("b2", 11), died("b3", 12)])).toBe(10 * S);
  });

  it("15. a battle-ressed booster dying twice counts once towards the thresholds", () => {
    // b1 dies, is ressed, dies again: 2 unique of 14 + b2 = 3 deaths but only 2 players.
    expect(onset(T14, [died("b1", 10), died("b1", 12), died("b2", 13)])).toBeNull();
  });

  it("15b. a battle-ressed booster's SECOND death still counts in a later window (unique per window, not per fight)", () => {
    // b1..b6 die early and are ressed (no collapse: 6 of 14 over 50 s). The real collapse starts with b1's second death.
    const early = ["b1", "b2", "b3", "b4", "b5", "b6"].map((id, i) => died(id, 30 + i * 10));
    const collapse = ["b1", "b2", "b3", "b4", "b5", "b6", "b7"].map((id, i) => died(id, 180 + i * 0.5));
    expect(onset(T14, early)).toBeNull();
    expect(onset(T14, [...early, ...collapse])).toBe(180 * S);
  });

  it("17. a kill never has a collapse, however many boosters die", () => {
    expect(onset(T14, [...T14].map((id, i) => died(id, 100 + i * 0.1)), true)).toBeNull();
  });
});

describe("wipeCollapseOnsets — population from the snapshot's facts", () => {
  const fight = (id: string, kill: boolean): AuditFightFact => ({
    id, reportCode: "R", wclFightId: 1, encounterName: "Sszorak", kill, startMs: 0, endMs: 300_000,
    raidContentId: null, warlockPresent: true, healthstoneUseSeen: false,
  });
  const obs = (fightId: string, kind: AuditObservationFact["kind"], atMs = 0): AuditObservationFact => ({
    fightId, kind, category: null, spellId: null, specId: null, atMs,
  });
  const player = (id: string, observations: AuditObservationFact[], overrides: Partial<AuditPlayerFact> = {}): AuditPlayerFact => ({
    id, displayName: id, characterName: id, characterRealm: "Blackhand", wowClass: "PALADIN", rosterRole: "DPS",
    matchStatus: "MATCHED", isExternal: false, observations, gear: [], ...overrides,
  });

  it("counts only matched audited boosters who took part in that pull; one timeline per pull", () => {
    const W = fight("w", false);
    const inPull = (id: string, deathSec: number | null) =>
      player(id, [obs("w", "COMBATANT"), ...(deathSec == null ? [] : [obs("w", "DEATH", deathSec * S)])]);
    const players = [
      inPull("a", 100), inPull("b", 101), inPull("c", 102), inPull("d", null), inPull("e", null), inPull("f", null),
      // Not population: unmatched, external, and one not in this pull at all.
      player("u", [obs("w", "DEATH", 99 * S)], { matchStatus: "NOT_IN_LOG" }),
      player("x", [], { matchStatus: "NO_CHARACTER_IDENTITY", isExternal: true }),
      player("absent", [obs("other", "COMBATANT")]),
    ];
    // 3 of 6 boosters within 1 s → half → collapse at the first of them.
    expect(wipeCollapseOnsets(players, [W, fight("other", false)])).toEqual(new Map([["w", 100 * S]]));
    // The same deaths in a kill → nothing.
    expect(wipeCollapseOnsets(players, [{ ...W, kill: true }])).toEqual(new Map());
  });
});
