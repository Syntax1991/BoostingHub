import { describe, expect, it } from "vitest";
import { buildRosterEmbed } from "@/discord-bot/embeds/roster-embed";
import { buildSignupEmbed, emptySignupEmbedMembers } from "@/discord-bot/embeds/signup-embed";
import type { RosterEmbedData, SignupEmbedData, SignupEmbedMember } from "@/services/discord-sync.service";

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

function signupData(overrides: Partial<SignupEmbedData> = {}): SignupEmbedData {
  return {
    runId: "r1",
    runTitle: "Split Test Run",
    raidName: "The Venomous Abyss",
    productLabel: "The Venomous Abyss",
    contentSummary: "The Venomous Abyss 8/8",
    titleCoverage: "8/8",
    raidLeadName: "Lead",
    raidLeadDiscordUserId: null,
    difficulty: "HEROIC",
    lootType: "SAVED",
    scheduledStartAt: "2026-10-01T20:00:00.000Z",
    runStatus: "OPEN",
    signupWindowOpen: true,
    uniqueSignupCount: 0,
    roleStatus: {
      tank: { signed: 0, picked: 0, target: 2 },
      healer: { signed: 0, picked: 0, target: 4 },
      dps: { signed: 0, picked: 0, target: 14 },
      lootbuddy: { signed: 0, picked: 0, target: 3 },
    },
    members: { signed: emptySignupEmbedMembers(), picked: emptySignupEmbedMembers() },
    discordRolePing: true,
    ...overrides,
  };
}

function rosterData(overrides: Partial<RosterEmbedData> = {}): RosterEmbedData {
  return {
    runId: "r1",
    runTitle: "Split Test Run",
    raidName: "The Venomous Abyss",
    productLabel: "The Venomous Abyss",
    contentSummary: "The Venomous Abyss 8/8",
    difficulty: "HEROIC",
    publishedAt: null,
    version: 1,
    targets: { tanks: 2, healers: 4, dps: 14, lootbuddies: 3 },
    groups: { tanks: [], healers: [], meleeDps: [], rangedDps: [], unspecifiedDps: [], lootbuddies: [] },
    totalSelected: 0,
    ...overrides,
  };
}

