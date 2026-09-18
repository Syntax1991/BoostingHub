import { describe, expect, it } from "vitest";
import type { SignupEmbedData, SignupEmbedMember } from "@/services/discord-sync.service";
import {
  buildSignupButtons,
  buildSignupEmbed,
  emptySignupEmbedMembers,
  formatSignupParticipantLine,
  measureEmbedJsonSize,
  DISCORD_EMBED_TOTAL_CHAR_LIMIT,
} from "@/discord-bot/embeds/signup-embed";
import { parseCustomId } from "@/discord-bot/custom-ids";
import {
  DISCORD_EMBED_FIELD_COUNT_LIMIT,
  DISCORD_EMBED_FIELD_VALUE_LIMIT,
  chunkEmbedFieldLines,
} from "@/lib/discord-embed-field-chunking";

function member(
  partial: Partial<SignupEmbedMember> & Pick<SignupEmbedMember, "signupId" | "userId" | "userName">,
): SignupEmbedMember {
  return {
    discordUsername: null,
    discordUserId: null,
    characterName: null,
    characterRealm: null,
    wowClass: null,
    ...partial,
  };
}

function emptyData(overrides: Partial<SignupEmbedData> = {}): SignupEmbedData {
  return {
    runId: "r7777777-7777-4777-8777-777777777777",
    runTitle: "Weekend Heroic Catch-up",
    raidName: "The Venomous Abyss",
    productLabel: "The Venomous Abyss",
    contentSummary: "The Venomous Abyss 8/8",
    titleCoverage: "8/8",
    raidLeadName: "Titan",
    raidLeadDiscordUserId: "999000111222333444",
    difficulty: "HEROIC",
    lootType: "VIP",
    scheduledStartAt: "2026-09-24T20:00:00.000Z",
    runStatus: "OPEN",
    signupWindowOpen: true,
    uniqueSignupCount: 0,
    roleStatus: {
      tank: { signed: 0, picked: 0, target: 2 },
      healer: { signed: 0, picked: 0, target: 4 },
      dps: { signed: 0, picked: 0, target: 14 },
      lootbuddy: { signed: 0, picked: 0 },
    },
    members: {
      signed: emptySignupEmbedMembers(),
      picked: emptySignupEmbedMembers(),
    },
    ...overrides,
  };
}

describe("formatSignupParticipantLine", () => {
  it("formats Discord mention + class emoji without Character-Realm", () => {
    const line = formatSignupParticipantLine(
      member({
        signupId: "s1",
        userId: "u1",
        userName: "Display Name",
        discordUsername: "syntaxgg_1991",
        discordUserId: "123456789012345678",
        characterName: "Synblast",
        characterRealm: "Antonidas",
        wowClass: "SHAMAN",
      }),
      { SHAMAN: "<:shaman:987654321012345678>" },
    );
    expect(line).toBe("<@123456789012345678> <:shaman:987654321012345678>");
    expect(line).not.toContain("Synblast");
    expect(line).not.toContain("Antonidas");
    expect(line).not.toContain("Synblast-Antonidas");
  });

  it("falls back to @discordUsername when discordUserId is null", () => {
    const line = formatSignupParticipantLine(
      member({
        signupId: "s1",
        userId: "u1",
        userName: "Display Name",
        discordUsername: "syntaxgg_1991",
        characterName: "Synblast",
        characterRealm: "Antonidas",
        wowClass: "SHAMAN",
      }),
      { SHAMAN: "<:shaman:1>" },
    );
    expect(line).toBe("@syntaxgg_1991 <:shaman:1>");
  });

  it("falls back to @userName when discordUserId and discordUsername are null", () => {
    const line = formatSignupParticipantLine(
      member({
        signupId: "s1",
        userId: "u1",
        userName: "UserName",
        discordUsername: null,
        characterName: "Synblast",
        characterRealm: "Antonidas",
        wowClass: "SHAMAN",
      }),
      { SHAMAN: "<:shaman:1>" },
    );
    expect(line).toBe("@UserName <:shaman:1>");
    expect(line).not.toContain("Synblast");
    expect(line).not.toContain("Antonidas");
  });

  it("falls back to the class label when Guild emoji is missing", () => {
    const line = formatSignupParticipantLine(
      member({
        signupId: "s1",
        userId: "u1",
        userName: "PriestUser",
        discordUsername: "priest_user",
        discordUserId: "123456789012345678",
        characterName: "Holyone",
        characterRealm: "Antonidas",
        wowClass: "PRIEST",
      }),
      {},
    );
    expect(line).toBe("<@123456789012345678> Priest");
  });

  it("renders characterless Lootbuddy without inventing Character-Realm", () => {
    const withClass = formatSignupParticipantLine(
      member({
        signupId: "s1",
        userId: "u1",
        userName: "Loot",
        discordUsername: "loot_user",
        discordUserId: "123456789012345678",
        wowClass: "MAGE",
      }),
      { MAGE: "<:mage:111111111111111111>" },
    );
    expect(withClass).toBe("<@123456789012345678> <:mage:111111111111111111>");

    const noClass = formatSignupParticipantLine(
      member({
        signupId: "s2",
        userId: "u2",
        userName: "Loot2",
        discordUsername: "loot2",
        discordUserId: "123456789012345678",
      }),
    );
    expect(noClass).toBe("<@123456789012345678>");
  });
});

