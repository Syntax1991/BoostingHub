import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { absoluteRunUrl } from "@/lib/app-url";
import type {
  SignupEmbedData,
  SignupEmbedMember,
  SignupEmbedNote,
  SignupEmbedRoleMembers,
} from "@/services/discord-sync.service";
import { buildCustomId } from "@/discord-bot/custom-ids";
import type { GuildRoleIndicators, RoleDiscordEmojiKey } from "@/discord-bot/class-emoji-lookup";
import { LOOT_EMOJIS } from "@/discord-bot/embeds/raidboost-announce";
import {
  DISCORD_EMBED_FIELD_COUNT_LIMIT,
  DISCORD_EMBED_FIELD_VALUE_LIMIT,
  chunkEmbedFieldLines,
} from "@/lib/discord-embed-field-chunking";
import { classIndicator } from "@/lib/run-start-message";
import { RUN_LOOT_TYPE_LABELS } from "@/lib/labels";
import type { WowClass } from "@/models/enums";

const EMPTY_FIELD_VALUE = "—";
/** Zero-width space — Discord requires a non-empty field name / value. */
const ZERO_WIDTH = "​";

const ROLE_EMOJI_FALLBACK: Record<RoleDiscordEmojiKey, string> = {
  tank: "🛡",
  healer: "✚",
  dps: "⚔",
  lootbuddy: "💰",
  raidlead: "⚔",
  vip: LOOT_EMOJIS.VIP,
};

/**
 * One blank line closing a section (Discord trims trailing whitespace, but a
 * line holding only a zero-width space survives). Used once per section
 * boundary — never between players — so 20+ signups stay compact.
 */
const SECTION_GAP = `\n${ZERO_WIDTH}`;

/** Appends the section gap to the field(s) that visually close a section. */
function closeSection(fields: EmbedField[], closing: readonly EmbedField[]): EmbedField[] {
  return fields.map((field) =>
    closing.includes(field) ? { ...field, value: `${field.value}${SECTION_GAP}` } : field,
  );
}

/** Discord limit on combined embed text (title + description + fields + footer). */
export const DISCORD_EMBED_TOTAL_CHAR_LIMIT = 6000;

/** One note line stays short so many notes still fit (the full note lives on the Run). */
export const SIGNUP_NOTE_DISPLAY_MAX = 100;

export type SignupEmbedRenderOptions = {
  /** Pre-resolved Guild custom emoji markup keyed by WowClass. */
  classIndicators?: Partial<Record<WowClass, string>>;
  /** Pre-resolved Guild custom emoji markup for tank/healer/dps/lootbuddy/raidlead. */
  roleIndicators?: GuildRoleIndicators;
  /** Test seam for the Run link (defaults to the app URL from env). */
  runUrl?: string | null;
};

type EmbedField = { name: string; value: string; inline: boolean };

type RoleColumnSpec = {
  emojiKey: RoleDiscordEmojiKey;
  label: string;
  members: SignupEmbedMember[];
  signed: number;
};

function roleEmoji(key: RoleDiscordEmojiKey, roleIndicators?: GuildRoleIndicators): string {
  return roleIndicators?.[key] ?? ROLE_EMOJI_FALLBACK[key];
}

function mentionFor(
  member: Pick<SignupEmbedMember, "discordUserId" | "discordUsername" | "userName">,
): string {
  return member.discordUserId
    ? `<@${member.discordUserId}>`
    : `@${(member.discordUsername?.trim() || member.userName).replace(/^@/, "")}`;
}

/** Class indicator + Discord mention. Mentions show the server nickname and are a real ping. */
export function formatSignupParticipantLine(
  member: SignupEmbedMember,
  classIndicators?: Partial<Record<WowClass, string>>,
): string {
  return formatSignupParticipantGroupLine([member], classIndicators);
}

/**
 * One line per User: every distinct class icon of that User's offers in this
 * column, then the mention once (e.g. `<:paladin:> <:mage:> <@id>`).
 * `classIndicators === null` renders mentions only (compact fallback).
 */
