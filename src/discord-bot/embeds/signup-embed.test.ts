import { describe, expect, it } from "vitest";
import type { SignupEmbedData, SignupEmbedMember, SignupEmbedNote } from "@/services/discord-sync.service";
import {
  buildSignupButtons,
  buildSignupEmbed,
  buildSignupSummary,
  emptySignupEmbedMembers,
  formatSignupNoteLine,
  formatSignupParticipantGroupLine,
  formatSignupParticipantLine,
  groupSignupMembersByUser,
  measureEmbedJsonSize,
  DISCORD_EMBED_TOTAL_CHAR_LIMIT,
} from "@/discord-bot/embeds/signup-embed";
import { parseCustomId } from "@/discord-bot/custom-ids";
import {
  DISCORD_EMBED_FIELD_COUNT_LIMIT,
  DISCORD_EMBED_FIELD_VALUE_LIMIT,
  chunkEmbedFieldLines,
} from "@/lib/discord-embed-field-chunking";
import type { WowClass } from "@/models/enums";

const RUN_URL = "https://hub.example/runs/r7777777-7777-4777-8777-777777777777";

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
    runTitle: "Tue 21:30 HC VIP 10/10 Uwe",
    raidName: "Season 2 Complete Bundle",
    productLabel: "The Venomous Abyss · The Tidebound Grotto · The Unbinding of Kith'ix",
    contentSummary: "VA 8/8 · Tide 1/1 · Kith'ix 1/1",
    titleCoverage: "10/10",
    raidLeadName: "Uwe",
    raidLeadDiscordUserId: "999000111222333444",
    difficulty: "HEROIC",
    lootType: "VIP",
    scheduledStartAt: "2026-10-27T20:30:00.000Z",
    runStatus: "OPEN",
    signupWindowOpen: true,
    uniqueSignupCount: 0,
    roleStatus: {
      tank: { signed: 0, picked: 0, target: 2 },
      healer: { signed: 0, picked: 0, target: 4 },
      dps: { signed: 0, picked: 0, target: 14 },
      lootbuddy: { signed: 0, picked: 0 },
    },
    members: { signed: emptySignupEmbedMembers(), picked: emptySignupEmbedMembers() },
    discordRolePing: true,
    contentTitle: "Venom & Tide & Kithix",
    notes: [],
    ...overrides,
  };
}

const INDICATORS: Partial<Record<WowClass, string>> = {
  PALADIN: "<:paladin:1549226889409863761>",
  SHAMAN: "<:shaman:1549227028408963113>",
  PRIEST: "<:priest:1549227000000000000>",
  MAGE: "<:mage:1549226645443969125>",
  HUNTER: "<:hunter:1549226757536751636>",
  WARLOCK: "<:warlock:1549227100000000000>",
  DEMON_HUNTER: "<:demonhunter:1549227100000000001>",
};

/** 18-digit Discord-like snowflake, unique per seed. */
function snowflake(seed: number): string {
  return `1${String(seed).padStart(17, "0")}`;
}

function makeMembers(count: number, prefix: string, wowClass: WowClass): SignupEmbedMember[] {
  return Array.from({ length: count }, (_, index) =>
    member({
      signupId: `${prefix}-s${index}`,
      userId: `${prefix}-u${index}`,
      userName: `${prefix}${index}`,
      discordUserId: snowflake(prefix.charCodeAt(0) * 1000 + index),
      wowClass,
    }),
  );
}

function note(userId: string, discordUserId: string, text: string): SignupEmbedNote {
  return { userId, userName: userId, discordUsername: null, discordUserId, note: text };
}

/** A roster of `selected` boosters spread 2 tanks / 4 healers / rest DPS, plus `lootbuddies`. */
function rosterData(selected: number, lootbuddies: number, notes: SignupEmbedNote[] = []): SignupEmbedData {
  const tanks = makeMembers(Math.min(2, selected), "T", "PALADIN");
  const healers = makeMembers(Math.min(4, Math.max(0, selected - 2)), "H", "SHAMAN");
  const dps = makeMembers(Math.max(0, selected - 6), "D", "DEMON_HUNTER");
  const loot = makeMembers(lootbuddies, "L", "WARLOCK");
  return emptyData({
    uniqueSignupCount: selected + lootbuddies,
    roleStatus: {
      tank: { signed: tanks.length, picked: tanks.length, target: 2 },
      healer: { signed: healers.length, picked: healers.length, target: 4 },
      dps: { signed: dps.length, picked: Math.min(dps.length, 14), target: 14 },
      lootbuddy: { signed: loot.length, picked: 0 },
    },
    members: {
      signed: { tanks, healers, dps, lootbuddies: loot },
      picked: emptySignupEmbedMembers(),
    },
    notes,
  });
}

