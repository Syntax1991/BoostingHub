import { describe, expect, it } from "vitest";
import { buildRaidInviteMessage } from "@/discord-bot/messages/raid-invite-message";
import { absoluteRunUrl } from "@/lib/app-url";
import { dmRunMetaLine, type DmRunContext } from "@/lib/discord-run-dm";
import { contentShortTitle } from "@/lib/raid-catalog";
import {
  buildRosterCharacterSavedDmMessage,
  buildRosterRemovedDmMessage,
  buildRosterSelectedDmMessage,
  buildRosterSelectedSavedSummaryDmMessage,
  buildRosterWithdrawnDmMessage,
  buildRunCancelledDmMessage,
  buildRunReactivatedDmMessage,
  buildRunRescheduledDmMessage,
  buildRunScopeChangedDmMessage,
} from "@/services/notification-content";

/**
 * Every Run-related Discord DM shares one Run identity and hierarchy:
 *   EVENT HEADING / blank / compact content title / time · difficulty · Run type /
 *   blank / event-specific lines / blank / Run or Roster link (last).
 * The title is the shared `contentShortTitle` (Raid.shortName, content order) —
 * never the product label ("Season 2 Bundle") or the formal Raid names.
 */

const TITLE = "Venom & Tide & Kith'ix";
const run: DmRunContext = {
  runId: "run-dm-1",
  contentTitle: TITLE,
  scheduledStartAt: "2026-12-14T19:30:00.000Z",
  difficulty: "HEROIC",
  lootType: "VIP",
};
const RUN_URL = absoluteRunUrl(run.runId);
const META = "<t:1797276600:F> · HEROIC · VIP";
const FORMAL = /Season 2 Bundle|The Venomous Abyss|The Tidebound Grotto|The Unbinding of Kith/;

const assignment = {
  participationType: "BOOSTER" as const,
  publishedRole: "HEALER" as const,
  characterName: "Synmist",
  characterRealm: null,
  wowClass: "MONK" as const,
};

/** Every audited builder, rendered for the same Run. */
const DMS: Array<{ name: string; text: string; event: string[]; link: string | null }> = [
  {
    name: "roster selected",
    text: buildRosterSelectedDmMessage({ run, assignment, runChannelId: null }),
    event: ["Assignment: Healer · Synmist (Monk)", "You are in the roster."],
    link: RUN_URL,
  },
  {
    name: "roster update (Character swap)",
    text: buildRosterSelectedDmMessage({ run, assignment, runChannelId: "555", update: true }),
    event: ["Assignment: Healer · Synmist (Monk)", "Channel: <#555>", "Your character changed — you are still in the roster."],
    link: RUN_URL,
  },
  {
    name: "roster removed",
    text: buildRosterRemovedDmMessage({ run }),
    event: ["You are no longer in the roster for this run."],
    link: RUN_URL,
  },
  {
    name: "roster withdrawn (to the Raid Lead)",
    text: buildRosterWithdrawnDmMessage({
      run,
      playerName: "Kiri",
      characterLabel: "Synmist-Antonidas",
      reason: "Sick",
      rosterUrl: "https://example.test/runs/run-dm-1",
    }),
    event: ["**Kiri** (Synmist-Antonidas) withdrew from the roster.", "Reason: Sick"],
    link: "Pick a replacement: https://example.test/runs/run-dm-1",
  },
  {
    name: "raid invite",
    text: buildRaidInviteMessage({
      run,
      participationType: "BOOSTER",
      selectedRole: "HEALER",
      characterName: "Synmist",
      wowClass: "MONK",
      runChannelId: "555",
      voiceChannelId: "666",
    }),
    event: ["Assignment: Healer · Synmist (Monk)", "Channel: <#555>", "Voice: <#666>", "Please be online 10 minutes before start."],
    link: RUN_URL,
  },
  {
    name: "run cancelled",
    text: buildRunCancelledDmMessage({ run }),
    event: ["This run has been cancelled."],
    link: RUN_URL,
  },
  {
    name: "run reactivated",
    text: buildRunReactivatedDmMessage({ run }),
    event: ["The previously cancelled Run is active again."],
    link: RUN_URL,
  },
  {
    name: "run scope changed",
    text: buildRunScopeChangedDmMessage({
      run,
      changes: [{ raidId: "venom", raidName: "Venom", totalBossCount: 8, kind: "CHANGED", beforePlannedBossCount: 8, afterPlannedBossCount: 6 }],
    }),
    event: ["The planned raid scope changed:"],
    link: RUN_URL ? `Please review the updated Run: ${RUN_URL}` : "Please review the updated Run.",
  },
  {
    name: "picked Character got saved — player",
    text: buildRosterCharacterSavedDmMessage({
      run,
      audience: "player",
      characterLabel: "Synmist-Antonidas",
      playerName: "Kiri",
      bossNames: ["Boss A"],
      url: "https://example.test/runs/run-dm-1",
    }),
    event: ["**Synmist-Antonidas** is picked for this Run but already killed **Boss A** this raid ID — no loot there."],
    link: "https://example.test/runs/run-dm-1",
  },
  {
    name: "picked Character got saved — Raid Lead",
    text: buildRosterCharacterSavedDmMessage({
      run,
      audience: "lead",
      characterLabel: "Synmist-Antonidas",
      playerName: "Kiri",
      bossNames: ["Boss A"],
      url: "https://example.test/runs/run-dm-1",
    }),
    event: ["**Synmist-Antonidas** (Kiri) is picked and is now saved on **Boss A**."],
    link: "Check the roster: https://example.test/runs/run-dm-1",
  },
  {
    name: "Start Run saved reminder — player",
    text: buildRosterCharacterSavedDmMessage({
      run,
      audience: "start",
      characterLabel: "Synmist-Antonidas",
      playerName: "Kiri",
      bossNames: ["Boss A"],
      url: "https://example.test/runs/run-dm-1",
    }),
    event: ["**Synmist-Antonidas** is saved on **Boss A** — no loot from those bosses for you this Run."],
    link: "https://example.test/runs/run-dm-1",
  },
  {
    name: "Start Run saved summary — Raid Lead",
    text: buildRosterSelectedSavedSummaryDmMessage({
      run,
      message: "2 selected Characters are saved:\nSynblast-Antonidas — Boss B, Boss C\nSynmist-Antonidas — Boss A\nCheck the roster.",
      rosterUrl: "https://example.test/runs/run-dm-1",
    }),
    event: ["2 selected Characters are saved:", "Synblast-Antonidas — Boss B, Boss C", "Synmist-Antonidas — Boss A"],
    link: "https://example.test/runs/run-dm-1",
  },
];