export function formatSignupParticipantGroupLine(
  members: readonly SignupEmbedMember[],
  classIndicators?: Partial<Record<WowClass, string>> | null,
): string {
  const primary = members[0];
  if (!primary) return "";
  if (classIndicators === null) return mentionFor(primary);

  const seenClasses = new Set<string>();
  const indicators: string[] = [];
  for (const member of members) {
    const wowClass = member.wowClass;
    if (!wowClass || seenClasses.has(wowClass)) continue;
    seenClasses.add(wowClass);
    const indicator = classIndicator(wowClass, null, classIndicators);
    if (indicator) indicators.push(indicator);
  }
  return [...indicators, mentionFor(primary)].join(" ");
}

/** Stable User key for grouping — prefer Discord snowflake, else app userId. */
function signupMemberUserKey(member: SignupEmbedMember): string {
  return member.discordUserId ?? `user:${member.userId}`;
}

/** Collapses multiple offers from the same User into one group (first-seen order). */
export function groupSignupMembersByUser(
  members: readonly SignupEmbedMember[],
): SignupEmbedMember[][] {
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
  if (data.raidLeadDiscordUserId) return `<@${data.raidLeadDiscordUserId}>`;
  const name = data.raidLeadName.trim();
  return name.length > 0 ? name : EMPTY_FIELD_VALUE;
}

function unixSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function roleColumns(data: SignupEmbedData): RoleColumnSpec[] {
  const { roleStatus, members } = data;
  return [
    {
      emojiKey: "tank",
      label: "Tanks",
      members: members.signed.tanks,
      signed: roleStatus.tank.signed,
    },
    {
      emojiKey: "healer",
      label: "Healers",
      members: members.signed.healers,
      signed: roleStatus.healer.signed,
    },
    { emojiKey: "dps", label: "DPS", members: members.signed.dps, signed: roleStatus.dps.signed },
  ];
}

function lootbuddyColumn(data: SignupEmbedData): RoleColumnSpec {
  return {
    emojiKey: "lootbuddy",
    label: "Lootbuddies",
    members: data.members.signed.lootbuddies,
    signed: data.roleStatus.lootbuddy.signed,
  };
}

function buildColumnFields(
  column: RoleColumnSpec,
  classIndicators: Partial<Record<WowClass, string>> | null | undefined,
  roleIndicators: GuildRoleIndicators | undefined,
  inline: boolean,
): EmbedField[] {
  const emoji = roleEmoji(column.emojiKey, roleIndicators);
  const lines = groupSignupMembersByUser(column.members).map((group) =>
    formatSignupParticipantGroupLine(group, classIndicators),
  );
  // Signup demand only (`Healers 5`) — never `/target`: five Healer signups for three
  // roster slots is valid, and selection progress lives on the Roster message.
  const heading = `${emoji} ${column.label} ${column.signed}`;
  return chunkEmbedFieldLines(lines).map((chunk, index) => ({
    name: index === 0 ? heading : `${emoji} ${column.label} (cont.)`,
    value: chunk.length > 0 ? chunk.join("\n") : EMPTY_FIELD_VALUE,
    // Primary Tank | Healer | DPS columns share one row on desktop; continuations
    // are full width so they never scramble that grid. Headings carry their own
    // counts, so stacked columns on mobile still read on their own.
    inline: inline && index === 0,
  }));
}

/** Tank | Healer | DPS primaries first, then any continuations in the same order. */
function buildRoleFields(
  data: SignupEmbedData,
  classIndicators: Partial<Record<WowClass, string>> | null | undefined,
  roleIndicators: GuildRoleIndicators | undefined,
): EmbedField[] {
  const built = roleColumns(data).map((column) =>
    buildColumnFields(column, classIndicators, roleIndicators, true),
  );
  const primaries = built.map((fields) => fields[0]!);
  const continuations = built.flatMap((fields) => fields.slice(1));
  // Gap before Lootbuddies: under the Tanks | Healers | DPS row (the tallest column sets it).
  const closing = continuations.length > 0 ? [continuations[continuations.length - 1]!] : primaries;
  return closeSection([...primaries, ...continuations], closing);
}

function truncate(text: string, max: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length <= max ? singleLine : `${singleLine.slice(0, max - 1)}…`;
}