function expectWithinDiscordLimits(data: SignupEmbedData) {
  const embed = buildSignupEmbed(data, { classIndicators: INDICATORS, runUrl: RUN_URL }).toJSON();
  const size = measureEmbedJsonSize(embed);
  expect(size.fieldCount).toBeLessThanOrEqual(DISCORD_EMBED_FIELD_COUNT_LIMIT);
  expect(size.maxFieldChars).toBeLessThanOrEqual(DISCORD_EMBED_FIELD_VALUE_LIMIT);
  expect(size.totalChars).toBeLessThanOrEqual(DISCORD_EMBED_TOTAL_CHAR_LIMIT);
  const blob = (embed.fields ?? []).map((field) => field.value).join("\n");
  const everyone = [
    ...data.members.signed.tanks,
    ...data.members.signed.healers,
    ...data.members.signed.dps,
    ...data.members.signed.lootbuddies,
  ];
  // Never silently truncate roster names.
  for (const row of everyone) expect(blob).toContain(`<@${row.discordUserId}>`);
  return { embed, blob, size };
}

describe("participant lines", () => {
  it("class indicator first, then the mention — no Character-Realm, no role text", () => {
    const line = formatSignupParticipantLine(
      member({
        signupId: "s1",
        userId: "u1",
        userName: "Display Name",
        discordUserId: "123456789012345678",
        characterName: "Synblast",
        characterRealm: "Antonidas",
        wowClass: "SHAMAN",
      }),
      { SHAMAN: "<:shaman:987654321012345678>" },
    );
    expect(line).toBe("<:shaman:987654321012345678> <@123456789012345678>");
    expect(line).not.toContain("Synblast");
  });

  it("falls back to @discordUsername, then @userName, and to the class label without a Guild emoji", () => {
    expect(
      formatSignupParticipantLine(
        member({ signupId: "s", userId: "u", userName: "Name", discordUsername: "syntaxgg_1991", wowClass: "SHAMAN" }),
        { SHAMAN: "<:shaman:1>" },
      ),
    ).toBe("<:shaman:1> @syntaxgg_1991");
    expect(
      formatSignupParticipantLine(member({ signupId: "s", userId: "u", userName: "UserName", wowClass: "MAGE" }), {}),
    ).toBe("Mage @UserName");
  });

  it("groups multi-character offers of one User under one mention with every class icon", () => {
    const offers = [
      member({ signupId: "a", userId: "u", userName: "U", discordUserId: "1", wowClass: "PALADIN" }),
      member({ signupId: "b", userId: "u", userName: "U", discordUserId: "1", wowClass: "MAGE" }),
      member({ signupId: "c", userId: "u", userName: "U", discordUserId: "1", wowClass: "PALADIN" }),
    ];
    expect(groupSignupMembersByUser(offers)).toHaveLength(1);
    expect(formatSignupParticipantGroupLine(offers, INDICATORS)).toBe(`${INDICATORS.PALADIN} ${INDICATORS.MAGE} <@1>`);
    expect(formatSignupParticipantGroupLine(offers, null)).toBe("<@1>");
  });

  it("chunkEmbedFieldLines never splits a line, never drops lines, and keeps order", () => {
    const lines = Array.from({ length: 80 }, (_, index) => `<@${100000000000000000 + index}> <:mage:1549226645443969125>`);
    const chunks = chunkEmbedFieldLines(lines);
    expect(chunks.flat()).toEqual(lines);
    for (const chunk of chunks) expect(chunk.join("\n").length).toBeLessThanOrEqual(DISCORD_EMBED_FIELD_VALUE_LIMIT);
  });
});

