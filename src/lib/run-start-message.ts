import type { CharacterRole, RaidDifficulty, RunLootType, WowClass } from "@/models/enums";
import { CLASS_LABELS, DIFFICULTY_LABELS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";

/**
 * Optional Discord custom emoji strings for Final Setup class indicators.
 * Leave empty until real guild emoji IDs are configured — never invent IDs.
 * Example value shape: "<:deathknight:1234567890>"
 */
export const CLASS_DISCORD_EMOJIS: Partial<Record<WowClass, string>> = {
  // Intentionally empty. Populate with real custom emoji markup when available.
};

/** Prefer a configured Discord class emoji; otherwise the human class label. */
export function classIndicator(wowClass: WowClass | null, classLabel: string | null): string | null {
  if (wowClass) {
    const emoji = CLASS_DISCORD_EMOJIS[wowClass];
    if (emoji) return emoji;
    return CLASS_LABELS[wowClass];
  }
  return classLabel;
}

export type FinalSetupParticipant = {
  discordUserId: string | null;
  userName: string;
  characterName: string;
  characterRealm: string;
  wowClass: WowClass | null;
  classLabel: string | null;
  participationType: "BOOSTER" | "LOOTBUDDY";
  /** The Raid Lead's assignment for this roster slot; null for LOOTBUDDY. */
  selectedRole: CharacterRole | null;
};

export type FinalSetupInput = {
  raidName: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  targets: {
    tanks: number;
    healers: number;
    dps: number;
  };
  groups: {
    tanks: FinalSetupParticipant[];
    healers: FinalSetupParticipant[];
    dps: FinalSetupParticipant[];
    lootbuddies: FinalSetupParticipant[];
  };
};

export type FinalSetupMessage = {
  title: "Final Setup";
  body: string;
  footer: string;
};

function mentionDisplay(discordUserId: string | null, userName: string): string {
  return discordUserId ? `<@${discordUserId}>` : `@${userName}`;
}

function characterLabel(name: string, realm: string): string {
  return realm ? `${name}-${realm}` : name;
}

function boosterLine(member: FinalSetupParticipant): string {
  const mention = mentionDisplay(member.discordUserId, member.userName);
  const character = characterLabel(member.characterName, member.characterRealm);
  const indicator = classIndicator(member.wowClass, member.classLabel);
  return indicator ? `${mention} — ${character} — ${indicator}` : `${mention} — ${character}`;
}

function lootbuddyLine(member: FinalSetupParticipant): string {
  const mention = mentionDisplay(member.discordUserId, member.userName);
  const indicator = classIndicator(member.wowClass, member.classLabel);
  return indicator ? `${mention} — ${indicator}` : mention;
}

function roleSection(emoji: string, label: string, selected: number, target: number, lines: string[]): string {
  const body = lines.length > 0 ? lines.join("\n") : "—";
  return `${emoji} **${label}** ${emoji} ${selected}/${target}\n${body}`;
}

function lootbuddySection(selected: number, lines: string[]): string {
  const body = lines.length > 0 ? lines.join("\n") : "—";
  return `📦 **Lootbuddies** 📦 ${selected}\n${body}`;
}

/** Deterministic participant sort for Final Setup rows. */
export function compareFinalSetupParticipants(a: FinalSetupParticipant, b: FinalSetupParticipant): number {
  const byName = a.characterName.localeCompare(b.characterName, "en");
  if (byName !== 0) return byName;
  return a.userName.localeCompare(b.userName, "en");
}

export function groupFinalSetupParticipants(members: FinalSetupParticipant[]): FinalSetupInput["groups"] {
  return {
    tanks: members.filter((m) => m.participationType === "BOOSTER" && m.selectedRole === "TANK").sort(compareFinalSetupParticipants),
    healers: members.filter((m) => m.participationType === "BOOSTER" && m.selectedRole === "HEALER").sort(compareFinalSetupParticipants),
    dps: members.filter((m) => m.participationType === "BOOSTER" && m.selectedRole === "DPS").sort(compareFinalSetupParticipants),
    lootbuddies: members.filter((m) => m.participationType === "LOOTBUDDY").sort(compareFinalSetupParticipants),
  };
}

/**
 * Pure Final Setup formatter shared by the Start Run web preview and Discord embed.
 * No React / discord.js / browser APIs.
 */
export function formatFinalSetup(data: FinalSetupInput): FinalSetupMessage {
  const body = [
    roleSection("🛡", "Tanks", data.groups.tanks.length, data.targets.tanks, data.groups.tanks.map(boosterLine)),
    roleSection("✚", "Healers", data.groups.healers.length, data.targets.healers, data.groups.healers.map(boosterLine)),
    roleSection("⚔", "DPS", data.groups.dps.length, data.targets.dps, data.groups.dps.map(boosterLine)),
    lootbuddySection(data.groups.lootbuddies.length, data.groups.lootbuddies.map(lootbuddyLine)),
  ].join("\n\n");

  return {
    title: "Final Setup",
    body,
    footer: `${data.raidName} · ${DIFFICULTY_LABELS[data.difficulty]} · ${RUN_LOOT_TYPE_LABELS[data.lootType]}`,
  };
}

/** Plain-text projection for copy/paste and unit tests. */
export function renderFinalSetupText(data: FinalSetupInput): string {
  const message = formatFinalSetup(data);
  return `${message.title}\n\n${message.body}`;
}
