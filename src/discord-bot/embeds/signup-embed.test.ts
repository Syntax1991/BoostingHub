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
  roleStatus: {
    tank: { signed: 4, picked: 2, target: 2 },
    healer: { signed: 7, picked: 2, target: 2 },
    dps: { signed: 16, picked: 8, target: 8 },
    lootbuddy: { signed: 6, picked: 5 },
  },
};

describe("buildSignupEmbed", () => {
  it("splits offered and picked role counts into separate inline fields", () => {
    const embed = buildSignupEmbed(base).toJSON();
    const signupsByRole = embed.fields?.find((field) => field.name === "Signups by role");
    const picked = embed.fields?.find((field) => field.name === "Picked");

    expect(signupsByRole?.inline).toBe(true);
    expect(picked?.inline).toBe(true);

    expect(signupsByRole?.value).toContain("Tanks");
    expect(signupsByRole?.value).toContain("Healers");
    expect(signupsByRole?.value).toContain("DPS");
    expect(signupsByRole?.value).toContain("Lootbuddies");
    expect(signupsByRole?.value).toContain("— 4");
    expect(signupsByRole?.value).toContain("— 7");
    expect(signupsByRole?.value).toContain("— 16");
    expect(signupsByRole?.value).toContain("— 6");

    expect(picked?.value).toContain("Tanks");
    expect(picked?.value).toContain("Healers");
    expect(picked?.value).toContain("DPS");
    expect(picked?.value).toContain("Lootbuddies");
    expect(picked?.value).toContain("2/2");
    expect(picked?.value).toContain("8/8");
    expect(picked?.value).toMatch(/Lootbuddies\*\* — 5(?!\/)/);
    expect(picked?.value).not.toMatch(/5\/5/);

    const serialized = JSON.stringify(embed);
    expect(serialized).not.toMatch(/Stormhowl|character/i);
  });

  it("does not use the old combined signed · picked role lines", () => {
    const embed = buildSignupEmbed(base).toJSON();
    const rolesField = embed.fields?.find((field) => field.name === "Roles");
    expect(rolesField).toBeUndefined();

    const serialized = JSON.stringify(embed);
    expect(serialized).not.toMatch(/\d+ signed · /);
    expect(serialized).not.toMatch(/ signed · /);
    expect(serialized).not.toMatch(/\/\d+ picked/);
  });

  it("shows unique Signed users, never a projected role-offer sum", () => {
    const embed = buildSignupEmbed({
      ...base,
      uniqueSignupCount: 34,
      roleStatus: {
        tank: { signed: 10, picked: 2, target: 2 },
        healer: { signed: 12, picked: 4, target: 4 },
        dps: { signed: 16, picked: 14, target: 14 },
        lootbuddy: { signed: 0, picked: 0 },
      },
    }).toJSON();

    const signedUsers = embed.fields?.find((field) => field.name === "Signed users");
    expect(signedUsers?.value).toBe("34");
    expect(embed.fields?.find((field) => field.name === "Signups")).toBeUndefined();

    const signupsByRole = embed.fields?.find((field) => field.name === "Signups by role")?.value ?? "";
    expect(signupsByRole).toContain("— 10");
    expect(signupsByRole).toContain("— 12");
    expect(signupsByRole).toContain("— 16");
    // Projected role cards sum to 38 — must not appear as the global unique count.
    expect(signedUsers?.value).not.toBe("38");
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