describe("buildSignupEmbed — hierarchy", () => {
  it("title is the compact content title linking to the Run — never the long raid names", () => {
    const json = buildSignupEmbed(emptyData(), { runUrl: RUN_URL }).toJSON();
    expect(json.title).toBe("Venom & Tide & Kithix");
    expect(json.url).toBe(RUN_URL);
    expect(JSON.stringify(json)).not.toContain("The Venomous Abyss · The Tidebound Grotto");
  });

  it("falls back to the product label when no content title is known (older payload)", () => {
    expect(buildSignupEmbed(emptyData({ contentTitle: undefined, productLabel: "Venom" })).toJSON().title).toBe("Venom");
  });

  it("summary: Raid Lead, run type, signup count (not selection), date, time, relative start — no admin block", () => {
    const data = emptyData({
      uniqueSignupCount: 13,
      roleStatus: {
        tank: { signed: 3, picked: 2, target: 2 },
        healer: { signed: 5, picked: 4, target: 4 },
        dps: { signed: 12, picked: 10, target: 14 },
        lootbuddy: { signed: 0, picked: 0 },
      },
    });
    const summary = buildSignupSummary(data);
    const seconds = Math.floor(Date.parse(data.scheduledStartAt) / 1000);
    expect(summary).toContain("<@999000111222333444>");
    expect(summary).toContain("💎 HC VIP");
    // Distinct signed-up Users (the old "Signed users"), never picked/target.
    expect(summary).toContain("👥 13 signed");
    expect(summary).not.toMatch(/selected/i);
    expect(summary).not.toContain("16/20");
    expect(summary).toContain(`<t:${seconds}:D>`);
    expect(summary).toContain(`<t:${seconds}:t>`);
    expect(summary).toContain(`<t:${seconds}:R>`);
    const fields = buildSignupEmbed(data).toJSON().fields ?? [];
    for (const name of ["Scheduled", "Signed users", "Status", "Loot", "Signups by role"]) {
      expect(fields.some((field) => field.name === name || field.name.endsWith(` ${name}`))).toBe(false);
    }
    expect(JSON.stringify(buildSignupEmbed(data).toJSON())).not.toContain("Roster published");
  });

  it("closed and ended Runs say so in the summary", () => {
    expect(buildSignupSummary(emptyData({ signupWindowOpen: false }))).toContain("Signups are closed.");
    expect(buildSignupSummary(emptyData({ runStatus: "COMPLETED", signupWindowOpen: false }))).toContain("Run ended");
  });

  it("roster-first fields: Tanks | Healers | DPS inline with signup counts only, Lootbuddies, Open Run", () => {
    const json = buildSignupEmbed(rosterData(10, 2), { classIndicators: INDICATORS, runUrl: RUN_URL }).toJSON();
    const fields = json.fields ?? [];
    expect(fields.map((field) => field.name)).toEqual([
      "🛡 Tanks 2",
      "✚ Healers 4",
      "⚔ DPS 4",
      "💰 Lootbuddies 2",
      "​",
    ]);
    expect(fields.slice(0, 3).every((field) => field.inline)).toBe(true);
    expect(fields[3]!.inline).toBe(false);
    expect(fields[0]!.value.split("\n")[0]).toBe(`${INDICATORS.PALADIN} <@${rosterData(10, 2).members.signed.tanks[0]!.discordUserId}>`);
    expect(fields[4]!.value).toBe(`🔗 [Open Run](${RUN_URL})`);
  });

  it("empty roles keep their column so the grid stays stable; no Notes heading without notes", () => {
    const fields = buildSignupEmbed(emptyData(), { runUrl: null }).toJSON().fields ?? [];
    expect(fields.map((field) => field.value)).toEqual(["—\n\u200b", "—\n\u200b", "—\n\u200b", "—"]);
    expect(fields.some((field) => field.name.includes("Notes"))).toBe(false);
  });

  it("uses Guild role emojis when provided", () => {
    const json = buildSignupEmbed(emptyData(), {
      roleIndicators: { tank: "<:tank:1>", healer: "<:healer:2>", dps: "<:dps:3>", lootbuddy: "<:lb:5>", raidlead: "<:rl:4>" },
    }).toJSON();
    const names = (json.fields ?? []).map((field) => field.name);
    // Real WoW role artwork (Guild emojis), once per heading — never `<emoji> Tanks <emoji>`.
    expect(names.slice(0, 4)).toEqual(["<:tank:1> Tanks 0", "<:healer:2> Healers 0", "<:dps:3> DPS 0", "<:lb:5> Lootbuddies 0"]);
    expect(json.description).toContain("<:rl:4> <@999000111222333444>");
  });

  it("VIP Run type uses the Guild `:Unsaved:` emoji when present, 💎 otherwise; other Run types keep unicode", () => {
    const roleIndicators = { vip: "<:Unsaved:7>" };
    expect(buildSignupSummary(emptyData(), roleIndicators)).toContain("<:Unsaved:7> HC VIP");
    expect(buildSignupSummary(emptyData())).toContain("💎 HC VIP");
    expect(buildSignupSummary(emptyData({ lootType: "UNSAVED" }), roleIndicators)).toContain("💰 HC Unsaved");
  });

  it("signup demand may exceed the composition target: 5 Healer signups for 3 slots reads `Healers 5`, never `5/3`", () => {
    const data = emptyData({
      uniqueSignupCount: 13,
      roleStatus: {
        tank: { signed: 1, picked: 0, target: 2 },
        healer: { signed: 5, picked: 0, target: 3 },
        dps: { signed: 7, picked: 0, target: 11 },
        lootbuddy: { signed: 1, picked: 0, target: 2 },
      },
    });
    const json = buildSignupEmbed(data, { runUrl: null }).toJSON();
    expect((json.fields ?? []).map((field) => field.name)).toEqual(["🛡 Tanks 1", "✚ Healers 5", "⚔ DPS 7", "💰 Lootbuddies 1"]);
    const text = JSON.stringify({ description: json.description, fields: json.fields });
    for (const ratio of ["5/3", "1/2", "7/11", "0/16"]) expect(text).not.toContain(ratio);
    expect(text).not.toMatch(/selected/i); // only the footer explains that signup is not selection
    expect(json.footer?.text).toBe("Signup does not mean selected.");
  });
});

