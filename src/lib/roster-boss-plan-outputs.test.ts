import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bossesPlayedBySignup,
  bossPlanSummaryLines,
  plannedRunBosses,
  type RosterBossException,
} from "@/lib/roster-boss-plan";
import { renderFinalSetupText, type FinalSetupInput } from "@/lib/run-start-message";
import { buildRosterEmbed, formatRosterBossPlanLine } from "@/discord-bot/embeds/roster-embed";
import { buildRosterSelectedDmMessage, rosterBossPlanWebNotification } from "@/services/notification-content";
import { rosterEmbedRenderFingerprint, type RosterEmbedData } from "@/services/discord-sync.service";
import { bossCharacterForFight } from "@/services/consumable-audit-extract";
import type { DmRunContext } from "@/lib/discord-run-dm";

/**
 * PR C — what Discord, DMs, Start and the audit make of a boss plan: pure
 * renderers and helpers. A Run without exceptions must render exactly as
 * before everywhere.
 */

const bosses = plannedRunBosses([
  {
    id: "c-venom",
    raidName: "The Venomous Abyss",
    raidShortName: "Venom",
    sortOrder: 1,
    plannedBossCount: 6,
    bosses: Array.from({ length: 8 }, (_, index) => ({ id: `v${index + 1}`, name: `Venom ${index + 1}`, sortOrder: index + 1 })),
  },
  { id: "c-tide", raidName: "The Tidebound Grotto", raidShortName: "Tide", sortOrder: 2, plannedBossCount: 1, bosses: [{ id: "t1", name: "Tide", sortOrder: 1 }] },
]);

function row(slot: string, content: string, boss: string, role: RosterBossException["role"], play: string | null = null): RosterBossException {
  return { slotSignupId: slot, runRaidContentId: content, raidBossId: boss, playSignupId: play, role };
}

const labels = new Map([["alt", "Synpriest-Antonidas"]]);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("compact boss plan lines (Discord / Final Setup / DMs)", () => {
  it("consecutive identical assignments collapse into ranges; Bundles name each content; slot order kept; unchanged slots omitted", () => {
    const exceptions = [
      row("a", "c-venom", "v5", "HEALER", "alt"),
      row("a", "c-venom", "v6", "HEALER", "alt"),
      row("a", "c-tide", "t1", "RANGED_DPS"),
      row("b", "c-venom", "v1", "TANK"),
      row("b", "c-venom", "v2", "TANK"),
      row("b", "c-venom", "v4", "TANK"),
    ];
    const lines = bossPlanSummaryLines({
      bosses,
      exceptions,
      slots: [{ signupId: "b" }, { signupId: "untouched" }, { signupId: "a" }],
      characterLabelBySignupId: labels,
    });
    expect(lines.map((line) => [line.slot.signupId, line.plan])).toEqual([
      ["b", "Venom 1–2, 4: Tank"],
      ["a", "Venom 5–6: Synpriest-Antonidas · Healer; Tide 1: Ranged DPS"],
    ]);
  });
});

describe("Roster render fingerprint", () => {
  it("is unchanged without a plan and changes with one (so a plan change refreshes the message)", () => {
    expect(rosterEmbedRenderFingerprint("emoji")).toBe(rosterEmbedRenderFingerprint("emoji", ""));
    expect(rosterEmbedRenderFingerprint("emoji", "abc123")).not.toBe(rosterEmbedRenderFingerprint("emoji"));
  });
});