export function formatSignupNoteLine(
  note: SignupEmbedNote,
  max: number = SIGNUP_NOTE_DISPLAY_MAX,
): string {
  return `${mentionFor(note)} — ${truncate(note.note, max)}`;
}

function buildNotesFields(notes: readonly SignupEmbedNote[], maxNoteChars: number): EmbedField[] {
  if (notes.length === 0) return [];
  const lines = notes.map((note) => formatSignupNoteLine(note, maxNoteChars));
  return chunkEmbedFieldLines(lines).map((chunk, index) => ({
    name: index === 0 ? "📝 Notes" : "📝 Notes (cont.)",
    value: chunk.join("\n"),
    inline: false,
  }));
}

/** Distinct signed-up Users (the existing "Signed users" meaning), never selection progress. */
/** VIP shows the Guild's `:Unsaved:` emoji when present; other Run types keep unicode. */
function lootTypeEmoji(data: SignupEmbedData, roleIndicators?: GuildRoleIndicators): string {
  return data.lootType === "VIP" ? roleEmoji("vip", roleIndicators) : LOOT_EMOJIS[data.lootType];
}

function signedSummary(data: SignupEmbedData): string {
  return `👥 ${data.uniqueSignupCount} signed`;
}

/** Raid lead as plain text — field names cannot render mentions. */
function raidLeadName(data: SignupEmbedData): string {
  const name = data.raidLeadName.trim();
  return name.length > 0 ? name : EMPTY_FIELD_VALUE;
}

/**
 * The Run header as one 3×2 grid of inline fields, aligned with the
 * Tanks | Healers | DPS columns below it:
 *
 *   ⚔ Raid lead   💎 VIP        👥 14 signed
 *   📅 date       🕒 time       ◷ in 3 days
 */
export function buildSignupHeaderFields(
  data: SignupEmbedData,
  roleIndicators?: GuildRoleIndicators,
): EmbedField[] {
  const seconds = unixSeconds(data.scheduledStartAt);
  return [
    { name: `${roleEmoji("raidlead", roleIndicators)} ${raidLeadName(data)}`, value: `📅 <t:${seconds}:D>` },
    {
      name: `${lootTypeEmoji(data, roleIndicators)} ${RUN_LOOT_TYPE_LABELS[data.lootType]}`,
      value: `🕒 <t:${seconds}:t>`,
    },
    { name: signedSummary(data), value: `◷ <t:${seconds}:R>` },
  ].map((field) => ({ ...field, inline: true }));
}

/** Only when signups are closed or the Run ended; an open Run has no description. */
export function buildSignupStateLine(data: SignupEmbedData): string | null {
  if (isRunEnded(data)) return "Run ended — Raid Lead / Admin can archive it below.";
  return data.signupWindowOpen ? null : "Signups are closed.";
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
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.footer?.text?.length ?? 0);
  let maxFieldChars = 0;
  for (const field of fields) {
    totalChars += field.name.length + field.value.length;
    maxFieldChars = Math.max(maxFieldChars, field.value.length);
  }
  return { fieldCount: fields.length, totalChars, maxFieldChars };
}

type RenderStep = {
  /** `null` = mentions only (class icons dropped). */
  classIndicators: Partial<Record<WowClass, string>> | null | undefined;
  maxNoteChars: number;
};

