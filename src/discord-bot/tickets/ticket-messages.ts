import { createHash } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type MessageCreateOptions,
} from "discord.js";
import type { BotSupportTicket } from "@/discord-bot/bot-api-client";
import {
  buildTicketActionCustomId,
  buildTicketModalCustomId,
  TICKET_MODAL_FIELDS,
  TICKET_PANEL_SELECT_ID,
} from "@/discord-bot/tickets/ticket-custom-ids";
import {
  formatSupportTicketNumber,
  SUPPORT_TICKET_LIMITS,
  SUPPORT_TICKET_TYPE_DEFINITIONS,
} from "@/lib/support-tickets";
import { SUPPORT_TICKET_TYPES, type SupportTicketType } from "@/models/enums";

const TICKET_COLOR = 0x5865f2;
const ARCHIVE_COLOR = 0x57f287;

/** Never ping anyone unless a caller opts specific roles in. */
export const NO_MENTIONS = { parse: [] as never[] };

function unixSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** The permanent Support panel. Unicode emoji only; no external assets. */
export function buildSupportPanelMessage(): Pick<MessageCreateOptions, "embeds" | "components" | "allowedMentions"> {
  const categories = SUPPORT_TICKET_TYPES.map((type) => `• ${SUPPORT_TICKET_TYPE_DEFINITIONS[type].label}`).join("\n");
  const embed = new EmbedBuilder()
    .setColor(TICKET_COLOR)
    .setTitle("TICKET • SUPPORT")
    .setDescription(
      [
        "**Need help or have a question?**",
        "",
        "Select the appropriate category below and complete the requested information. " +
          "A member of the support team will respond as soon as possible.",
        "",
        "**Ticket categories**",
        categories,
      ].join("\n"),
    );
  const select = new StringSelectMenuBuilder()
    .setCustomId(TICKET_PANEL_SELECT_ID)
    .setPlaceholder("Open a ticket")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      SUPPORT_TICKET_TYPES.map((type) => ({
        label: SUPPORT_TICKET_TYPE_DEFINITIONS[type].label,
        value: type,
        description: SUPPORT_TICKET_TYPE_DEFINITIONS[type].description,
        emoji: SUPPORT_TICKET_TYPE_DEFINITIONS[type].emoji,
      })),
    );
  return {
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    allowedMentions: NO_MENTIONS,
  };
}

/** Content version of the panel: any copy/option change yields a new signature → edit in place. */
export function supportPanelSignature(payload = buildSupportPanelMessage()): string {
  const json = JSON.stringify({
    embeds: (payload.embeds ?? []).map((embed) => ("toJSON" in embed ? embed.toJSON() : embed)),
    components: (payload.components ?? []).map((row) => ("toJSON" in row ? row.toJSON() : row)),
  });
  return `panel-v1:${createHash("sha256").update(json).digest("hex").slice(0, 32)}`;
}

function textInput(id: string, style: TextInputStyle, max: number, required: boolean, min?: number, placeholder?: string | null) {
  const input = new TextInputBuilder().setCustomId(id).setStyle(style).setMaxLength(max).setRequired(required);
  if (min) input.setMinLength(min);
  if (placeholder) input.setPlaceholder(clip(placeholder, 100));
  return input;
}

/** Category modal. Attachments are posted in the ticket channel afterwards, never via the modal. */
export function buildTicketModal(type: SupportTicketType): ModalBuilder {
  const definition = SUPPORT_TICKET_TYPE_DEFINITIONS[type];
  const labels: LabelBuilder[] = [];
  if (type === "REPORT_BOOSTER") {
    labels.push(
      new LabelBuilder()
        .setLabel("Booster")
        .setDescription("@mention, Discord user ID, or character name")
        .setTextInputComponent(
          textInput(TICKET_MODAL_FIELDS.booster, TextInputStyle.Short, SUPPORT_TICKET_LIMITS.boosterMax, true),
        ),
    );
  }
  labels.push(
    new LabelBuilder()
      .setLabel("Subject")
      .setTextInputComponent(
        textInput(TICKET_MODAL_FIELDS.subject, TextInputStyle.Short, SUPPORT_TICKET_LIMITS.subjectMax, true),
      ),
  );
  if (definition.referenceLabel) {
    labels.push(
      new LabelBuilder()
        .setLabel(definition.referenceLabel)
        .setTextInputComponent(
          textInput(
            TICKET_MODAL_FIELDS.reference,
            TextInputStyle.Short,
            SUPPORT_TICKET_LIMITS.referenceMax,
            false,
            undefined,
            definition.referencePlaceholder,
          ),
        ),
    );
  }
  labels.push(
    new LabelBuilder()
      .setLabel(type === "REPORT_BOOSTER" ? "Reason / details" : "Describe the issue")
      .setDescription(
        type === "REPORT_BOOSTER"
          ? "Screenshots can be posted in the ticket channel after it opens."
          : "You can add screenshots in the ticket channel after it opens.",
      )
      .setTextInputComponent(
        textInput(
          TICKET_MODAL_FIELDS.description,
          TextInputStyle.Paragraph,
          SUPPORT_TICKET_LIMITS.descriptionMax,
          true,
          SUPPORT_TICKET_LIMITS.descriptionMin,
        ),
      ),
  );
  return new ModalBuilder()
    .setCustomId(buildTicketModalCustomId(type))
    .setTitle(definition.label)
    .addLabelComponents(...labels);
}

