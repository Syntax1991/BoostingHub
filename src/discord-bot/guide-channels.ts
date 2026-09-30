/**
 * Discord channels holding the posted guides — plain channels (no threads,
 * no "Back to menu"). The single source for `/guide` and the
 * scripts/post-*-guide.mts posting scripts.
 */
export const GUIDE_CHANNEL_IDS = {
  booster: "1552712971543650425",
  raidlead: "1553768153572708514",
} as const;

export type GuideKind = keyof typeof GUIDE_CHANNEL_IDS;

/** Manawyrm Hub guild — used for stable guide deep-links in announcements. */
export const MANAWYRM_HUB_GUILD_ID = "1526980319826280509";

export function guideChannelUrl(guildId: string, kind: GuideKind): string {
  return `https://discord.com/channels/${guildId}/${GUIDE_CHANNEL_IDS[kind]}`;
}

/** Canonical Booster Guide deep-link for product announcements. */
export const BOOSTER_GUIDE_ANNOUNCEMENT_URL = guideChannelUrl(MANAWYRM_HUB_GUILD_ID, "booster");
