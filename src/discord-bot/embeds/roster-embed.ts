import { EmbedBuilder } from "discord.js";
import type { GuildRoleIndicators, RoleDiscordEmojiKey } from "@/discord-bot/class-emoji-lookup";
import { characterLabel } from "@/discord-bot/format";
import { classIndicator } from "@/lib/run-start-message";
import type { RosterEmbedData, RosterEmbedMember } from "@/services/discord-sync.service";
import type { WowClass } from "@/models/enums";

const DIFFICULTY_LABEL: Record<RosterEmbedData["difficulty"], string> = {
  NORMAL: "Normal",
  HEROIC: "Heroic",
  MYTHIC: "Mythic",
};

/** Same guild role emoji fallbacks as the signup embed. */
const ROLE_EMOJI_FALLBACK: Record<RoleDiscordEmojiKey, string> = {
  tank: "🛡",
  healer: "✚",
  dps: "⚔",
  lootbuddy: "📦",
  raidlead: "⭐",
};

const EMPTY_SELECTION = "No players selected yet.";

export type BuildRosterEmbedOptions = {
  classIndicators?: Partial<Record<WowClass, string>>;
  roleIndicators?: GuildRoleIndicators;
};

function roleEmoji(key: RoleDiscordEmojiKey, roleIndicators?: GuildRoleIndicators): string {
  return roleIndicators?.[key] ?? ROLE_EMOJI_FALLBACK[key];
}

/** `<@id> <:class:> — Character-Realm` (or `<:class:> — Character-Realm` when unlinked; `@name <:class:>` for an external booster). */
export function formatRosterParticipantLine(
  member: RosterEmbedMember,
  classIndicators?: Partial<Record<WowClass, string>>,
): string {
  const indicator = classIndicator(member.wowClass, null, classIndicators);
  if (member.external) {
    // Hand-added unregistered booster: `@name <class>` (plain text, never a ping).
    return [`@${member.userName}`, indicator].filter(Boolean).join(" ");
  }
  const character = characterLabel(member.characterName, member.characterRealm);
  const mention = member.discordUserId ? `<@${member.discordUserId}>` : null;

  const head = [mention, indicator].filter(Boolean).join(" ");
  return head ? `${head} — ${character}` : character;
}

function memberList(
  members: RosterEmbedMember[],
  classIndicators?: Partial<Record<WowClass, string>>,
  emptyValue: string = EMPTY_SELECTION,
): string {
  if (members.length === 0) return emptyValue;
  return members.map((member) => formatRosterParticipantLine(member, classIndicators)).join("\n");
}

/**
 * Selected lineup only — never the volunteered signup pool.
 * Tank/Healer/DPS/Lootbuddy targets come from the Run. Melee/ranged DPS stay a
 * display split of selected DPS (no melee/ranged target in the schema).
 * Role column icons match the signup embed (guild custom tank/healer/dps/lootbuddy).
 * Display-only: no buttons.
 */
export function buildRosterEmbed(data: RosterEmbedData, options?: BuildRosterEmbedOptions): EmbedBuilder {
  const classIndicators = options?.classIndicators;
  const roleIndicators = options?.roleIndicators;
  const tank = roleEmoji("tank", roleIndicators);
  const healer = roleEmoji("healer", roleIndicators);
  const dps = roleEmoji("dps", roleIndicators);
  const lootbuddy = roleEmoji("lootbuddy", roleIndicators);
  const dpsSelected =
    data.groups.meleeDps.length + data.groups.rangedDps.length + data.groups.unspecifiedDps.length;
  const emptyValue = data.totalSelected === 0 ? EMPTY_SELECTION : "—";
  const showLootbuddy = data.groups.lootbuddies.length > 0 || data.targets.lootbuddies > 0;
  const showUnspecifiedDps = data.groups.unspecifiedDps.length > 0;
  const lootbuddyCount =
    data.targets.lootbuddies > 0
      ? `${data.groups.lootbuddies.length}/${data.targets.lootbuddies}`
      : String(data.groups.lootbuddies.length);
  const stateLabel = data.publishedAt ? "Published" : "Draft";

  return new EmbedBuilder()
    .setTitle("Roster")
    .setDescription(
      `${data.runTitle}\n${DIFFICULTY_LABEL[data.difficulty]} · ${data.productLabel}\n${data.contentSummary}`,
    )
    .addFields(
      {
        name: `${tank} Tanks (${data.groups.tanks.length}/${data.targets.tanks})`,
        value: memberList(data.groups.tanks, classIndicators, emptyValue),
      },
      {
        name: `${healer} Healers (${data.groups.healers.length}/${data.targets.healers})`,
        value: memberList(data.groups.healers, classIndicators, emptyValue),
      },
      {
        name: `${dps} Melee DPS (${data.groups.meleeDps.length})`,
        value: memberList(data.groups.meleeDps, classIndicators, emptyValue),
      },
      {
        name: `${dps} Ranged DPS (${data.groups.rangedDps.length})`,
        value: memberList(data.groups.rangedDps, classIndicators, emptyValue),
      },
      ...(showUnspecifiedDps
        ? [
            {
              name: `${dps} DPS (unspecified) (${data.groups.unspecifiedDps.length})`,
              value: memberList(data.groups.unspecifiedDps, classIndicators, emptyValue),
            },
          ]
        : []),
      ...(showLootbuddy
        ? [
            {
              name: `${lootbuddy} Lootbuddies (${lootbuddyCount})`,
              value: memberList(data.groups.lootbuddies, classIndicators, emptyValue),
            },
          ]
        : []),
    )
    .setColor(data.publishedAt ? 0x2ecc71 : 0x3498db)
    .setFooter({
      text: `${stateLabel} · Selected ${data.totalSelected} · DPS ${dpsSelected}/${data.targets.dps} · Roster version ${data.version}`,
    });
}
