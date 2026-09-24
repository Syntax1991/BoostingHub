import {
  renderFinalSetupText,
  type FinalSetupInput,
  type FinalSetupRenderOptions,
} from "@/lib/run-start-message";
import type { RunStartEmbedData } from "@/services/discord-sync.service";

export function toFinalSetupInput(data: RunStartEmbedData): FinalSetupInput {
  return {
    raidName: data.raidName,
    productLabel: data.productLabel,
    contentSummary: data.contentSummary,
    difficulty: data.difficulty,
    lootType: data.lootType,
    raidLeadDisplayName: data.raidLeadDisplayName,
    targets: data.targets,
    groups: data.groups,
  };
}

export type FinalSetupAllowedMentions = {
  parse: [];
  users: string[];
  roles: [];
  repliedUser: false;
};

/**
 * Explicit mention policy for the Final Setup post (send AND edit): only the
 * selected roster participants' Discord users may be pinged. No @everyone /
 * @here / role parsing, so fallback "@name" text and any dynamic text stay
 * inert. Users are unique, non-null, in roster render order.
 */
export function finalSetupAllowedMentions(data: Pick<RunStartEmbedData, "groups">): FinalSetupAllowedMentions {
  const users: string[] = [];
  for (const member of [...data.groups.tanks, ...data.groups.healers, ...data.groups.dps, ...data.groups.lootbuddies]) {
    if (member.discordUserId && !users.includes(member.discordUserId)) {
      users.push(member.discordUserId);
    }
  }
  return { parse: [], users, roles: [], repliedUser: false };
}

/**
 * Plain-text Final Setup for Discord channel.send / message.edit content.
 * Optional classIndicators supply live Guild custom emoji markup.
 */
export function renderRunStartMessageText(
  data: RunStartEmbedData,
  options?: FinalSetupRenderOptions,
): string {
  return renderFinalSetupText(toFinalSetupInput(data), options);
}
