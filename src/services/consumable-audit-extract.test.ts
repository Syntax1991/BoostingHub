import { describe, expect, it } from "vitest";
import type {
  WarcraftLogsConsumableEvents,
  WarcraftLogsReportMetadata,
} from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import {
  CONSUMABLE_PRE_PULL_WINDOW_MS,
  attributeCastsToFights,
  combatantCoverageByFight,
  extractConsumableAudit,
  restrictExtractedToFights,
  matchParticipantActors,
  realmKey,
  mergeExtractedAudits,
  type ConsumableAuditParticipant,
} from "@/services/consumable-audit-extract";

const ULATEK = 3492; // Venomous Abyss
const NYMRISSA = 3379; // Tidebound Grotto

function report(overrides: Partial<WarcraftLogsReportMetadata> = {}): WarcraftLogsReportMetadata {
  return {
    code: "AbCdEfGhIjKlMnOp",
    title: "Heroic VA",
    startTime: 1_790_000_000_000,
    endTime: 1_790_010_000_000,
    regionSlug: "EU",
    fights: [
      { id: 1, encounterId: NYMRISSA, name: "Nymrissa Wavecaller", startTime: 10_000, endTime: 300_000, kill: true, difficulty: 4, friendlyPlayers: [1, 2, 3] },
      { id: 4, encounterId: ULATEK, name: "Ula'tek", startTime: 400_000, endTime: 700_000, kill: false, difficulty: 4, friendlyPlayers: [1, 2, 3] },
      { id: 5, encounterId: ULATEK, name: "Ula'tek", startTime: 800_000, endTime: 1_200_000, kill: true, difficulty: 4, friendlyPlayers: [1, 2] },
    ],
    actors: [
      { id: 1, name: "Synlight", server: "Blackhand", subType: "Priest" },
      { id: 2, name: "Synblast", server: "Twisting Nether", subType: "Mage" },
      { id: 3, name: "Lockie", server: "Blackhand", subType: "Warlock" },
    ],
    rankedCharacters: [],
    ...overrides,
  };
}

function attended(
  name: string,
  realm: string,
  extra: Partial<Extract<ConsumableAuditParticipant, { source: "ATTENDANCE" }>> = {},
): ConsumableAuditParticipant {
  return {
    source: "ATTENDANCE",
    attendanceId: `att-${name}`,
    displayName: `${name} user`,
    characterName: name,
    characterRealm: realm,
    characterRegion: "EU",
    warcraftLogsId: null,
    wowClass: "PRIEST",
    role: "HEALER",
    ...extra,
  };
}

/** The Run's ASSIGNED fights (fight → Run association happens before extraction). */
const assignedFights = report().fights.map((fight) => ({
  ...fight,
  raidContentId: fight.encounterId === NYMRISSA ? "content-tide" : "content-va",
}));

describe("matchParticipantActors", () => {
  it("matches a known actor by name + realm, case/space/accent-insensitive", () => {
    expect(matchParticipantActors(attended("SYNLIGHT", "blackhand"), report())).toEqual({
      matchStatus: "MATCHED",
      actorIds: [1],
    });
    expect(matchParticipantActors(attended("Synblast", "twisting-nether"), report())).toEqual({
      matchStatus: "MATCHED",
      actorIds: [2],
    });
    expect(realmKey("Aggra (Português)")).toBe(realmKey("aggra-portugues"));
  });

  it("never matches by name alone — same name on another realm is not in the log", () => {
    expect(matchParticipantActors(attended("Synlight", "Frostmourne"), report()).matchStatus).toBe("NOT_IN_LOG");
  });

  it("reports a missing actor as NOT_IN_LOG", () => {
    expect(matchParticipantActors(attended("Nobody", "Blackhand"), report())).toEqual({
      matchStatus: "NOT_IN_LOG",
      actorIds: [],
    });
  });

  it("rejects a character from another region", () => {
    expect(
      matchParticipantActors(attended("Synlight", "Blackhand", { characterRegion: "US" }), report()).matchStatus,
    ).toBe("NOT_IN_LOG");
  });

  it("prefers the stored warcraftLogsId via ranked characters (survives renames)", () => {
    const renamed = attended("OldName", "Blackhand", { warcraftLogsId: "555" });
    const withRanked = report({
      rankedCharacters: [{ id: "555", canonicalId: "555", name: "Synlight", serverSlug: "blackhand" }],
    });
    expect(matchParticipantActors(renamed, withRanked)).toEqual({ matchStatus: "MATCHED", actorIds: [1] });
    expect(matchParticipantActors(renamed, report()).matchStatus).toBe("NOT_IN_LOG");
  });

  it("never matches an external booster (Discord name only)", () => {
    const external: ConsumableAuditParticipant = {
      source: "EXTERNAL",
      externalBoosterId: "ext-1",
      displayName: "Synlight",
      wowClass: "PRIEST",
      role: "HEALER",
    };
    expect(matchParticipantActors(external, report())).toEqual({
      matchStatus: "NO_CHARACTER_IDENTITY",
      actorIds: [],
    });
  });
});

