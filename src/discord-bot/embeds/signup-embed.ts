import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import type {
  SignupEmbedData,
  SignupEmbedMember,
  SignupEmbedRoleMembers,
} from "@/services/discord-sync.service";
import { buildCustomId } from "@/discord-bot/custom-ids";
import { discordTimestamp } from "@/discord-bot/format";
import { chunkEmbedFieldLines } from "@/lib/discord-embed-field-chunking";
import { classIndicator } from "@/lib/run-start-message";
import { DIFFICULTY_LABELS, RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import type { WowClass } from "@/models/enums";

const RUN_STATUS_LABEL: Record<SignupEmbedData["runStatus"], string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  ROSTERING: "Rostering",
  PUBLISHED: "Roster published",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const EMPTY_FIELD_VALUE = "—";

/**
 * Discord limit on combined embed text (title + description + field names/values
 * + footer + author) across ALL embeds attached to a single message.
 */
export const DISCORD_EMBED_TOTAL_CHAR_LIMIT = 6000;

/** How many Discord messages the Signup sync posts (summary / signups / picked). */
export const SIGNUP_POST_MESSAGE_COUNT = 3;

export type SignupEmbedRenderOptions = {
  /** Pre-resolved Guild custom emoji markup keyed by WowClass. */
  classIndicators?: Partial<Record<WowClass, string>>;
};

type RoleColumnSpec = {
  emoji: string;
  label: string;
  countLabel: string;
  members: SignupEmbedMember[];
};

/** Discord mention preferred; fall back to @UserName when discordUserId is missing. */
export function formatSignupParticipantLine(
  member: SignupEmbedMember,
  classIndicators?: Partial<Record<WowClass, string>>,
): string {
  const mention = member.discordUserId ? `<@${member.discordUserId}>` : `@${member.userName}`;
  const indicator = classIndicator(member.wowClass, null, classIndicators);
  const character =
    member.characterName && member.characterRealm
      ? `${member.characterName}-${member.characterRealm}`
      : null;

  const parts = [mention];
  if (indicator) parts.push(indicator);
  if (character) parts.push(character);
  return parts.join(" ");
}

function buildRoleColumnFields(
  role: RoleColumnSpec,
  classIndicators?: Partial<Record<WowClass, string>>,
): Array<{ name: string; value: string; inline: boolean }> {
  const lines = role.members.map((member) => formatSignupParticipantLine(member, classIndicators));
  const chunks = chunkEmbedFieldLines(lines);
  const primaryName = `${role.emoji} ${role.label} — ${role.countLabel}`;
  const continuationName = `${role.emoji} ${role.label} (cont.)`;

  return chunks.map((chunk, index) => ({
    name: index === 0 ? primaryName : continuationName,
    value: chunk.length > 0 ? chunk.join("\n") : EMPTY_FIELD_VALUE,
    // Primary role columns stay inline so Tank|Healer|DPS share a row and
    // Lootbuddy starts the next. Continuations are full-width so they do not
    // scramble the following section's primary grid.
    inline: index === 0,
  }));
}

/**
 * Primary Tank|Healer|DPS|Lootbuddy fields first, then any continuations in
 * the same role order — keeps the role grid intact when one role overflows.
 */
function buildRoleSectionFields(
  roles: RoleColumnSpec[],
  classIndicators?: Partial<Record<WowClass, string>>,
): Array<{ name: string; value: string; inline: boolean }> {
  const built = roles.map((role) => buildRoleColumnFields(role, classIndicators));
  const primary = built.map((fields) => fields[0]!);
  const continuations = built.flatMap((fields) => fields.slice(1));
  return [...primary, ...continuations];
}

function signedRoleColumns(data: SignupEmbedData): RoleColumnSpec[] {
  const { roleStatus, members } = data;
  return [
    {
      emoji: "🛡",
      label: "Tanks",
      countLabel: String(roleStatus.tank.signed),
      members: members.signed.tanks,
    },
    {
      emoji: "✚",
      label: "Healers",
      countLabel: String(roleStatus.healer.signed),
      members: members.signed.healers,
    },
    {
      emoji: "⚔",
      label: "DPS",
      countLabel: String(roleStatus.dps.signed),
      members: members.signed.dps,
    },
    {
      emoji: "📦",
      label: "Lootbuddies",
      countLabel: String(roleStatus.lootbuddy.signed),
      members: members.signed.lootbuddies,
    },
  ];
}

function pickedRoleColumns(data: SignupEmbedData): RoleColumnSpec[] {
  const { roleStatus, members } = data;
  return [
    {
      emoji: "🛡",
      label: "Tanks",
      countLabel: `${roleStatus.tank.picked}/${roleStatus.tank.target}`,
      members: members.picked.tanks,
    },
    {
      emoji: "✚",
      label: "Healers",
      countLabel: `${roleStatus.healer.picked}/${roleStatus.healer.target}`,
      members: members.picked.healers,
    },
    {
      emoji: "⚔",
      label: "DPS",
      countLabel: `${roleStatus.dps.picked}/${roleStatus.dps.target}`,
      members: members.picked.dps,
    },
    {
      emoji: "📦",
      label: "Lootbuddies",
      countLabel: String(roleStatus.lootbuddy.picked),
      members: members.picked.lootbuddies,
    },
  ];
}

export function emptySignupEmbedMembers(): SignupEmbedRoleMembers {
  return { tanks: [], healers: [], dps: [], lootbuddies: [] };
}

export function measureEmbedJsonSize(embed: ReturnType<EmbedBuilder["toJSON"]>): {
  fieldCount: number;
  totalChars: number;
  maxFieldChars: number;
} {
  const fields = embed.fields ?? [];
  let totalChars =
    (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text?.length ?? 0);
  let maxFieldChars = 0;
  for (const field of fields) {
    totalChars += field.name.length + field.value.length;
    maxFieldChars = Math.max(maxFieldChars, field.value.length);
  }
  return { fieldCount: fields.length, totalChars, maxFieldChars };
}

/**
 * Persist multiple Signup Discord message snowflakes in the existing
 * `signupMessageId` column (no schema change). Discord snowflakes never
 * contain commas.
 */
export function encodeSignupMessageIds(messageIds: string[]): string {
  if (messageIds.length === 0) {
    throw new Error("encodeSignupMessageIds requires at least one message id");
  }
  return messageIds.join(",");
}

export function decodeSignupMessageIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Realistic QA-scale Signups+Picked participant lists exceed Discord's 6000
 * combined embed-character budget for a single message (Signups alone ~6095
 * with summary fields). Strategy — three messages in the Run channel:
 *  1) summary (+ Signup / Lootbuddy / Cancel buttons)
 *  2) Signups by role grid
 *  3) Picked grid
 * Each message carries exactly one embed so the per-message 6000 budget
 * applies independently. Message ids are stored comma-separated in
 * `signupMessageId` (no DB migration).
 */
