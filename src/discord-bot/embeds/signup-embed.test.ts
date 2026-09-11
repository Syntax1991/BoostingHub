import { describe, expect, it } from "vitest";
import type { SignupEmbedData } from "@/services/discord-sync.service";
import { buildSignupButtons, buildSignupEmbed } from "@/discord-bot/embeds/signup-embed";
import { parseCustomId } from "@/discord-bot/custom-ids";

const base: SignupEmbedData = {
  runId: "r7777777-7777-4777-8777-777777777777",
  runTitle: "Weekend Heroic Catch-up",
  raidId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  raidName: "Manaforge Omega",
  difficulty: "HEROIC",
  lootType: "VIP",
  plannedBossCount: 7,
  totalBossCount: 9,
  scheduledStartAt: "2026-09-24T20:00:00.000Z",
  runStatus: "OPEN",
  signupWindowOpen: true,
  uniqueSignupCount: 5,
};

describe("buildSignupEmbed", () => {
  it("shows the unique signup count, never a row count, and never lists offered Characters", () => {
    const embed = buildSignupEmbed(base).toJSON();
    const signupsField = embed.fields?.find((field) => field.name === "Signups");
    expect(signupsField?.value).toBe("5 signups");
    const serialized = JSON.stringify(embed);
    expect(serialized).not.toMatch(/Stormhowl|character/i);
  });

  it("reflects a closed signup window in the footer", () => {
    const embed = buildSignupEmbed({ ...base, signupWindowOpen: false }).toJSON();
    expect(embed.footer?.text).toMatch(/closed/i);
  });

  it("shows the loot type and boss coverage", () => {
    const embed = buildSignupEmbed(base).toJSON();
    expect(embed.fields?.find((field) => field.name === "Loot")?.value).toBe("VIP");
    expect(embed.fields?.find((field) => field.name === "Bosses")?.value).toBe("7/9");
  });
});

describe("buildSignupButtons", () => {
  it("builds Signup, Lootbuddy, and Cancel buttons with runId-scoped custom ids", () => {
    const row = buildSignupButtons(base).toJSON();
    const components = row.components as Array<{ custom_id: string; disabled?: boolean; label: string }>;
    expect(components).toHaveLength(3);
    for (const component of components) {
      const parsed = parseCustomId(component.custom_id);
      expect(parsed?.runId).toBe(base.runId);
    }
    expect(components.map((c) => parseCustomId(c.custom_id)?.action)).toEqual(["signup", "lootbuddy", "cancel"]);
  });

  it("disables Signup and Lootbuddy but keeps Cancel enabled once the window is closed", () => {
    const row = buildSignupButtons({ ...base, signupWindowOpen: false }).toJSON();
    const components = row.components as Array<{ custom_id: string; disabled?: boolean }>;
    const byAction = new Map(components.map((c) => [parseCustomId(c.custom_id)?.action, c]));
    expect(byAction.get("signup")?.disabled).toBe(true);
    expect(byAction.get("lootbuddy")?.disabled).toBe(true);
    expect(byAction.get("cancel")?.disabled).toBeFalsy();
  });
});