describe("Run DM identity — the shared compact content title", () => {
  it("single / two / three Raids: Venom · Venom & Tide · Venom & Tide & Kith'ix (content order kept)", () => {
    const venom = { sortOrder: 1, raidName: "The Venomous Abyss", raidShortName: "Venom" };
    const tide = { sortOrder: 2, raidName: "The Tidebound Grotto", raidShortName: "Tide" };
    const kithix = { sortOrder: 3, raidName: "The Unbinding of Kith'ix", raidShortName: "Kith'ix" };
    expect(contentShortTitle([venom])).toBe("Venom");
    expect(contentShortTitle([tide, venom])).toBe("Venom & Tide");
    expect(contentShortTitle([kithix, venom, tide])).toBe("Venom & Tide & Kith'ix");
  });

  it("meta line: time · difficulty · Run type", () => {
    expect(dmRunMetaLine(run)).toBe(META);
  });

  it("the Run link resolves in tests (so every link assertion below is exercised)", () => {
    expect(RUN_URL).toMatch(/^https?:\/\/.+\/runs\/run-dm-1$/);
  });
});

describe.each(DMS)("Run DM hierarchy — $name", ({ text, event, link }) => {
  const lines = text.split("\n");

  it("heading, blank, compact title, time · difficulty · type, blank", () => {
    expect(lines[0]).toMatch(/^\S+ \*\*.+\*\*$/);
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe(TITLE);
    expect(lines[3]).toBe(META);
    expect(lines[4]).toBe("");
    expect(text).not.toMatch(FORMAL);
  });

  it("event-specific text intact; Run / Roster link last", () => {
    for (const line of event) expect(lines).toContain(line);
    if (link) {
      expect(lines.at(-1)).toBe(link);
      expect(lines.at(-2)).toBe("");
    }
  });
});

describe("Run Rescheduled DM", () => {
  it("compact title, then Old / New (no meta line), then the Run link", () => {
    const text = buildRunRescheduledDmMessage({ run, previousScheduledStartAt: "2026-12-13T19:30:00.000Z" });
    const lines = text.split("\n");
    expect(lines.slice(0, 7)).toEqual([
      "📅 **Run Rescheduled**",
      "",
      TITLE,
      "",
      "Old: <t:1797190200:F>",
      "New: <t:1797276600:F>",
      "",
    ]);
    expect(lines).toContain("Please check the updated run time.");
    if (RUN_URL) expect(lines.at(-1)).toBe(RUN_URL);
    expect(text).not.toMatch(FORMAL);
  });
});

describe("Roster Update acceptance case", () => {
  it("swap DM reads Roster Update · Venom & Tide & Kith'ix · meta · assignment · still in the roster", () => {
    const lines = buildRosterSelectedDmMessage({ run, assignment, runChannelId: null, update: true }).split("\n");
    expect(lines.slice(0, 8)).toEqual([
      "🔁 **Roster Update**",
      "",
      TITLE,
      META,
      "",
      "Assignment: Healer · Synmist (Monk)",
      "",
      "Your character changed — you are still in the roster.",
    ]);
  });
});