function assemble(
  data: SignupEmbedData,
  options: SignupEmbedRenderOptions | undefined,
  step: RenderStep,
): EmbedBuilder {
  const runUrl = options?.runUrl === undefined ? absoluteRunUrl(data.runId) : options.runUrl;
  const title = (data.contentTitle?.trim() || data.productLabel).slice(0, 256);
  const notes = buildNotesFields(data.notes ?? [], step.maxNoteChars);
  const lootbuddies = buildColumnFields(
    lootbuddyColumn(data),
    step.classIndicators,
    options?.roleIndicators,
    false,
  );
  const fields: EmbedField[] = [
    ...buildSignupHeaderFields(data, options?.roleIndicators),
    ...buildRoleFields(data, step.classIndicators, options?.roleIndicators),
    // Lootbuddies → Notes gap only when Notes follow.
    ...(notes.length > 0
      ? closeSection(lootbuddies, [lootbuddies[lootbuddies.length - 1]!])
      : lootbuddies),
    ...notes,
  ];
  // The Open Run field's empty name renders as one blank line: the gap before the link.
  if (runUrl) fields.push({ name: ZERO_WIDTH, value: `🔗 [Open Run](${runUrl})`, inline: false });

  const embed = new EmbedBuilder()
    .setTitle(title)
    .addFields(fields)
    .setColor(data.signupWindowOpen ? 0xd4af37 : 0x555555);
  const stateLine = buildSignupStateLine(data);
  if (stateLine) embed.setDescription(stateLine);
  if (runUrl) embed.setURL(runUrl);
  if (!isRunEnded(data)) embed.setFooter({ text: "Signup does not mean selected." });
  return embed;
}

function fitsDiscordLimits(embed: EmbedBuilder): boolean {
  const size = measureEmbedJsonSize(embed.toJSON());
  return (
    size.totalChars <= DISCORD_EMBED_TOTAL_CHAR_LIMIT &&
    size.fieldCount <= DISCORD_EMBED_FIELD_COUNT_LIMIT &&
    size.maxFieldChars <= DISCORD_EMBED_FIELD_VALUE_LIMIT
  );
}

/**
 * The Signup Discord message: `contentTitle` ("Venom & Tide & Kithix") linking
 * to the Run, the 3×2 header grid, then the roster-first body — Tanks | Healers
 * | DPS columns, Lootbuddies, Notes (only when someone left one), Open Run.
 * The selected lineup stays on the separate Roster message.
 *
 * Deterministic fallback when Discord's limits would be exceeded: first class
 * icons are dropped (mentions stay), then note lines are shortened. Roster
 * names are never dropped.
 */
export function buildSignupEmbed(
  data: SignupEmbedData,
  options?: SignupEmbedRenderOptions,
): EmbedBuilder {
  const steps: RenderStep[] = [
    { classIndicators: options?.classIndicators, maxNoteChars: SIGNUP_NOTE_DISPLAY_MAX },
    { classIndicators: null, maxNoteChars: SIGNUP_NOTE_DISPLAY_MAX },
    { classIndicators: null, maxNoteChars: 40 },
  ];
  let embed: EmbedBuilder | null = null;
  for (const step of steps) {
    embed = assemble(data, options, step);
    if (fitsDiscordLimits(embed)) return embed;
  }
  return embed!;
}

/** Completed / cancelled: the Run can be archived (same rule as the app: canArchiveRun). */
function isRunEnded(data: Pick<SignupEmbedData, "runStatus">): boolean {
  return data.runStatus === "COMPLETED" || data.runStatus === "CANCELLED";
}

/**
 * Two rows below the embed: Signup · Quick Sign · LB, then Unsign · Add / Edit
 * Note. Signup buttons disable once the window closes (the server is the real
 * gate either way); Unsign and the note stay available. An ended Run shows
 * only "Archive Run". The LB button carries the Guild lootbuddy emoji when present.
 */
export function buildSignupButtons(
  data: SignupEmbedData,
  roleIndicators?: GuildRoleIndicators,
): ActionRowBuilder<ButtonBuilder>[] {
  if (isRunEnded(data)) {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildCustomId("archive", data.runId))
          .setLabel("Archive Run")
          .setEmoji("🗄️")
          .setStyle(ButtonStyle.Secondary),
      ),
    ];
  }
  const disabled = !data.signupWindowOpen;
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildCustomId("signup", data.runId))
        .setLabel("Signup")
        .setEmoji("📝")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(buildCustomId("quick-signup", data.runId))
        .setLabel("Quick Sign")
        .setEmoji("⚡")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(buildCustomId("lootbuddy", data.runId))
        .setLabel("LB")
        .setEmoji(roleEmoji("lootbuddy", roleIndicators))
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildCustomId("cancel", data.runId))
        .setLabel("Unsign")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(buildCustomId("note", data.runId))
        .setLabel("Add / Edit Note")
        .setEmoji("🗒️")
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}
