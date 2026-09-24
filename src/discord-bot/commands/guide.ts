import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction } from "discord.js";

/** Forum thread holding the English booster guide (posted by scripts/post-booster-guide.mts). */
export const BOOSTER_GUIDE_THREAD_ID = "1552698422677737694";

export function guideThreadUrl(guildId: string): string {
  return `https://discord.com/channels/${guildId}/${BOOSTER_GUIDE_THREAD_ID}`;
}

export function buildGuideReply(guildId: string) {
  const url = guideThreadUrl(guildId);
  return {
    content: `📘 **Booster Guide** — sign in, add characters, sign up for runs and track your status: ${url}`,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open Booster Guide").setEmoji("📘").setURL(url),
      ),
    ],
  };
}

export async function handleGuideCommand(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  if (interaction.options.getSubcommand() === "booster") {
    await interaction.reply({ ...buildGuideReply(interaction.guildId ?? guildId), ephemeral: true });
  }
}