describe("who plays which planned boss (Start saved check)", () => {
  it("own Character everywhere it is not replaced (role-only keeps it); the alternate exactly its bosses", () => {
    const played = bossesPlayedBySignup({
      bosses,
      slotSignupIds: ["a", "b"],
      exceptions: [
        row("a", "c-venom", "v5", "HEALER", "alt"),
        row("a", "c-venom", "v6", "HEALER", "alt"),
        row("b", "c-venom", "v1", "TANK"),
        // a boss no longer planned and a slot not live are ignored
        row("a", "c-venom", "v7", "HEALER", "alt"),
        row("gone", "c-venom", "v1", "HEALER", "alt2"),
      ],
    });
    expect([...played.get("a")!]).toEqual(["v1", "v2", "v3", "v4", "t1"]);
    expect([...played.get("b")!]).toEqual(["v1", "v2", "v3", "v4", "v5", "v6", "t1"]);
    expect([...played.get("alt")!]).toEqual(["v5", "v6"]);
    expect(played.has("alt2")).toBe(false);
  });

  it("without exceptions every slot plays every planned boss (unchanged behaviour)", () => {
    const played = bossesPlayedBySignup({ bosses, slotSignupIds: ["a"], exceptions: [] });
    expect(played.get("a")!.size).toBe(bosses.length);
    expect(played.size).toBe(1);
  });
});

const embedData: RosterEmbedData = {
  runId: "run-1",
  runTitle: "Fri HC",
  raidName: "Venom",
  productLabel: "Venom",
  contentSummary: "Venom 6/8 · Tide 1/1",
  difficulty: "HEROIC",
  publishedAt: "2026-10-29T10:00:00.000Z",
  version: 4,
  targets: { tanks: 1, healers: 1, dps: 1, lootbuddies: 0 },
  groups: {
    tanks: [],
    healers: [
      { userId: "u1", userName: "Sham", discordUserId: "111", characterName: "Bexsham", characterRealm: "Antonidas", wowClass: "SHAMAN" },
    ],
    meleeDps: [],
    rangedDps: [
      { userId: "u2", userName: "Mage", discordUserId: null, characterName: "Bexmage", characterRealm: "Antonidas", wowClass: "MAGE" },
    ],
    unspecifiedDps: [],
    lootbuddies: [],
  },
  totalSelected: 2,
};

describe("Discord Roster message", () => {
  it("no boss plan: no Boss plan field — identical to a payload without the field", () => {
    const before = buildRosterEmbed(embedData).toJSON();
    expect(buildRosterEmbed({ ...embedData, bossPlan: [] }).toJSON()).toEqual(before);
    expect(JSON.stringify(before)).not.toContain("Boss plan");
  });

  it("one compact line per deviating slot, mention when linked, Character otherwise", () => {
    const embed = buildRosterEmbed({
      ...embedData,
      bossPlan: [
        { member: embedData.groups.healers[0]!, plan: "Venom 5–6: Synpriest-Antonidas · Healer; Tide 1: Ranged DPS" },
        { member: embedData.groups.rangedDps[0]!, plan: "Venom 3: Tank" },
      ],
    }).toJSON();
    const field = embed.fields!.find((candidate) => candidate.name === "📋 Boss plan")!;
    expect(field.value).toBe(
      "<@111> — Venom 5–6: Synpriest-Antonidas · Healer; Tide 1: Ranged DPS\nBexmage-Antonidas — Venom 3: Tank",
    );
    expect(formatRosterBossPlanLine(embedData.groups.rangedDps[0]!, "Venom 3: Tank")).toBe("Bexmage-Antonidas — Venom 3: Tank");
  });
});

const finalSetup: FinalSetupInput = {
  raidName: "Venom",
  productLabel: "Venom",
  contentSummary: "Venom 6/8 · Tide 1/1",
  difficulty: "HEROIC",
  lootType: "VIP",
  targets: { tanks: 0, healers: 1, dps: 1 },
  groups: {
    tanks: [],
    healers: [
      { discordUserId: "111", userName: "Sham", characterName: "Bexsham", characterRealm: "Antonidas", wowClass: "SHAMAN", classLabel: "Shaman", participationType: "BOOSTER", selectedRole: "HEALER" },
    ],
    dps: [],
    lootbuddies: [],
  },
};