describe("attributeCastsToFights", () => {
  it("attributes in-fight and pre-pull casts, and drops trash/between-pull casts", () => {
    const fights = [
      { id: 1, startTime: 10_000, endTime: 300_000 },
      { id: 2, startTime: 400_000, endTime: 700_000 },
    ];
    const casts = [
      { fight: 1, timestamp: 20_000, sourceId: 1, abilityId: 1 },
      { fight: null, timestamp: 400_000 - CONSUMABLE_PRE_PULL_WINDOW_MS + 1, sourceId: 1, abilityId: 1 },
      { fight: null, timestamp: 350_000, sourceId: 1, abilityId: 1 },
      { fight: 7, timestamp: 900_000, sourceId: 1, abilityId: 1 },
    ];
    expect(attributeCastsToFights(casts, fights).map((cast) => [cast.timestamp, cast.fight])).toEqual([
      [20_000, 1],
      [400_000 - CONSUMABLE_PRE_PULL_WINDOW_MS + 1, 2],
    ]);
  });
});

describe("extractConsumableAudit", () => {
  const events: WarcraftLogsConsumableEvents = {
    combatants: [
      { fight: 1, timestamp: 10_000, sourceId: 1, specId: 257, auraIds: [1235108, 465] },
      { fight: 4, timestamp: 400_000, sourceId: 1, specId: 258, auraIds: [465] },
      { fight: 5, timestamp: 800_000, sourceId: 3, auraIds: [] },
    ],
    casts: [
      { fight: 1, timestamp: 12_000, sourceId: 1, abilityId: 1236648 }, // Lightfused Mana Potion
      { fight: null, timestamp: 798_000, sourceId: 1, abilityId: 1236994 }, // pre-pull Recklessness
      { fight: 4, timestamp: 600_000, sourceId: 3, abilityId: 6262 }, // Lockie's Healthstone
      { fight: 4, timestamp: 610_000, sourceId: 1, abilityId: 99999 }, // not in catalog
    ],
    deaths: [
      { fight: 4, timestamp: 650_000, targetId: 1 },
      { fight: 5, timestamp: 900_000, targetId: 1 },
    ],
  };

  const extracted = extractConsumableAudit({
    report: report(),
    fights: assignedFights,
    events,
    participants: [
      attended("Synlight", "Blackhand"),
      attended("Nobody", "Blackhand"),
      { source: "EXTERNAL", externalBoosterId: "ext-1", displayName: "helper", wowClass: "MAGE", role: "RANGED_DPS" },
    ],
  });

  it("stores the specialization played per fight on the COMBATANT fact, never the roster role", () => {
    const synlight = extracted.players[0]!;
    const combatants = synlight.observations.filter((row) => row.kind === "COMBATANT");
    expect(combatants.map((row) => [row.wclFightId, row.specId])).toEqual([
      [1, 257],
      [4, 258],
    ]);
    expect(synlight.observations.filter((row) => row.kind !== "COMBATANT").every((row) => row.specId === null)).toBe(true);
    expect(synlight.role).toBe("HEALER"); // roster role kept for reference only (Synlight played Holy + Shadow)
  });

  it("records fight-level Warlock presence and Healthstone evidence", () => {
    expect(extracted.fights.map((fight) => [fight.wclFightId, fight.warlockPresent, fight.healthstoneUseSeen])).toEqual([
      [1, true, false],
      [4, true, true],
      [5, true, false], // not in friendlyPlayers, but a Warlock CombatantInfo snapshot exists
    ]);
  });

  it("stores normalized facts per matched player, per fight", () => {
    const synlight = extracted.players[0]!;
    expect(synlight.matchStatus).toBe("MATCHED");
    expect(synlight.wclActorId).toBe(1);
    const facts = synlight.observations.map((row) => [row.wclFightId, row.kind, row.category, row.atMs]);
    expect(facts).toEqual([
      [1, "COMBATANT", null, 10_000],
      [1, "AURA", "FLASK", 10_000],
      [1, "CAST", "MANA_POTION", 12_000],
      [4, "COMBATANT", null, 400_000],
      [4, "DEATH", null, 650_000],
      [5, "CAST", "DAMAGE_POTION", 798_000],
      [5, "PARTICIPANT", null, 800_000],
      [5, "DEATH", null, 900_000],
    ]);
  });

  it("detects Light's Potential (incl. the cauldron's Fleeting variant, same WCL ability 1236616) as a combat potion", () => {
    const withLightsPotential = extractConsumableAudit({
      report: report(),
      fights: assignedFights,
      events: { ...events, casts: [{ fight: 1, timestamp: 11_100, sourceId: 1, abilityId: 1236616 }] },
      participants: [attended("Synlight", "Blackhand")],
    });
    expect(
      withLightsPotential.players[0]!.observations.filter((row) => row.kind === "CAST").map((row) => [row.category, row.spellId]),
    ).toEqual([["DAMAGE_POTION", 1236616]]);
  });

  it("restricting to a set of fights drops every fact of the other fights (COMBATANT, AURA, CAST, DEATH, PARTICIPANT, gear)", () => {
    const only1 = restrictExtractedToFights(extracted, new Set(["AbCdEfGhIjKlMnOp#1"]));
    expect(only1.fights.map((fight) => fight.wclFightId)).toEqual([1]);
    for (const player of only1.players) {
      expect(player.observations.every((row) => row.wclFightId === 1)).toBe(true);
      expect(player.gear.every((row) => row.wclFightId === 1)).toBe(true);
    }
    expect(only1.players[0]!.observations.map((row) => row.kind)).toEqual(["COMBATANT", "AURA", "CAST"]);
    expect(only1.players.map((player) => player.matchStatus)).toEqual(extracted.players.map((player) => player.matchStatus));
    // Synlight: snapshots in fights 1 and 4; in fight 5 present (PARTICIPANT) without one.
    expect(combatantCoverageByFight(extracted)).toEqual(
      new Map([
        ["AbCdEfGhIjKlMnOp#1", { present: 1, snapshots: 1 }],
        ["AbCdEfGhIjKlMnOp#4", { present: 1, snapshots: 1 }],
        ["AbCdEfGhIjKlMnOp#5", { present: 1, snapshots: 0 }],
      ]),
    );
  });

  it("stores the player's OWN personal defensive casts — never another player's, never offensive or unknown spells", () => {
    const withDefensives = extractConsumableAudit({
      report: report(),
      fights: assignedFights,
      events: {
        ...events,
        casts: [
          { fight: 1, timestamp: 11_000, sourceId: 1, abilityId: 403876 }, // Synlight: Divine Protection
          { fight: 1, timestamp: 11_500, sourceId: 3, abilityId: 642 }, // another player's Divine Shield
          { fight: 1, timestamp: 12_000, sourceId: 1, abilityId: 31884 }, // Avenging Wrath (offensive)
          { fight: 1, timestamp: 12_500, sourceId: 1, abilityId: 999_999 }, // unknown
        ],
      },
      participants: [attended("Synlight", "Blackhand")],
    });
    expect(
      withDefensives.players[0]!.observations.filter((row) => row.kind === "CAST").map((row) => [row.category, row.spellId, row.atMs]),
    ).toEqual([["PERSONAL_DEFENSIVE", 403876, 11_000]]);
  });

  it("keeps unmatched and external players with no facts", () => {
    expect(extracted.players[1]).toMatchObject({ matchStatus: "NOT_IN_LOG", observations: [] });
    expect(extracted.players[2]).toMatchObject({
      matchStatus: "NO_CHARACTER_IDENTITY",
      externalBoosterId: "ext-1",
      characterName: null,
      observations: [],
    });
  });
});