describe("buildSignupEmbed — notes", () => {
  it("renders mention + note under Lootbuddies and before Open Run, only when present", () => {
    const data = rosterData(6, 1, [note("u1", "111111111111111111", "can also play Ele"), note("u2", "222222222222222222", "~10 min late")]);
    const fields = buildSignupEmbed(data, { runUrl: RUN_URL }).toJSON().fields ?? [];
    const names = fields.map((field) => field.name);
    expect(names.indexOf("📝 Notes")).toBe(names.findIndex((name) => name.includes("Lootbuddies")) + 1);
    expect(names[names.length - 1]).toBe("​");
    expect(fields.find((field) => field.name === "📝 Notes")?.value).toBe(
      "<@111111111111111111> — can also play Ele\n<@222222222222222222> — ~10 min late",
    );
  });

  it("a long note is shortened to one line on the post", () => {
    const line = formatSignupNoteLine(note("u", "1", `${"x".repeat(150)}\nsecond line`));
    expect(line.length).toBeLessThanOrEqual(110);
    expect(line).not.toContain("\n");
    expect(line.endsWith("…")).toBe(true);
  });

  it("many notes split into continuation fields instead of breaking the embed", () => {
    const notes = Array.from({ length: 25 }, (_, index) =>
      note(`n${index}`, snowflake(300000 + index), `note ${index} ${"y".repeat(80)}`),
    );
    const { embed } = expectWithinDiscordLimits(rosterData(20, 3, notes));
    const noteText = (embed.fields ?? []).filter((field) => field.name.startsWith("📝 Notes")).map((field) => field.value).join("\n");
    for (const entry of notes) expect(noteText).toContain(`<@${entry.discordUserId}>`);
  });
});

describe("buildSignupEmbed — Discord limits", () => {
  for (const selected of [10, 20, 25]) {
    it(`${selected} boosters + Lootbuddies + notes stay inside one embed with every name`, () => {
      const notes = [note("a", "400000000000000001", "can also play Ele"), note("b", "400000000000000002", "~10 min late")];
      expectWithinDiscordLimits(rosterData(selected, 4, notes));
    });
  }

  it("deterministic fallback: drops class icons (mentions stay) before anything else", () => {
    const longIcons = Object.fromEntries(
      Object.keys(INDICATORS).map((wowClass) => [wowClass, `<:${"z".repeat(30)}:1549226645443969125>`]),
    ) as Partial<Record<WowClass, string>>;
    const data = rosterData(25, 10, Array.from({ length: 20 }, (_, index) => note(`f${index}`, snowflake(500000 + index), "w".repeat(90))));
    const json = buildSignupEmbed(data, { classIndicators: longIcons, runUrl: RUN_URL }).toJSON();
    const size = measureEmbedJsonSize(json);
    expect(size.totalChars).toBeLessThanOrEqual(DISCORD_EMBED_TOTAL_CHAR_LIMIT);
    const blob = (json.fields ?? []).map((field) => field.value).join("\n");
    for (const row of [...data.members.signed.dps, ...data.members.signed.lootbuddies]) {
      expect(blob).toContain(`<@${row.discordUserId}>`);
    }
  });
});

