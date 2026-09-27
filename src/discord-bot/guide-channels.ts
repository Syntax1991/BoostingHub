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

export function guideChannelUrl(guildId: string, kind: GuideKind): string {
  return `https://discord.com/channels/${guildId}/${GUIDE_CHANNEL_IDS[kind]}`;
}
