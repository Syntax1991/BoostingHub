import { DIFFICULTY_ABBREVIATIONS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import type { RaidDifficulty, RunLootType } from "@/models/enums";

/** Guild custom emoji name flanking the Raidboost Announce line. */
export const RAIDBOOST_ANNOUNCE_EMOJI_NAME = "PhoenixStarDiscord";

/** Guild role names pinged when a new Run channel is provisioned. */
export const RAIDBOOST_PING_ROLE_NAMES = ["tank", "healer", "dps"] as const;

export const LOOT_EMOJIS: Record<RunLootType, string> = {
  SAVED: "💰❌",
  UNSAVED: "💰",
  VIP: "💎",
  COMMUNITY: "👥",
};

export type RaidboostAnnounceInput = {
  /** BoostingHub Run this announce was posted for. */
  runId: string;
  difficulty: RaidDifficulty;
  lootType: RunLootType;
  /** Compact content title ("Venom & Tide & Kithix"); falls back to no title. */
  contentTitle?: string;
  /** Resolved `<:PhoenixStarDiscord:id>` markup, or null when missing. */
  phoenixEmoji: string | null;
  /** Role mention strings `<@&id>` for tank/healer/dps (only resolved roles). */
  roleMentions: string[];
};

/**
 * Short open announce posted once when a Run's dedicated channel is first
 * created: role pings (when the Run opted in) + one line naming the Run. No
 * second embed — the Signup message right below carries title, time and roster.
 */
export function buildRaidboostAnnounce(input: RaidboostAnnounceInput): {
  content: string;
  allowedMentions: { roles: string[] };
} {
  const phoenix = input.phoenixEmoji?.trim() || "";
  const run = [
    `**${DIFFICULTY_ABBREVIATIONS[input.difficulty]}** ${LOOT_EMOJIS[input.lootType]} ${RUN_LOOT_TYPE_LABELS[input.lootType]}`,
    input.contentTitle?.trim() || null,
  ]
    .filter(Boolean)
    .join(" · ");
  const line = [phoenix, `Raidboost: ${run} — signups open below`, phoenix].filter(Boolean).join(" ");

  const roleIds = input.roleMentions
    .map((mention) => /^<@&(\d+)>$/.exec(mention)?.[1] ?? null)
    .filter((id): id is string => Boolean(id));

  return {
    content: [input.roleMentions.join(" "), line].filter(Boolean).join("\n"),
    allowedMentions: { roles: roleIds },
  };
}
