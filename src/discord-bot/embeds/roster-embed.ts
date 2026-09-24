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
): string {
  if (members.length === 0) return "—";
  return members.map((member) => formatRosterParticipantLine(member, classIndicators)).join("\n");
}

/**
 * Final published roster only — selected Characters, never the full offer
 * set. Tank/Healer show a real target from the Run; melee/ranged DPS show a
 * count only because the Run schema has no melee/ranged split target.
 * Role column icons match the signup embed (guild custom tank/healer/dps/lootbuddy).
 */
export function buildRosterEmbed(data: RosterEmbedData, options?: BuildRosterEmbedOptions): EmbedBuilder {
  const classIndicators = options?.classIndicators;
  const roleIndicators = options?.roleIndicators;
  const tank = roleEmoji("tank", roleIndicators);
  const healer = roleEmoji("healer", roleIndicators);
  const dps = roleEmoji("dps", roleIndicators);
  const lootbuddy = roleEmoji("lootbuddy", roleIndicators);

  return new EmbedBuilder()
    .setTitle(`Roster for ${data.runTitle}`)
    .setDescription(`${DIFFICULTY_LABEL[data.difficulty]} · ${data.productLabel}\n${data.contentSummary}`)
    .addFields(
      {
        name: `${tank} Tanks (${data.groups.tanks.length}/${data.targets.tanks})`,
        value: memberList(data.groups.tanks, classIndicators),
      },
      {
        name: `${healer} Healers (${data.groups.healers.length}/${data.targets.healers})`,
        value: memberList(data.groups.healers, classIndicators),
      },
      {
        name: `${dps} Melee DPS (${data.groups.meleeDps.length})`,
        value: memberList(data.groups.meleeDps, classIndicators),
      },
      {
        name: `${dps} Ranged DPS (${data.groups.rangedDps.length})`,
        value: memberList(data.groups.rangedDps, classIndicators),
      },
      ...(data.groups.lootbuddies.length > 0
        ? [
            {
              name: `${lootbuddy} Lootbuddies (${data.groups.lootbuddies.length})`,
              value: memberList(data.groups.lootbuddies, classIndicators),
            },
          ]
        : []),
    )
    .setColor(0x2ecc71)
    .setFooter({ text: `Total selected: ${data.totalSelected} · Roster version ${data.version}` });
}