describe("report identity on facts", () => {
  const participants: ConsumableAuditParticipant[] = [attended("Synlight", "Blackhand"), attended("Nobody", "Blackhand")];
  const one = extractConsumableAudit({
    report: report(),
    fights: assignedFights.slice(0, 1),
    events: { casts: [], deaths: [{ fight: 1, timestamp: 50_000, targetId: 1 }], combatants: [] },
    participants,
  });
  const other = extractConsumableAudit({
    report: report({ code: "ZyXwVuTsRqPoNmLk", actors: [{ id: 9, name: "Nobody", server: "Blackhand", subType: "Mage" }] }),
    fights: [{ ...assignedFights[0]!, friendlyPlayers: [9] }],
    events: { casts: [], deaths: [{ fight: 1, timestamp: 60_000, targetId: 9 }], combatants: [] },
    participants,
  });

  it("stamps every fight and fact with its report code (fight ids repeat across reports)", () => {
    expect(one.fights[0]).toMatchObject({ reportCode: "AbCdEfGhIjKlMnOp", wclFightId: 1 });
    expect(one.players[0]!.observations.every((row) => row.reportCode === "AbCdEfGhIjKlMnOp")).toBe(true);
  });

  it("merges per-report extractions for one Run without mixing fights", () => {
    const merged = mergeExtractedAudits([one, other]);
    expect(merged.fights.map((row) => `${row.reportCode}#${row.wclFightId}`)).toEqual([
      "AbCdEfGhIjKlMnOp#1",
      "ZyXwVuTsRqPoNmLk#1",
    ]);
    expect(merged.players[0]!.matchStatus).toBe("MATCHED");
    expect(merged.players[1]).toMatchObject({ matchStatus: "MATCHED", wclActorId: 9 });
    expect(merged.players[1]!.observations.map((row) => row.reportCode)).toEqual(["ZyXwVuTsRqPoNmLk", "ZyXwVuTsRqPoNmLk"]);
  });
});

