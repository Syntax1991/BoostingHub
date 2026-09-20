import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import type {
  SignupEmbedData,
  SignupEmbedMember,
  SignupEmbedRoleMembers,
} from "@/services/discord-sync.service";
import { buildCustomId } from "@/discord-bot/custom-ids";
import type { GuildRoleIndicators, RoleDiscordEmojiKey } from "@/discord-bot/class-emoji-lookup";
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
/** Zero-width space — Discord requires a non-empty field value. */
const SECTION_HEADING_VALUE = "\u200b";

const ROLE_EMOJI_FALLBACK: Record<RoleDiscordEmojiKey, string> = {
  tank: "🛡",
  healer: "✚",
  dps: "⚔",
  lootbuddy: "📦",
  raidlead: "★",
};

/**
 * Discord limit on combined embed text (title + description + field names/values
 * + footer + author) for a single Embed / message.
 */
export const DISCORD_EMBED_TOTAL_CHAR_LIMIT = 6000;

export type SignupEmbedRenderOptions = {
  /** Pre-resolved Guild custom emoji markup keyed by WowClass. */
  classIndicators?: Partial<Record<WowClass, string>>;
  /** Pre-resolved Guild custom emoji markup for tank/healer/dps/lootbuddy/raidlead. */
  roleIndicators?: GuildRoleIndicators;
};

type RoleColumnSpec = {
  emojiKey: RoleDiscordEmojiKey;
  label: string;
  countLabel: string;
  members: SignupEmbedMember[];
};

function roleEmoji(key: RoleDiscordEmojiKey, roleIndicators?: GuildRoleIndicators): string {
  return roleIndicators?.[key] ?? ROLE_EMOJI_FALLBACK[key];
}

/** Discord mention + class indicator — Character-Realm lives in Final Setup / Web.
 * Mentions show the server nickname when set (`syntax_1991`); that is a real
 * ping. Plain `@discordUsername` is only the fallback when no Discord id is linked.
 */
export function formatSignupParticipantLine(
  member: SignupEmbedMember,
  classIndicators?: Partial<Record<WowClass, string>>,
): string {
  return formatSignupParticipantGroupLine([member], classIndicators);
}

/**
 * One line per User: mention once, then every distinct class icon for that
 * User's offers in this role column (e.g. `<@id> <:paladin:> <:mage:>`).
 */
export function formatSignupParticipantGroupLine(
  members: readonly SignupEmbedMember[],
  classIndicators?: Partial<Record<WowClass, string>>,
): string {
  const primary = members[0];
  if (!primary) return "";

  const mention = primary.discordUserId
    ? `<@${primary.discordUserId}>`
    : `@${(primary.discordUsername?.trim() || primary.userName).replace(/^@/, "")}`;

  const seenClasses = new Set<string>();
  const indicators: string[] = [];
  for (const member of members) {
    const wowClass = member.wowClass;
    if (!wowClass || seenClasses.has(wowClass)) continue;
    seenClasses.add(wowClass);
    const indicator = classIndicator(wowClass, null, classIndicators);
    if (indicator) indicators.push(indicator);
  }

  return [mention, ...indicators].join(" ");
}

/** Stable User key for grouping — prefer Discord snowflake, else app userId. */
function signupMemberUserKey(member: SignupEmbedMember): string {
  return member.discordUserId ?? `user:${member.userId}`;
}

/**
 * Collapses multiple offers from the same User into one display group,
 * preserving first-seen User order and within-group member order.
 */
export function groupSignupMembersByUser(members: readonly SignupEmbedMember[]): SignupEmbedMember[][] {
  const order: string[] = [];
  const groups = new Map<string, SignupEmbedMember[]>();
  for (const member of members) {
    const key = signupMemberUserKey(member);
    const existing = groups.get(key);
    if (existing) {
      existing.push(member);
      continue;
    }
    order.push(key);
    groups.set(key, [member]);
  }
  return order.map((key) => groups.get(key)!);
}

export function formatRaidLeadFieldValue(data: SignupEmbedData): string {
  if (data.raidLeadDiscordUserId) {
    return `<@${data.raidLeadDiscordUserId}>`;
  }
  const name = data.raidLeadName.trim();
  return name.length > 0 ? name : EMPTY_FIELD_VALUE;
}