export function buildSignupEmbeds(
  data: SignupEmbedData,
  options?: SignupEmbedRenderOptions,
): EmbedBuilder[] {
  const classIndicators = options?.classIndicators;
  const color = data.signupWindowOpen ? 0xd4af37 : 0x555555;
  const description = `${DIFFICULTY_LABELS[data.difficulty]} · ${data.raidName}`;

  const summary = new EmbedBuilder()
    .setTitle(data.runTitle)
    .setDescription(description)
    .addFields(
      { name: "Scheduled", value: discordTimestamp(data.scheduledStartAt), inline: true },
      { name: "Signed users", value: String(data.uniqueSignupCount), inline: true },
      { name: "Status", value: RUN_STATUS_LABEL[data.runStatus], inline: true },
      { name: "Loot", value: RUN_LOOT_TYPE_LABELS[data.lootType], inline: true },
      { name: "Bosses", value: `${data.plannedBossCount}/${data.totalBossCount}`, inline: true },
    )
    .setColor(color)
    .setFooter({ text: data.signupWindowOpen ? "Signups are open." : "Signups are closed." });

  // No description/footer here — participant lists need the full 6000 budget.
  const signups = new EmbedBuilder()
    .setTitle("Signups by role")
    .addFields(...buildRoleSectionFields(signedRoleColumns(data), classIndicators))
    .setColor(color);

  const picked = new EmbedBuilder()
    .setTitle("Picked")
    .addFields(...buildRoleSectionFields(pickedRoleColumns(data), classIndicators))
    .setColor(color);

  return [summary, signups, picked];
}

/** @deprecated Prefer buildSignupEmbeds — kept as a thin alias for callers that expect one builder. */
export function buildSignupEmbed(
  data: SignupEmbedData,
  options?: SignupEmbedRenderOptions,
): EmbedBuilder {
  return buildSignupEmbeds(data, options)[0]!;
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