export function ticketTitle(ticket: Pick<BotSupportTicket, "number" | "type">): string {
  return `Ticket #${formatSupportTicketNumber(ticket.number)} • ${SUPPORT_TICKET_TYPE_DEFINITIONS[ticket.type].label}`;
}

/**
 * Ticket header posted once when the channel opens. The only pings are the
 * type's configured Staff roles (`allowedMentions.roles`); the creator and a
 * reported Booster appear inside the embed, which never pings.
 */
export function buildTicketOpeningMessage(ticket: BotSupportTicket, staffRoleIds: readonly string[]): MessageCreateOptions {
  const embed = new EmbedBuilder()
    .setColor(TICKET_COLOR)
    .setTitle(ticketTitle(ticket))
    .addFields({ name: "Opened by", value: `<@${ticket.creatorDiscordUserId}>`, inline: true });
  if (ticket.type === "REPORT_BOOSTER") {
    embed.addFields({ name: "Reported Booster", value: clip(ticket.reportedBoosterLabel || "—", 1024), inline: true });
  }
  embed.addFields({ name: "Subject", value: clip(ticket.subject, 1024) });
  if (ticket.reference) {
    const label = SUPPORT_TICKET_TYPE_DEFINITIONS[ticket.type].referenceLabel ?? "Reference";
    embed.addFields({ name: label, value: clip(ticket.reference, 1024) });
  }
  embed.addFields({ name: "Created", value: `<t:${unixSeconds(ticket.createdAt)}:F>` });
  const descriptionLabel = ticket.type === "REPORT_BOOSTER" ? "Reason / details" : "Description";
  embed.setDescription(clip(`**${descriptionLabel}**\n${ticket.description}`, 4096));
  embed.setFooter({ text: "Post screenshots or other evidence here. Use Close Ticket when this is resolved." });

  const roles = [...new Set(staffRoleIds)];
  return {
    content: roles.map((roleId) => `<@&${roleId}>`).join(" "),
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildTicketActionCustomId("close", ticket.id))
          .setStyle(ButtonStyle.Danger)
          .setLabel("Close Ticket")
          .setEmoji("🔒"),
      ),
    ],
    allowedMentions: { parse: [], roles },
  };
}

export function buildCloseConfirmation(ticketId: string) {
  return {
    content: "Close this ticket? A transcript is archived for Staff and the channel is deleted.",
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildTicketActionCustomId("close-confirm", ticketId))
          .setStyle(ButtonStyle.Danger)
          .setLabel("Confirm Close"),
        new ButtonBuilder()
          .setCustomId(buildTicketActionCustomId("close-cancel", ticketId))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Cancel"),
      ),
    ],
  };
}

/** Summary embed posted together with the HTML transcript into the Staff archive log. */
export function buildTicketArchiveSummary(input: {
  ticket: BotSupportTicket;
  closedAt: string;
  closedByDiscordUserId: string;
  messageCount: number;
  truncated: boolean;
}): EmbedBuilder {
  const { ticket } = input;
  const embed = new EmbedBuilder()
    .setColor(ARCHIVE_COLOR)
    .setTitle(ticketTitle(ticket))
    .addFields(
      { name: "Opened by", value: `<@${ticket.creatorDiscordUserId}> (${clip(ticket.creatorDisplayName, 100)})`, inline: true },
      { name: "Closed by", value: `<@${input.closedByDiscordUserId}>`, inline: true },
    );
  if (ticket.type === "REPORT_BOOSTER") {
    embed.addFields({ name: "Reported Booster", value: clip(ticket.reportedBoosterLabel || "—", 1024), inline: true });
  }
  embed.addFields(
    { name: "Subject", value: clip(ticket.subject, 1024) },
    { name: "Created", value: `<t:${unixSeconds(ticket.createdAt)}:F>`, inline: true },
    { name: "Closed", value: `<t:${unixSeconds(input.closedAt)}:F>`, inline: true },
    {
      name: "Transcript",
      value: input.truncated
        ? `${input.messageCount} messages — **truncated**, oldest messages not included`
        : `${input.messageCount} messages`,
      inline: true,
    },
  );
  return embed;
}