function buildRoleColumnFields(
  role: RoleColumnSpec,
  classIndicators?: Partial<Record<WowClass, string>>,
  roleIndicators?: GuildRoleIndicators,
): Array<{ name: string; value: string; inline: boolean }> {
  const emoji = roleEmoji(role.emojiKey, roleIndicators);
  const lines = groupSignupMembersByUser(role.members).map((group) =>
    formatSignupParticipantGroupLine(group, classIndicators),
  );
  const chunks = chunkEmbedFieldLines(lines);
  const primaryName = `${emoji} ${role.label} — ${role.countLabel}`;
  const continuationName = `${emoji} ${role.label} (cont.)`;

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
  roleIndicators?: GuildRoleIndicators,
): Array<{ name: string; value: string; inline: boolean }> {
  const built = roles.map((role) => buildRoleColumnFields(role, classIndicators, roleIndicators));
  const primary = built.map((fields) => fields[0]!);
  const continuations = built.flatMap((fields) => fields.slice(1));
  return [...primary, ...continuations];
}

function signedRoleColumns(data: SignupEmbedData): RoleColumnSpec[] {
  const { roleStatus, members } = data;
  return [
    {
      emojiKey: "tank",
      label: "Tanks",
      countLabel: String(roleStatus.tank.signed),
      members: members.signed.tanks,
    },
    {
      emojiKey: "healer",
      label: "Healers",
      countLabel: String(roleStatus.healer.signed),
      members: members.signed.healers,
    },
    {
      emojiKey: "dps",
      label: "DPS",
      countLabel: String(roleStatus.dps.signed),
      members: members.signed.dps,
    },
    {
      emojiKey: "lootbuddy",
      label: "Lootbuddies",
      countLabel: String(roleStatus.lootbuddy.signed),
      members: members.signed.lootbuddies,
    },
  ];
}

function rosterRoleColumns(data: SignupEmbedData): RoleColumnSpec[] {
  const { roleStatus, members } = data;
  return [
    {
      emojiKey: "tank",
      label: "Tanks",
      countLabel: `${roleStatus.tank.picked}/${roleStatus.tank.target}`,
      members: members.picked.tanks,
    },
    {
      emojiKey: "healer",
      label: "Healers",
      countLabel: `${roleStatus.healer.picked}/${roleStatus.healer.target}`,
      members: members.picked.healers,
    },
    {
      emojiKey: "dps",
      label: "DPS",
      countLabel: `${roleStatus.dps.picked}/${roleStatus.dps.target}`,
      members: members.picked.dps,
    },
    {
      emojiKey: "lootbuddy",
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
 * One Signup Discord message → one Embed: summary + Signups by role + Roster.
 * Continuations (if a role exceeds 1024 chars) stay inside this same Embed.
 * Designed for realistic Run capacity (~20–25 unique signup users).
 */
export function buildSignupEmbed(
  data: SignupEmbedData,
  options?: SignupEmbedRenderOptions,
): EmbedBuilder {
  const classIndicators = options?.classIndicators;
  const roleIndicators = options?.roleIndicators;
  const color = data.signupWindowOpen ? 0xd4af37 : 0x555555;
  const description = data.contentSummary
    ? `${DIFFICULTY_LABELS[data.difficulty]} · ${data.productLabel}\n${data.contentSummary}`
    : `${DIFFICULTY_LABELS[data.difficulty]} · ${data.productLabel}`;
  const raidLeadEmoji = roleEmoji("raidlead", roleIndicators);

  return new EmbedBuilder()
    .setTitle(data.runTitle)
    .setDescription(description)
    .addFields(
      { name: "Scheduled", value: discordTimestamp(data.scheduledStartAt), inline: true },
      { name: "Signed users", value: String(data.uniqueSignupCount), inline: true },
      { name: "Status", value: RUN_STATUS_LABEL[data.runStatus], inline: true },
      { name: "Loot", value: RUN_LOOT_TYPE_LABELS[data.lootType], inline: true },
      { name: `${raidLeadEmoji} Raid Lead`, value: formatRaidLeadFieldValue(data), inline: true },
      { name: "Signups by role", value: SECTION_HEADING_VALUE, inline: false },
      ...buildRoleSectionFields(signedRoleColumns(data), classIndicators, roleIndicators),
      { name: "Roster", value: SECTION_HEADING_VALUE, inline: false },
      ...buildRoleSectionFields(rosterRoleColumns(data), classIndicators, roleIndicators),
    )
    .setColor(color)
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
