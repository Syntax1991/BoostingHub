import type { WowClass } from "@/models/enums";

/** Wowhead/Zamimg slug for the classic WoW class icon asset. */
const CLASS_ICON_SLUGS: Record<WowClass, string> = {
  DEATH_KNIGHT: "classicon_deathknight",
  DEMON_HUNTER: "classicon_demonhunter",
  DRUID: "classicon_druid",
  EVOKER: "classicon_evoker",
  HUNTER: "classicon_hunter",
  MAGE: "classicon_mage",
  MONK: "classicon_monk",
  PALADIN: "classicon_paladin",
  PRIEST: "classicon_priest",
  ROGUE: "classicon_rogue",
  SHAMAN: "classicon_shaman",
  WARLOCK: "classicon_warlock",
  WARRIOR: "classicon_warrior",
};

export type WowClassIconSize = "medium" | "large";

/** Public CDN URL for a WoW class icon (Wowhead/Zamimg). */
export function wowClassIconUrl(wowClass: WowClass, size: WowClassIconSize = "medium"): string {
  return `https://wow.zamimg.com/images/wow/icons/${size}/${CLASS_ICON_SLUGS[wowClass]}.jpg`;
}
