import { EmbedBuilder } from "discord.js";
import { DIFFICULTY_ABBREVIATIONS, DIFFICULTY_LABELS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import type { RaidDifficulty, RunLootType } from "@/models/enums";

/** Guild custom emoji name flanking the Raidboost Announce title. */
export const RAIDBOOST_ANNOUNCE_EMOJI_NAME = "PhoenixStarDiscord";

/** Guild role names pinged when a new Run channel is provisioned. */
export const RAIDBOOST_PING_ROLE_NAMES = ["tank", "healer", "dps"] as const;

const LOOT_EMOJIS: Record<RunLootType, string> = {
  SAVED: "💰❌",
  UNSAVED: "💰",
  VIP: "💎",
};

export type RaidboostAnnounceInput = {
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  /** Resolved `<:PhoenixStarDiscord:id>` markup, or null when missing. */
  phoenixEmoji: string | null;
  /** Role mention strings `<@&id>` for tank/healer/dps (only resolved roles). */
  roleMentions: string[];
};

/**
 * Carl-bot-style open announce posted once when a Run's dedicated channel is
 * first created. Content carries role mentions (embeds alone do not ping).
 */
export function buildRaidboostAnnounce(input: RaidboostAnnounceInput): {
  content: string;
  embeds: EmbedBuilder[];
  allowedMentions: { roles: string[] };
} {
  const abbrev = DIFFICULTY_ABBREVIATIONS[input.difficulty];
  const difficultyLabel = DIFFICULTY_LABELS[input.difficulty];
  const lootLabel = RUN_LOOT_TYPE_LABELS[input.lootType];
  const lootEmoji = LOOT_EMOJIS[input.lootType];
  const phoenix = input.phoenixEmoji?.trim() || "";
  const title = phoenix
    ? `${phoenix} Raidboost Announce ${phoenix}`
    : "Raidboost Announce";

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      `**${abbrev}** ${lootEmoji} ${difficultyLabel} ${lootLabel} - *Please refer to the channel name for the time* 🕒`,
    );

  const roleIds = input.roleMentions
    .map((mention) => {
      const match = mention.match(/^<@&(\d+)>$/);
      return match?.[1] ?? null;
    })
    .filter((id): id is string => Boolean(id));

  return {
    content: input.roleMentions.join(" "),
    embeds: [embed],
    allowedMentions: { roles: roleIds },
  };
}
