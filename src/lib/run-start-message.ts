import type { CharacterRole, RaidDifficulty, RunLootType, WowClass } from "@/models/enums";
import { CLASS_LABELS } from "@/lib/labels";

/** Guild custom emoji names for WowClass — IDs are resolved at runtime from Discord. */
export const CLASS_DISCORD_EMOJI_NAMES: Record<WowClass, string> = {
  DEATH_KNIGHT: "dk",
  DEMON_HUNTER: "dh",
  DRUID: "druid",
  EVOKER: "evoker",
  HUNTER: "hunter",
  MAGE: "mage",
  MONK: "monk",
  PALADIN: "paladin",
  PRIEST: "priest",
  ROGUE: "rogue",
  SHAMAN: "shaman",
  WARLOCK: "warlock",
  WARRIOR: "warrior",
};

/**
 * LFG footer naming the Run's assigned Raid Lead. `raidLeadDisplayName` is the
 * human-readable effective name (see `effectiveRaidLeadChannelName`), not a slug.
 */
export function formatFinalSetupLfgLine(raidLeadDisplayName: string): string {
  return `**LFG HM ${raidLeadDisplayName} write your discord name in the note!**`;
}

export type FinalSetupRenderOptions = {
  /** Pre-resolved Discord custom emoji markup (<:name:id>) keyed by WowClass. */
  classIndicators?: Partial<Record<WowClass, string>>;
};

/** Prefer a resolved Discord class emoji; otherwise the human class label. */
export function classIndicator(
  wowClass: WowClass | null,
  classLabel: string | null,
  classIndicators?: Partial<Record<WowClass, string>>,
): string | null {
  if (wowClass) {
    const emoji = classIndicators?.[wowClass];
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
  /** Prefer productLabel; kept for older callers. */
  raidName: string;
  productLabel?: string;
  contentSummary?: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  /**
   * The Run's assigned Raid Lead as shown to players: Discord Run channel
   * nickname, else the Raid Lead's name. Never the user who started the Run.
   */
  raidLeadDisplayName: string;
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
};

function mentionDisplay(discordUserId: string | null, userName: string): string {
  return discordUserId ? `<@${discordUserId}>` : `@${userName}`;
}

function boosterLine(member: FinalSetupParticipant, options?: FinalSetupRenderOptions): string {
  const mention = mentionDisplay(member.discordUserId, member.userName);
  const indicator = classIndicator(member.wowClass, member.classLabel, options?.classIndicators);
  return indicator ? `${mention} ${indicator}` : mention;
}

function lootbuddyLine(member: FinalSetupParticipant): string {
  return mentionDisplay(member.discordUserId, member.userName);
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
 * Pure Final Setup formatter shared by the Start Run web preview and Discord plain-text post.
 * No React / discord.js / browser APIs.
 */
export function formatFinalSetup(data: FinalSetupInput, options?: FinalSetupRenderOptions): FinalSetupMessage {
  const product = data.productLabel ?? data.raidName;
  const contentLine = data.contentSummary ? `\n${data.contentSummary}` : "";
  const body = [
    `**${product}**${contentLine}`,
    roleSection("🛡", "Tanks", data.groups.tanks.length, data.targets.tanks, data.groups.tanks.map((m) => boosterLine(m, options))),
    roleSection("✚", "Healers", data.groups.healers.length, data.targets.healers, data.groups.healers.map((m) => boosterLine(m, options))),
    roleSection("⚔", "DPS", data.groups.dps.length, data.targets.dps, data.groups.dps.map((m) => boosterLine(m, options))),
    lootbuddySection(data.groups.lootbuddies.length, data.groups.lootbuddies.map(lootbuddyLine)),
  ].join("\n\n");

  return {
    title: "Final Setup",
    body,
  };
}

/**
 * Authoritative plain-text Final Setup for Discord content / web Copy message.
 * Title uses Discord markdown bold. Appends the Raid Lead's LFG line once at the bottom.
 */
export function renderFinalSetupText(data: FinalSetupInput, options?: FinalSetupRenderOptions): string {
  const message = formatFinalSetup(data, options);
  return `**${message.title}**\n\n${message.body}\n\n${formatFinalSetupLfgLine(data.raidLeadDisplayName)}`;
}
