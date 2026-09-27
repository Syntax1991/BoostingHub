import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction } from "discord.js";
import { guideChannelUrl, GUIDE_CHANNEL_IDS, type GuideKind } from "@/discord-bot/guide-channels";

const GUIDES: Record<GuideKind, { title: string; emoji: string; summary: string }> = {
  booster: {
    title: "Booster Guide",
    emoji: "📘",
    summary: "sign in, add characters, sign up for runs and track your status",
  },
  raidlead: {
    title: "Raid Lead Guide",
    emoji: "📗",
    summary: "create runs, open signups, build and publish rosters, start runs and mark attendance",
  },
};

function isGuideKind(value: string): value is GuideKind {
  return Object.hasOwn(GUIDE_CHANNEL_IDS, value);
}

/** Links to the guide's channel in the given guild. */
export function buildGuideReply(guildId: string, kind: GuideKind) {
  const guide = GUIDES[kind];
  const url = guideChannelUrl(guildId, kind);
  return {
    content: `${guide.emoji} **${guide.title}** — ${guide.summary}: ${url}`,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(`Open ${guide.title}`)
          .setEmoji(guide.emoji)
          .setURL(url),
      ),
    ],
  };
}

export async function handleGuideCommand(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const kind = interaction.options.getSubcommand();
  if (isGuideKind(kind)) {
    await interaction.reply({ ...buildGuideReply(interaction.guildId ?? guildId, kind), ephemeral: true });
  }
}