describe("Final Setup (Run Start post / web preview)", () => {
  it("unchanged without a boss plan", () => {
    expect(renderFinalSetupText({ ...finalSetup, bossPlan: [] })).toBe(renderFinalSetupText(finalSetup));
    expect(renderFinalSetupText(finalSetup)).not.toContain("Boss plan");
  });

  it("adds one Boss plan section after the lineup", () => {
    const text = renderFinalSetupText({
      ...finalSetup,
      bossPlan: [{ discordUserId: "111", userName: "Sham", plan: "Venom 5–6: Synpriest-Antonidas · Healer" }],
    });
    expect(text).toContain("📋 **Boss plan**\n<@111> · Venom 5–6: Synpriest-Antonidas · Healer");
    expect(text.indexOf("Boss plan")).toBeGreaterThan(text.indexOf("Lootbuddies"));
  });
});

describe("roster DMs", () => {
  const run: DmRunContext = { runId: "run-1", contentTitle: "Venom & Tide", scheduledStartAt: "2026-10-30T19:00:00.000Z", difficulty: "HEROIC", lootType: "VIP" };
  const assignment = { participationType: "BOOSTER" as const, publishedRole: "HEALER" as const, characterName: "Bexsham", characterRealm: null, wowClass: "SHAMAN" as const };

  it("Boss Plan Update names the new plan (or every boss as rostered); the plain selected DM is unchanged without a plan", () => {
    const update = buildRosterSelectedDmMessage({
      run,
      assignment,
      runChannelId: null,
      bossPlan: "Venom 5–6: Synpriest-Antonidas · Healer",
      bossPlanUpdate: true,
    });
    expect(update).toContain("📋 **Boss Plan Update**");
    expect(update).toContain("Boss plan: Venom 5–6: Synpriest-Antonidas · Healer");
    expect(update).toContain("Your boss assignments changed — you are still in the roster.");
    expect(buildRosterSelectedDmMessage({ run, assignment, runChannelId: null, bossPlanUpdate: true })).toContain(
      "Boss plan: every boss as rostered",
    );
    const plain = buildRosterSelectedDmMessage({ run, assignment, runChannelId: null });
    expect(buildRosterSelectedDmMessage({ run, assignment, runChannelId: null, bossPlan: null })).toBe(plain);
    expect(plain).not.toContain("Boss plan");
  });

  it("a newly selected player with a plan sees it in the selected DM", () => {
    expect(
      buildRosterSelectedDmMessage({ run, assignment, runChannelId: null, bossPlan: "Tide 1: Ranged DPS" }),
    ).toContain("✅ **Roster Selected**");
  });

  it("web copy", () => {
    expect(rosterBossPlanWebNotification({ runId: "r", runTitle: "Fri HC", plan: "Venom 3: Tank" }).message).toBe(
      "Your boss assignments for Fri HC changed: Venom 3: Tank.",
    );
    expect(rosterBossPlanWebNotification({ runId: "r", runTitle: "Fri HC", plan: null }).message).toBe(
      "You now play every boss of Fri HC as rostered.",
    );
  });
});

describe("consumables audit: fight → assigned Character", () => {
  const alt = {
    characterName: "Synpriest",
    characterRealm: "Antonidas",
    characterRegion: "EU" as const,
    warcraftLogsId: null,
    wowClass: "PRIEST" as const,
    role: "HEALER" as const,
    bosses: [{ raidContentId: "c-venom", wclEncounterIds: [3005, 3006] }],
  };

  it("matches by Run content AND WCL encounter; other fights stay with the slot Character", () => {
    expect(bossCharacterForFight([alt], { raidContentId: "c-venom", encounterId: 3006 })).toBe(alt);
    expect(bossCharacterForFight([alt], { raidContentId: "c-tide", encounterId: 3006 })).toBeNull();
    expect(bossCharacterForFight([alt], { raidContentId: "c-venom", encounterId: 3001 })).toBeNull();
    expect(bossCharacterForFight([alt], { raidContentId: null, encounterId: 3006 })).toBeNull();
    expect(bossCharacterForFight(undefined, { raidContentId: "c-venom", encounterId: 3006 })).toBeNull();
  });
});