describe("Discord Signup vs Roster embeds", () => {
  it("A: signups only — volunteers appear on Signup, not on empty Roster", () => {
    const volunteer = member({
      signupId: "s1",
      userId: "u1",
      userName: "Vol",
      discordUserId: "101",
      wowClass: "WARRIOR",
    });
    const signup = buildSignupEmbed(
      signupData({
        uniqueSignupCount: 1,
        roleStatus: {
          tank: { signed: 1, picked: 0, target: 2 },
          healer: { signed: 0, picked: 0, target: 4 },
          dps: { signed: 0, picked: 0, target: 14 },
          lootbuddy: { signed: 0, picked: 0, target: 3 },
        },
        members: {
          signed: { tanks: [volunteer], healers: [], dps: [], lootbuddies: [] },
          picked: emptySignupEmbedMembers(),
        },
      }),
    ).toJSON();
    const roster = buildRosterEmbed(rosterData()).toJSON();

    expect(signup.title).toBe("Signups");
    expect(signup.fields?.some((f) => f.name === "Roster")).toBe(false);
    expect(signup.fields?.find((f) => f.name?.includes("Tanks"))?.value).toContain("<@101>");
    expect(roster.title).toBe("Roster");
    expect(roster.fields?.every((f) => f.value === "No players selected yet.")).toBe(true);
  });

  it("B: selected players remain on Signup and appear on Roster", () => {
    const selected = member({
      signupId: "s2",
      userId: "u2",
      userName: "Pick",
      discordUserId: "202",
      wowClass: "PRIEST",
    });
    const signup = buildSignupEmbed(
      signupData({
        uniqueSignupCount: 1,
        roleStatus: {
          tank: { signed: 0, picked: 0, target: 2 },
          healer: { signed: 1, picked: 1, target: 4 },
          dps: { signed: 0, picked: 0, target: 14 },
          lootbuddy: { signed: 0, picked: 0, target: 3 },
        },
        members: {
          signed: { tanks: [], healers: [selected], dps: [], lootbuddies: [] },
          picked: { tanks: [], healers: [selected], dps: [], lootbuddies: [] },
        },
      }),
    ).toJSON();
    const roster = buildRosterEmbed(
      rosterData({
        publishedAt: "2026-10-01T21:00:00.000Z",
        totalSelected: 1,
        groups: {
          tanks: [],
          healers: [
            {
              userId: "u2",
              userName: "Pick",
              discordUserId: "202",
              characterName: "Dawn",
              characterRealm: "Area 52",
              wowClass: "PRIEST",
            },
          ],
          meleeDps: [],
          rangedDps: [],
          unspecifiedDps: [],
          lootbuddies: [],
        },
      }),
    ).toJSON();

    expect(signup.fields?.find((f) => f.name?.includes("Healers"))?.value).toContain("<@202>");
    expect(roster.fields?.find((f) => f.name?.includes("Healers"))?.value).toContain("<@202>");
  });

  it("C: external booster appears on Roster only", () => {
    const signup = buildSignupEmbed(signupData({ uniqueSignupCount: 0 })).toJSON();
    const roster = buildRosterEmbed(
      rosterData({
        totalSelected: 1,
        groups: {
          tanks: [],
          healers: [],
          meleeDps: [
            {
              userId: "external:1",
              userName: "dawn",
              discordUserId: null,
              characterName: "dawn",
              characterRealm: "",
              wowClass: "MAGE",
              external: true,
            },
          ],
          rangedDps: [],
          unspecifiedDps: [],
          lootbuddies: [],
        },
      }),
    ).toJSON();

    expect(JSON.stringify(signup)).not.toContain("@dawn");
    expect(roster.fields?.find((f) => f.name?.includes("Melee DPS"))?.value).toContain("@dawn");
  });

  it("D: lootbuddy stays separate from Tank/Heal/DPS on both embeds", () => {
    const loot = member({
      signupId: "lb1",
      userId: "ulb",
      userName: "Buddy",
      discordUserId: "303",
      wowClass: "HUNTER",
    });
    const signup = buildSignupEmbed(
      signupData({
        uniqueSignupCount: 1,
        roleStatus: {
          tank: { signed: 0, picked: 0, target: 2 },
          healer: { signed: 0, picked: 0, target: 4 },
          dps: { signed: 0, picked: 0, target: 14 },
          lootbuddy: { signed: 1, picked: 1, target: 3 },
        },
        members: {
          signed: { tanks: [], healers: [], dps: [], lootbuddies: [loot] },
          picked: { tanks: [], healers: [], dps: [], lootbuddies: [loot] },
        },
      }),
    ).toJSON();
    const roster = buildRosterEmbed(
      rosterData({
        totalSelected: 1,
        groups: {
          tanks: [],
          healers: [],
          meleeDps: [],
          rangedDps: [],
          unspecifiedDps: [],
          lootbuddies: [
            {
              userId: "ulb",
              userName: "Buddy",
              discordUserId: "303",
              characterName: "Buddy",
              characterRealm: "Area 52",
              wowClass: "HUNTER",
            },
          ],
        },
      }),
    ).toJSON();

    expect(signup.fields?.some((f) => f.name?.startsWith("📦 Lootbuddies"))).toBe(true);
    expect(roster.fields?.some((f) => f.name?.includes("Lootbuddies (1/3)"))).toBe(true);
    expect(roster.fields?.find((f) => f.name?.includes("Tanks"))?.value).not.toContain("<@303>");
  });

  it("E: Signup and Roster are independently titled messages", () => {
    expect(buildSignupEmbed(signupData()).toJSON().title).toBe("Signups");
    expect(buildRosterEmbed(rosterData()).toJSON().title).toBe("Roster");
  });
});
