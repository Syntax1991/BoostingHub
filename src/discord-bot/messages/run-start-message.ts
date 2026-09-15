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
    targets: data.targets,
    groups: data.groups,
  };
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
