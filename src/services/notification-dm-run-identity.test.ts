import { describe, expect, it } from "vitest";
import { buildRaidInviteMessage } from "@/discord-bot/messages/raid-invite-message";
import { absoluteRunUrl } from "@/lib/app-url";
import { dmLink, dmRunMetaLine, dmRunUrl, type DmRunContext } from "@/lib/discord-run-dm";
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
  rosterSelectedSavedSummaryWebNotification,
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
const RUN_URL = absoluteRunUrl(run.runId)!;
const EXAMPLE_URL = "https://example.test/runs/run-dm-1";
/** The closing action link as Discord receives it: label only, URL in <> (no preview card). */
const masked = (label: string, url: string) => `[${label}](<${url}>)`;
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
    link: masked("Open Run", RUN_URL),
  },
  {
    name: "roster update (Character swap)",
    text: buildRosterSelectedDmMessage({ run, assignment, runChannelId: "555", update: true }),
    event: ["Assignment: Healer · Synmist (Monk)", "Channel: <#555>", "Your character changed — you are still in the roster."],
    link: masked("Open Run", RUN_URL),
  },
  {
    name: "roster removed",
    text: buildRosterRemovedDmMessage({ run }),
    event: ["You are no longer in the roster for this run."],
    link: masked("Open Run", RUN_URL),
  },
  {
    name: "roster withdrawn (to the Raid Lead)",
    text: buildRosterWithdrawnDmMessage({
      run,
      playerName: "Kiri",
      characterLabel: "Synmist-Antonidas",
      reason: "Sick",
      rosterUrl: EXAMPLE_URL,
    }),
    event: ["**Kiri** (Synmist-Antonidas) withdrew from the roster.", "Reason: Sick"],
    link: masked("Pick a replacement", EXAMPLE_URL),
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
    link: masked("Open Run", RUN_URL),
  },
  {
    name: "run cancelled",
    text: buildRunCancelledDmMessage({ run }),
    event: ["This run has been cancelled."],
    link: masked("Open Run", RUN_URL),
  },
  {
    name: "run reactivated",
    text: buildRunReactivatedDmMessage({ run }),
    event: ["The previously cancelled Run is active again."],
    link: masked("Open Run", RUN_URL),
  },
  {
    name: "run scope changed",
    text: buildRunScopeChangedDmMessage({
      run,
      changes: [{ raidId: "venom", raidName: "Venom", totalBossCount: 8, kind: "CHANGED", beforePlannedBossCount: 8, afterPlannedBossCount: 6 }],
    }),
    event: ["The planned raid scope changed:"],
    link: masked("Review updated Run", RUN_URL),
  },
  {
    name: "picked Character got saved — player",
    text: buildRosterCharacterSavedDmMessage({
      run,
      audience: "player",
      characterLabel: "Synmist-Antonidas",
      playerName: "Kiri",
      bossNames: ["Boss A"],
      url: EXAMPLE_URL,
    }),
    event: ["**Synmist-Antonidas** is picked for this Run but already killed **Boss A** this raid ID — no loot there."],
    link: masked("Open Run", EXAMPLE_URL),
  },
  {
    name: "picked Character got saved — Raid Lead",
    text: buildRosterCharacterSavedDmMessage({
      run,
      audience: "lead",
      characterLabel: "Synmist-Antonidas",
      playerName: "Kiri",
      bossNames: ["Boss A"],
      url: EXAMPLE_URL,
    }),
    event: ["**Synmist-Antonidas** (Kiri) is picked and is now saved on **Boss A**."],
    link: masked("Open Roster", EXAMPLE_URL),
  },
  {
    name: "Start Run saved reminder — player",
    text: buildRosterCharacterSavedDmMessage({
      run,
      audience: "start",
      characterLabel: "Synmist-Antonidas",
      playerName: "Kiri",
      bossNames: ["Boss A"],
      url: EXAMPLE_URL,
    }),
    event: ["**Synmist-Antonidas** is saved on **Boss A** — no loot from those bosses for you this Run."],
    link: masked("Open Run", EXAMPLE_URL),
  },
  {
    name: "Start Run saved summary — Raid Lead",
    text: buildRosterSelectedSavedSummaryDmMessage({
      run,
      // The real stored notification copy (no trailing instruction — the link is the action).
      message: rosterSelectedSavedSummaryWebNotification({
        runId: run.runId,
        entries: [
          { characterLabel: "Synblast-Antonidas", bossNames: ["Boss B", "Boss C"] },
          { characterLabel: "Synmist-Antonidas", bossNames: ["Boss A"] },
        ],
      }).message,
      rosterUrl: EXAMPLE_URL,
    }),
    event: ["2 selected Characters are saved:", "Synblast-Antonidas — Boss B, Boss C", "Synmist-Antonidas — Boss A"],
    link: masked("Open Roster", EXAMPLE_URL),
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

  it("link targets: Open Run → Run Detail; Open Roster → the Roster tab (the Run Detail default tab, same URL)", () => {
    expect(dmRunUrl(run)).toBe(RUN_URL);
    expect(absoluteRunUrl(run.runId, "roster")).toBe(RUN_URL);
  });

  it("dmLink renders a masked link with the URL in angle brackets", () => {
    expect(dmLink("Open Run", "https://manawyrm-boosting.com/runs/r1")).toBe("[Open Run](<https://manawyrm-boosting.com/runs/r1>)");
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

  it("event-specific text intact; the action link is last — a label, never a raw URL", () => {
    for (const line of event) expect(lines).toContain(line);
    if (link) {
      expect(lines.at(-1)).toBe(link);
      expect(lines.at(-2)).toBe("");
    }
    // Every URL sits inside a masked link with <> (no wrapped raw URL, no website preview card).
    for (const line of lines.filter((l) => l.includes("http"))) {
      expect(line).toMatch(/^\[[^\]]+\]\(<https?:\/\/[^>]+>\)$/);
    }
  });
});

describe("Start Run Raid Lead summary DM ending", () => {
  it("entries, blank, [Open Roster](<url>) — no 'Check the roster.' before the link", () => {
    const text = DMS.find((dm) => dm.name === "Start Run saved summary — Raid Lead")!.text;
    expect(text.split("\n").slice(-4)).toEqual([
      "Synblast-Antonidas — Boss B, Boss C",
      "Synmist-Antonidas — Boss A",
      "",
      masked("Open Roster", EXAMPLE_URL),
    ]);
    expect(text).not.toContain("Check the roster.");
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
    expect(lines.at(-1)).toBe(masked("Open Run", RUN_URL));
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