describe("buildSignupButtons", () => {
  function rows(data: SignupEmbedData) {
    return buildSignupButtons(data).map((row) =>
      (row.toJSON().components as Array<{ custom_id: string; label: string; disabled?: boolean }>).map((component) => ({
        action: parseCustomId(component.custom_id)?.action,
        runId: parseCustomId(component.custom_id)?.runId,
        label: component.label,
        disabled: component.disabled ?? false,
      })),
    );
  }

  it("primary row Signup · Quick Sign · LB, secondary row Unsign · Add / Edit Note", () => {
    const layout = rows(emptyData());
    expect(layout.map((row) => row.map((button) => button.label))).toEqual([
      ["Signup", "Quick Sign", "LB"],
      ["Unsign", "Add / Edit Note"],
    ]);
    expect(layout.flat().map((button) => button.action)).toEqual(["signup", "quick-signup", "lootbuddy", "cancel", "note"]);
    expect(layout.flat().every((button) => button.runId === "r7777777-7777-4777-8777-777777777777")).toBe(true);
  });

  it("a closed window disables the signup row; Unsign and the note stay usable", () => {
    const layout = rows(emptyData({ signupWindowOpen: false })).flat();
    const byAction = new Map(layout.map((button) => [button.action, button.disabled]));
    expect(byAction.get("signup")).toBe(true);
    expect(byAction.get("quick-signup")).toBe(true);
    expect(byAction.get("lootbuddy")).toBe(true);
    expect(byAction.get("cancel")).toBe(false);
    expect(byAction.get("note")).toBe(false);
  });

  it("COMPLETED / CANCELLED: only Archive Run; IN_PROGRESS / PUBLISHED keep the signup rows", () => {
    for (const runStatus of ["COMPLETED", "CANCELLED"] as const) {
      expect(rows(emptyData({ runStatus, signupWindowOpen: false })).flat().map((button) => button.action)).toEqual(["archive"]);
    }
    for (const runStatus of ["IN_PROGRESS", "PUBLISHED"] as const) {
      expect(rows(emptyData({ runStatus })).flat().map((button) => button.action)).not.toContain("archive");
    }
  });
});

describe("buildSignupEmbed — section spacing", () => {
  const GAP = "\n\u200b";
  const zeroWidthLines = (text: string) => text.split("\n").filter((line) => line === "\u200b").length;

  it("a blank line under the title and one closing the metadata", () => {
    const description = buildSignupEmbed(emptyData({ uniqueSignupCount: 2 })).toJSON().description ?? "";
    expect(description.startsWith("\u200b\n")).toBe(true);
    expect(description.endsWith(GAP)).toBe(true);
    expect(zeroWidthLines(description)).toBe(2);
  });

  it("one gap under the Tanks | Healers | DPS row, none between players", () => {
    const fields = buildSignupEmbed(rosterData(18, 0), { classIndicators: INDICATORS, runUrl: null }).toJSON().fields ?? [];
    for (const field of fields.slice(0, 3)) {
      expect(field.value.endsWith(GAP)).toBe(true);
      expect(zeroWidthLines(field.value)).toBe(1); // only the closing gap
    }
    expect(fields[3]!.name).toMatch(/Lootbuddies/);
  });

  it("Lootbuddies → Notes gets a gap only when Notes follow; Open Run keeps its blank-name gap", () => {
    const withNotes = buildSignupEmbed(rosterData(6, 2, [note("u", "333333333333333333", "~10 min late")]), { runUrl: RUN_URL }).toJSON().fields ?? [];
    const lootbuddies = withNotes.find((field) => field.name.includes("Lootbuddies"))!;
    expect(lootbuddies.value.endsWith(GAP)).toBe(true);
    const notes = withNotes.find((field) => field.name === "📝 Notes")!;
    expect(notes.value.endsWith(GAP)).toBe(false);
    expect(withNotes[withNotes.length - 1]).toMatchObject({ name: "\u200b", value: `🔗 [Open Run](${RUN_URL})` });

    const withoutNotes = buildSignupEmbed(rosterData(6, 2), { runUrl: RUN_URL }).toJSON().fields ?? [];
    expect(withoutNotes.find((field) => field.name.includes("Lootbuddies"))!.value.endsWith(GAP)).toBe(false);
    expect(withoutNotes.some((field) => field.name.includes("Notes"))).toBe(false);
  });

  it("spacing never pushes a 25-signup roster with notes past Discord limits", () => {
    const notes = Array.from({ length: 6 }, (_, index) => note(`s${index}`, snowflake(700000 + index), "can also play Ele"));
    expectWithinDiscordLimits(rosterData(25, 6, notes));
  });
});

