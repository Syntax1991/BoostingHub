import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BOOSTER_GUIDE_CARDS } from "@/guides/booster-guide";
import { validateBoosterGuideCards } from "@/guides/booster-guide-publisher";
import { RAIDLEAD_GUIDE_CARDS } from "@/guides/raidlead-guide";
import { validateRaidleadGuideCards } from "@/guides/raidlead-guide-publisher";

const ALL_CARDS = [...BOOSTER_GUIDE_CARDS, ...RAIDLEAD_GUIDE_CARDS];
/** Long enough for three steps and one tip, short enough to read on a phone. */
const MAX_CARD_CHARS = 750;
const DEVELOPER_TERMS =
  /\b(api|sync|synced|snapshot|dto|state|lifecycle|backend|database|payload|endpoint|server|workflow|interface|RAID_LEAD|SELECTED|NOT_SELECTED)\b/;

function cardText(card: (typeof ALL_CARDS)[number]): string {
  return [card.title, card.description, ...(card.fields ?? []).flatMap((f) => [f.name, f.value])].join("\n");
}

function uiSources(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) {
        parts.push(readFileSync(path, "utf8"));
      }
    }
  };
  for (const dir of ["src/components", "src/app", "src/discord-bot", "src/lib"]) walk(resolve(dir));
  return parts.join("\n");
}

describe("guide cards for new users", () => {
  it.each(ALL_CARDS.map((c) => [c.key, c] as const))("%s avoids developer language", (_key, card) => {
    expect(cardText(card)).not.toMatch(DEVELOPER_TERMS);
    expect(cardText(card).toLowerCase()).not.toMatch(/\b(api|snapshot|lifecycle|dto)\b/);
  });

  it.each(ALL_CARDS.map((c) => [c.key, c] as const))("%s stays short enough for a phone", (_key, card) => {
    expect(cardText(card).length).toBeLessThanOrEqual(MAX_CARD_CHARS);
  });

  it.each(ALL_CARDS.map((c) => [c.key, c] as const))("%s asks one question in its title", (_key, card) => {
    expect(card.title).toMatch(/How do I .+\?$|What happens .+\?$/);
  });

  it("names the next step on every card with steps", () => {
    for (const card of ALL_CARDS) {
      if (card.key === "discord-signups") continue;
      expect(card.description, card.key).toMatch(/\*\*(Next|Last step):\*\*/);
    }
  });

  it("attaches an existing screenshot to every card with an image", () => {
    for (const card of ALL_CARDS) {
      if (card.imageFile) expect(existsSync(resolve("docs/guides/screenshots", card.imageFile)), card.key).toBe(true);
    }
  });

  it("points every card at its approved image", () => {
    expect(Object.fromEntries(ALL_CARDS.map((c) => [c.key, c.imageFile]))).toEqual({
      "getting-started": "live-bo-01-dashboard.png",
      characters: "live-bo-02-characters.png",
      "signing-up": "live-bo-04-signup.png",
      "discord-signups": null,
      "after-signing-up": "live-bo-05-my-runs.png",
      "raid-lead-basics": "live-rl-01-dashboard.png",
      "create-run": "live-rl-04-create-run.png",
      "open-manage-signups": "live-rl-06-run-overview.png",
      "build-roster": "live-rl-05-roster.png",
      "run-attendance": "live-rl-08-start-run.png",
      "complete-run": "rl-09-finish-run.png",
    });
  });

  it("does not reuse a screenshot across the Raid Lead cards", () => {
    const images = RAIDLEAD_GUIDE_CARDS.map((c) => c.imageFile);
    expect(new Set(images).size).toBe(images.length);
  });

  it("names only buttons and menu items that exist in the app or the bot", () => {
    const sources = uiSources();
    const notUiLabels = new Set(["Next:", "Last step:", "Pending:", "Selected:", "Not Selected:", "Withdrawn:"]);
    const missing = new Set<string>();
    for (const card of ALL_CARDS) {
      const names = [...cardText(card).matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]!);
      for (const name of [...names, ...(card.fields ?? []).map((f) => f.name)]) {
        if (/^\d+\.$/.test(name) || notUiLabels.has(name)) continue;
        // "Create 1 Draft" is built from a template in the form.
        const needle = name === "Create 1 Draft" ? "Draft${rows.length === 1" : name;
        if (!sources.includes(needle)) missing.add(name);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("passes both publisher validators", () => {
    expect(validateBoosterGuideCards()).toEqual([]);
    expect(validateRaidleadGuideCards()).toEqual([]);
  });

  it("does not use the retired roster button names", () => {
    const raidLeadText = RAIDLEAD_GUIDE_CARDS.map(cardText).join("\n");
    expect(raidLeadText).not.toMatch(/Save Roster|Update Roster|Publish Roster/);
  });
});