describe("chunkEmbedFieldLines", () => {
  it("never splits a line, never drops lines, and keeps order", () => {
    const lines = Array.from({ length: 40 }, (_, i) => {
      const id = `1${String(i).padStart(17, "0")}`;
      return `<@${id}> <:shaman:987654321012345678> Char${i}-Antonidas`;
    });
    const chunks = chunkEmbedFieldLines(lines);
    expect(chunks.flat()).toEqual(lines);
    for (const chunk of chunks) {
      expect(chunk.join("\n").length).toBeLessThanOrEqual(DISCORD_EMBED_FIELD_VALUE_LIMIT);
    }
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe("buildSignupEmbed", () => {
  it("returns exactly one EmbedBuilder", () => {
    const embed = buildSignupEmbed(emptyData());
    expect(embed).toBeTruthy();
    expect(Array.isArray(embed)).toBe(false);
    expect(embed.toJSON().title).toBe("Weekend Heroic Catch-up");
  });

  it("renders Tank|Healer|DPS as the primary inline grid with Lootbuddy after, Signups then Picked", () => {
    const tanks = [
      member({
        signupId: "t1",
        userId: "u1",
        userName: "Tank",
        discordUsername: "tank_user",
        discordUserId: "111111111111111111",
        characterName: "Tankone",
        characterRealm: "Antonidas",
        wowClass: "PALADIN",
      }),
    ];
    const healers = [
      member({
        signupId: "h1",
        userId: "u2",
        userName: "Heal",
        discordUsername: "heal_user",
        discordUserId: "222222222222222222",
        characterName: "Healone",
        characterRealm: "Antonidas",
        wowClass: "SHAMAN",
      }),
    ];
    const dps = [
      member({
        signupId: "d1",
        userId: "u3",
        userName: "Dps",
        discordUsername: "dps_user",
        discordUserId: "333333333333333333",
        characterName: "Dpsone",
        characterRealm: "Antonidas",
        wowClass: "MAGE",
      }),
    ];
    const loot = [
      member({
        signupId: "l1",
        userId: "u4",
        userName: "Loot",
        discordUsername: "loot_user",
        discordUserId: "444444444444444444",
        wowClass: "MAGE",
      }),
    ];

    const json = buildSignupEmbed(
      emptyData({
        uniqueSignupCount: 4,
        roleStatus: {
          tank: { signed: 1, picked: 1, target: 2 },
          healer: { signed: 1, picked: 1, target: 4 },
          dps: { signed: 1, picked: 1, target: 14 },
          lootbuddy: { signed: 1, picked: 1 },
        },
        members: {
          signed: { tanks, healers, dps, lootbuddies: loot },
          picked: { tanks, healers, dps, lootbuddies: loot },
        },
      }),
      {
        classIndicators: {
          PALADIN: "<:paladin:1>",
          SHAMAN: "<:shaman:2>",
          MAGE: "<:mage:3>",
        },
      },
    ).toJSON();

    const fields = json.fields ?? [];
    expect(fields.find((f) => f.name === "Signed users")?.value).toBe("4");

    const signupsHeading = fields.findIndex((f) => f.name === "Signups by role");
    const pickedHeading = fields.findIndex((f) => f.name === "Picked");
    expect(signupsHeading).toBeGreaterThanOrEqual(0);
    expect(pickedHeading).toBeGreaterThan(signupsHeading);
    expect(fields[signupsHeading]?.inline).toBe(false);
    expect(fields[pickedHeading]?.inline).toBe(false);
    expect(fields[signupsHeading]?.value).toBe("\u200b");

    const signupPrimaries = fields.slice(signupsHeading + 1, signupsHeading + 5);
    expect(signupPrimaries.map((f) => f.name)).toEqual([
      "🛡 Tanks — 1",
      "✚ Healers — 1",
      "⚔ DPS — 1",
      "📦 Lootbuddies — 1",
    ]);
    expect(signupPrimaries.every((f) => f.inline === true)).toBe(true);
    expect(signupPrimaries[0]?.value).toContain("<@111111111111111111> <:paladin:1>");
    expect(signupPrimaries[0]?.value).not.toContain("Tankone");
    expect(signupPrimaries[3]?.value).toBe("<@444444444444444444> <:mage:3>");

    const pickedPrimaries = fields.slice(pickedHeading + 1, pickedHeading + 5);
    expect(pickedPrimaries.map((f) => f.name)).toEqual([
      "🛡 Tanks — 1/2",
      "✚ Healers — 1/4",
      "⚔ DPS — 1/14",
      "📦 Lootbuddies — 1",
    ]);
    expect(JSON.stringify(json)).not.toMatch(/\d+ signed · /);
  });

  it("keeps empty role columns so the grid stays stable", () => {
    const fields = buildSignupEmbed(emptyData()).toJSON().fields ?? [];
    expect(fields.some((f) => f.name === "🛡 Tanks — 0")).toBe(true);
    expect(fields.find((f) => f.name === "🛡 Tanks — 0")?.value).toBe("—");
    expect(fields.some((f) => f.name === "🛡 Tanks — 0/2")).toBe(true);
  });

  it("shows unique Signed users, never a projected role-offer sum", () => {
    const fields = buildSignupEmbed(emptyData({ uniqueSignupCount: 34 })).toJSON().fields ?? [];
    expect(fields.find((f) => f.name === "Signed users")?.value).toBe("34");
    expect(fields.find((f) => f.name === "Signups")).toBeUndefined();
  });

  it("fits a realistic 25-user product capacity in ONE Embed without truncation", () => {
    function makeMembers(
      count: number,
      prefix: string,
      wowClass: SignupEmbedMember["wowClass"],
      startIndex = 0,
    ): SignupEmbedMember[] {
      return Array.from({ length: count }, (_, i) => {
        const n = startIndex + i;
        return member({
          signupId: `${prefix}-${n}`,
          userId: `user-${prefix}-${n}`,
          userName: `${prefix}User${n}`,
          discordUserId: `2${String(n).padStart(17, "0")}`,
          characterName: `${prefix}Char${n}`,
          characterRealm: "Twisting Nether",
          wowClass,
        });
      });
    }

    // 25 unique users: 4 tank / 6 healer / 15 dps boosters + 3 lootbuddies,
    // with 2 Tank+Healer and 2 Healer+DPS hybrids (duplicate role projections).
    const pureTanks = makeMembers(2, "T", "PALADIN", 0);
    const tankHealerHybrids = makeMembers(2, "TH", "PALADIN", 0).map((m, i) => ({
      ...m,
      signupId: `th-${i}`,
      userId: `user-th-${i}`,
    }));
    const pureHealers = makeMembers(2, "H", "SHAMAN", 0);
    const healerDpsHybrids = makeMembers(2, "HD", "SHAMAN", 0).map((m, i) => ({
      ...m,
      signupId: `hd-${i}`,
      userId: `user-hd-${i}`,
      wowClass: "PRIEST" as const,
    }));
    const pureDps = makeMembers(13, "D", "MAGE", 0);
    const lootbuddies = makeMembers(3, "L", "WARLOCK", 0).map((m) => ({
      ...m,
      characterName: null,
      characterRealm: null,
    }));

    const signed = {
      tanks: [...pureTanks, ...tankHealerHybrids],
      healers: [...pureHealers, ...tankHealerHybrids, ...healerDpsHybrids],
      dps: [...pureDps, ...healerDpsHybrids],
      lootbuddies,
    };
    // unique users: 2+2+2+2+13+3 = 24… add one more pure dps for 25
    const extraDps = makeMembers(1, "DX", "HUNTER", 0);
    signed.dps = [...signed.dps, ...extraDps];

    const uniqueUsers = new Set([
      ...signed.tanks.map((m) => m.userId),
      ...signed.healers.map((m) => m.userId),
      ...signed.dps.map((m) => m.userId),
      ...signed.lootbuddies.map((m) => m.userId),
    ]);
    expect(uniqueUsers.size).toBe(25);

    const pickedMembers = {
      tanks: signed.tanks.slice(0, 2),
      healers: signed.healers.slice(0, 4),
      dps: signed.dps.slice(0, 14),
      lootbuddies: signed.lootbuddies,
    };

    const indicators = {
      PALADIN: "<:paladin:1549226889409863761>",
      SHAMAN: "<:shaman:1549227028408963113>",
      PRIEST: "<:priest:1549227000000000000>",
      MAGE: "<:mage:1549226645443969125>",
      HUNTER: "<:hunter:1549226757536751636>",
      WARLOCK: "<:warlock:1549227100000000000>",
    } as const;

    const embed = buildSignupEmbed(
      emptyData({
        uniqueSignupCount: 25,
        roleStatus: {
          tank: { signed: signed.tanks.length, picked: 2, target: 2 },
          healer: { signed: signed.healers.length, picked: 4, target: 4 },
          dps: { signed: signed.dps.length, picked: 14, target: 14 },
          lootbuddy: { signed: 3, picked: 3 },
        },
        members: { signed, picked: pickedMembers },
      }),
      { classIndicators: indicators },
    );

    const json = embed.toJSON();
    const size = measureEmbedJsonSize(json);
    expect(size.fieldCount).toBeLessThanOrEqual(DISCORD_EMBED_FIELD_COUNT_LIMIT);
    expect(size.maxFieldChars).toBeLessThanOrEqual(DISCORD_EMBED_FIELD_VALUE_LIMIT);
    expect(size.totalChars).toBeLessThanOrEqual(DISCORD_EMBED_TOTAL_CHAR_LIMIT);

    const blob = (json.fields ?? []).map((f) => f.value).join("\n");
    for (const group of [signed.tanks, signed.healers, signed.dps, signed.lootbuddies]) {
      for (const row of group) {
        expect(blob).toContain(`<@${row.discordUserId}>`);
      }
    }
    for (const group of [
      pickedMembers.tanks,
      pickedMembers.healers,
      pickedMembers.dps,
      pickedMembers.lootbuddies,
    ]) {
      for (const row of group) {
        expect(blob).toContain(`<@${row.discordUserId}>`);
      }
    }
  });

  it("reflects a closed signup window in the footer", () => {
    const json = buildSignupEmbed(emptyData({ signupWindowOpen: false })).toJSON();
    expect(json.footer?.text).toMatch(/closed/i);
  });

  it("shows the loot type and Raid Lead (not Content)", () => {
    const fields = buildSignupEmbed(emptyData()).toJSON().fields ?? [];
    expect(fields.find((field) => field.name === "Loot")?.value).toBe("VIP");
    expect(fields.find((field) => field.name === "Content")).toBeUndefined();
    expect(fields.find((field) => field.name?.includes("Raid Lead"))?.value).toBe("<@999000111222333444>");
  });

  it("uses guild role emojis for role columns and Raid Lead when provided", () => {
    const fields = buildSignupEmbed(emptyData(), {
      roleIndicators: {
        tank: "<:tank:1>",
        healer: "<:healer:2>",
        dps: "<:dps:3>",
        raidlead: "<:raidlead:4>",
      },
    }).toJSON().fields ?? [];
    expect(fields.find((field) => field.name === "<:raidlead:4> Raid Lead")).toBeTruthy();
    expect(fields.some((field) => field.name.startsWith("<:tank:1> Tanks"))).toBe(true);
    expect(fields.some((field) => field.name.startsWith("<:healer:2> Healers"))).toBe(true);
    expect(fields.some((field) => field.name.startsWith("<:dps:3> DPS"))).toBe(true);
  });
});

describe("buildSignupButtons", () => {
  it("builds Signup, Lootbuddy, and Cancel buttons with runId-scoped custom ids", () => {
    const row = buildSignupButtons(emptyData()).toJSON();
    const components = row.components as Array<{ custom_id: string; disabled?: boolean; label: string }>;
    expect(components).toHaveLength(3);
    for (const component of components) {
      const parsed = parseCustomId(component.custom_id);
      expect(parsed?.runId).toBe("r7777777-7777-4777-8777-777777777777");
    }
    expect(components.map((c) => parseCustomId(c.custom_id)?.action)).toEqual(["signup", "lootbuddy", "cancel"]);
  });

  it("disables Signup and Lootbuddy but keeps Cancel enabled once the window is closed", () => {
    const row = buildSignupButtons(emptyData({ signupWindowOpen: false })).toJSON();
    const components = row.components as Array<{ custom_id: string; disabled?: boolean }>;
    const byAction = new Map(components.map((c) => [parseCustomId(c.custom_id)?.action, c]));
    expect(byAction.get("signup")?.disabled).toBe(true);
    expect(byAction.get("lootbuddy")?.disabled).toBe(true);
    expect(byAction.get("cancel")?.disabled).toBeFalsy();
  });
});