describe("extractConsumableAudit — food, runes and gear at pull", () => {
  const extracted = extractConsumableAudit({
    report: report(),
    fights: assignedFights,
    events: {
      casts: [],
      deaths: [],
      combatants: [
        {
          fight: 1,
          timestamp: 10_000,
          sourceId: 1,
          auraIds: [1285644, 1303171, 1234969, 465],
          auraNames: {
            1285644: "Hearty Well Fed",
            1303171: "Vantus Rune: Tides",
            1234969: "Ethereal Augmentation",
            465: "Devotion Aura",
          },
          gear: [
            { slot: 0, itemId: 271492, permanentEnchantId: 8017, temporaryEnchantId: null, gemIds: [], bonusIds: [13695] },
            { slot: 1, itemId: 268265, permanentEnchantId: null, temporaryEnchantId: null, gemIds: [240900, 240983], bonusIds: [6652, 13668, 13334, 13987, 12852] },
            { slot: 5, itemId: 251155, permanentEnchantId: null, temporaryEnchantId: null, gemIds: [], bonusIds: [] },
            { slot: 15, itemId: 265337, permanentEnchantId: 8039, temporaryEnchantId: 8052, gemIds: [], bonusIds: [] },
          ],
        },
        // A second snapshot for the same fight is ignored (first one wins).
        { fight: 1, timestamp: 11_000, sourceId: 1, auraIds: [], gear: [] },
      ],
    },
    participants: [attended("Synlight", "Blackhand")],
  });
  const player = extracted.players[0]!;

  it("classifies food and Vantus buffs by name, augment runes by id", () => {
    expect(player.observations.filter((row) => row.kind === "AURA").map((row) => [row.category, row.spellId])).toEqual([
      ["FOOD", 1285644],
      ["VANTUS_RUNE", 1303171],
      ["AUGMENT_RUNE", 1234969],
    ]);
  });

  it("stores enchantable slots, weapons and socketed items with their sockets; skips the rest", () => {
    expect(player.gear.map((row) => [row.slot, row.permanentEnchantId, row.temporaryEnchantId, row.gemCount, row.socketCount])).toEqual([
      [0, 8017, null, 0, 1], // head: socket from bonus 13695, empty
      [1, null, null, 2, 2], // neck: two base sockets, both filled
      [15, 8039, 8052, 0, 0], // main hand: enchant + oil
    ]);
    expect(player.gear.every((row) => row.reportCode === report().code && row.wclFightId === 1)).toBe(true);
  });
});
