import { describe, expect, it } from "vitest";
import type { SignupEmbedData, SignupEmbedMember } from "@/services/discord-sync.service";
import {
  buildSignupButtons,
  buildSignupEmbeds,
  decodeSignupMessageIds,
  encodeSignupMessageIds,
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

function member(partial: Partial<SignupEmbedMember> & Pick<SignupEmbedMember, "signupId" | "userId" | "userName">): SignupEmbedMember {
  return {
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
    raidId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    raidName: "Manaforge Omega",
    difficulty: "HEROIC",
    lootType: "VIP",
    plannedBossCount: 7,
    totalBossCount: 9,
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
  it("formats Discord mention + class emoji + Character-Realm", () => {
    const line = formatSignupParticipantLine(
      member({
        signupId: "s1",
        userId: "u1",
        userName: "syntax_1991",
        discordUserId: "123456789012345678",
        characterName: "Synblast",
        characterRealm: "Antonidas",
        wowClass: "SHAMAN",
      }),
      { SHAMAN: "<:shaman:987654321012345678>" },
    );
    expect(line).toBe("<@123456789012345678> <:shaman:987654321012345678> Synblast-Antonidas");
  });

  it("falls back to @UserName when discordUserId is null", () => {
    const line = formatSignupParticipantLine(
      member({
        signupId: "s1",
        userId: "u1",
        userName: "syntax_1991",
        characterName: "Synblast",
        characterRealm: "Antonidas",
        wowClass: "SHAMAN",
      }),
      { SHAMAN: "<:shaman:1>" },
    );
    expect(line.startsWith("@syntax_1991 ")).toBe(true);
  });

  it("falls back to the class label when Guild emoji is missing", () => {
    const line = formatSignupParticipantLine(
      member({
        signupId: "s1",
        userId: "u1",
        userName: "PriestUser",
        discordUserId: "123456789012345678",
        characterName: "Holyone",
        characterRealm: "Antonidas",
        wowClass: "PRIEST",
      }),
      {},
    );
    expect(line).toBe("<@123456789012345678> Priest Holyone-Antonidas");
  });

  it("renders characterless Lootbuddy without inventing Character-Realm", () => {
    const withClass = formatSignupParticipantLine(
      member({
        signupId: "s1",
        userId: "u1",
        userName: "Loot",
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
        discordUserId: "123456789012345678",
      }),
    );
    expect(noClass).toBe("<@123456789012345678>");
  });
});

describe("chunkEmbedFieldLines", () => {
  it("never splits a line, never drops lines, and keeps order", () => {
    const lines = Array.from({ length: 40 }, (_, i) => {
      const id = String(100000000000000000 + i);
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

describe("buildSignupEmbeds", () => {
  it("renders Tank|Healer|DPS as the primary inline grid with Lootbuddy after", () => {
    const tanks = [
      member({
        signupId: "t1",
        userId: "u1",
        userName: "Tank",
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
        discordUserId: "444444444444444444",
        wowClass: "MAGE",
      }),
    ];

    const [summary, signups, picked] = buildSignupEmbeds(
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
    ).map((embed) => embed.toJSON());

    expect(summary.fields?.find((f) => f.name === "Signed users")?.value).toBe("4");
    expect(signups.title).toBe("Signups by role");
    const signupFields = signups.fields ?? [];
    const signupPrimaries = signupFields.slice(0, 4);
    expect(signupPrimaries.map((f) => f.name)).toEqual([
      "🛡 Tanks — 1",
      "✚ Healers — 1",
      "⚔ DPS — 1",
      "📦 Lootbuddies — 1",
    ]);
    expect(signupPrimaries.every((f) => f.inline === true)).toBe(true);
    expect(signupPrimaries[0]?.value).toContain("<@111111111111111111> <:paladin:1> Tankone-Antonidas");
    expect(signupPrimaries[3]?.value).toBe("<@444444444444444444> <:mage:3>");

    expect(picked.title).toBe("Picked");
    const pickedFields = picked.fields ?? [];
    expect(pickedFields.some((f) => f.name === "🛡 Tanks — 1/2")).toBe(true);
    expect(JSON.stringify([summary, signups, picked])).not.toMatch(/\d+ signed · /);
  });

  it("keeps empty role columns so the grid stays stable", () => {
    const [, signups, picked] = buildSignupEmbeds(emptyData()).map((e) => e.toJSON());
    expect((signups.fields ?? []).some((f) => f.name === "🛡 Tanks — 0")).toBe(true);
    expect((signups.fields ?? []).find((f) => f.name === "🛡 Tanks — 0")?.value).toBe("—");
    expect((picked.fields ?? []).some((f) => f.name === "🛡 Tanks — 0/2")).toBe(true);
  });

  it("shows unique Signed users on the summary message, never a projected role-offer sum", () => {
    const [summary] = buildSignupEmbeds(
      emptyData({
        uniqueSignupCount: 34,
      }),
    ).map((e) => e.toJSON());
    expect(summary.fields?.find((f) => f.name === "Signed users")?.value).toBe("34");
    expect(summary.fields?.find((f) => f.name === "Signups")).toBeUndefined();
  });

  it("fits a realistic QA-scale roster using three messages without truncation", () => {
    function makeMembers(count: number, prefix: string, wowClass: SignupEmbedMember["wowClass"]): SignupEmbedMember[] {
      return Array.from({ length: count }, (_, i) =>
        member({
          signupId: `${prefix}-${i}`,
          userId: `user-${prefix}-${i}`,
          userName: `${prefix}User${i}`,
          discordUserId: `2${String(i).padStart(17, "0")}`,
          characterName: `${prefix}Char${i}`,
          characterRealm: "Twisting Nether",
          wowClass,
        }),
      );
    }

    const signed = {
      tanks: makeMembers(13, "T", "PALADIN"),
      healers: makeMembers(20, "H", "SHAMAN"),
      dps: makeMembers(39, "D", "MAGE"),
      lootbuddies: makeMembers(5, "L", "WARLOCK").map((m) => ({
        ...m,
        characterName: null,
        characterRealm: null,
      })),
    };
    const pickedMembers = {
      tanks: signed.tanks.slice(0, 2),
      healers: signed.healers.slice(0, 4),
      dps: signed.dps.slice(0, 14),
      lootbuddies: signed.lootbuddies,
    };

    const indicators = {
      PALADIN: "<:paladin:1549226889409863761>",
      SHAMAN: "<:shaman:1549227028408963113>",
      MAGE: "<:mage:1549226645443969125>",
      WARLOCK: "<:warlock:1549227100000000000>",
    } as const;

    const embeds = buildSignupEmbeds(
      emptyData({
        uniqueSignupCount: 57,
        roleStatus: {
          tank: { signed: 13, picked: 2, target: 2 },
          healer: { signed: 20, picked: 4, target: 4 },
          dps: { signed: 39, picked: 14, target: 14 },
          lootbuddy: { signed: 5, picked: 5 },
        },
        members: { signed, picked: pickedMembers },
      }),
      { classIndicators: indicators },
    );

    expect(embeds).toHaveLength(3);
    for (const embed of embeds) {
      const json = embed.toJSON();
      const size = measureEmbedJsonSize(json);
      expect(size.fieldCount).toBeLessThanOrEqual(DISCORD_EMBED_FIELD_COUNT_LIMIT);
      expect(size.maxFieldChars).toBeLessThanOrEqual(DISCORD_EMBED_FIELD_VALUE_LIMIT);
      expect(size.totalChars).toBeLessThanOrEqual(DISCORD_EMBED_TOTAL_CHAR_LIMIT);
    }

    const blob = embeds
      .flatMap((e) => e.toJSON().fields ?? [])
      .map((f) => f.value)
      .join("\n");
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

  it("reflects a closed signup window in the summary footer", () => {
    const [summary] = buildSignupEmbeds(emptyData({ signupWindowOpen: false })).map((e) => e.toJSON());
    expect(summary.footer?.text).toMatch(/closed/i);
  });

  it("shows the loot type and boss coverage on the summary message", () => {
    const [summary] = buildSignupEmbeds(emptyData()).map((e) => e.toJSON());
    expect(summary.fields?.find((field) => field.name === "Loot")?.value).toBe("VIP");
    expect(summary.fields?.find((field) => field.name === "Bosses")?.value).toBe("7/9");
  });
});

describe("encodeSignupMessageIds", () => {
  it("round-trips comma-separated Discord snowflakes", () => {
    const encoded = encodeSignupMessageIds(["111", "222", "333"]);
    expect(encoded).toBe("111,222,333");
    expect(decodeSignupMessageIds(encoded)).toEqual(["111", "222", "333"]);
    expect(decodeSignupMessageIds("legacy-single")).toEqual(["legacy-single"]);
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
