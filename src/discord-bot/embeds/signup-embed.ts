import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import type { SignupEmbedData } from "@/services/discord-sync.service";
import { buildCustomId } from "@/discord-bot/custom-ids";
import { discordTimestamp, pluralize } from "@/discord-bot/format";
import { DIFFICULTY_LABELS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";

const RUN_STATUS_LABEL: Record<SignupEmbedData["runStatus"], string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  ROSTERING: "Rostering",
  PUBLISHED: "Roster published",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/**
 * The public signup embed. Content only — this never renders a User's
 * offered Characters (that stays in the ephemeral, per-User reply).
 */
export function buildSignupEmbed(data: SignupEmbedData): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(data.runTitle)
    .setDescription(`${DIFFICULTY_LABELS[data.difficulty]} · ${data.raidName}`)
    .addFields(
      { name: "Scheduled", value: discordTimestamp(data.scheduledStartAt), inline: true },
      { name: "Signups", value: pluralize(data.uniqueSignupCount, "signup"), inline: true },
      { name: "Status", value: RUN_STATUS_LABEL[data.runStatus], inline: true },
      { name: "Loot", value: RUN_LOOT_TYPE_LABELS[data.lootType], inline: true },
      { name: "Bosses", value: `${data.plannedBossCount}/${data.totalBossCount}`, inline: true },
    )
    .setColor(data.signupWindowOpen ? 0xd4af37 : 0x555555)
    .setFooter({ text: data.signupWindowOpen ? "Signups are open." : "Signups are closed." });
}

/** Buttons disable once the signup window is no longer open — the server remains the real gate either way. */
export function buildSignupButtons(data: SignupEmbedData): ActionRowBuilder<ButtonBuilder> {
  const disabled = !data.signupWindowOpen;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId("signup", data.runId))
      .setLabel("Signup")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(buildCustomId("lootbuddy", data.runId))
      .setLabel("Sign as Lootbuddy")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(buildCustomId("cancel", data.runId))
      .setLabel("Cancel Signup")
      .setStyle(ButtonStyle.Danger),
  );
}
