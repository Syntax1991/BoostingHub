import { EmbedBuilder } from "discord.js";
import type { RosterEmbedData, RosterEmbedMember } from "@/services/discord-sync.service";
import { mentionOrCharacter } from "@/discord-bot/format";

const DIFFICULTY_LABEL: Record<RosterEmbedData["difficulty"], string> = {
  NORMAL: "Normal",
  HEROIC: "Heroic",
  MYTHIC: "Mythic",
};

function memberList(members: RosterEmbedMember[]): string {
  if (members.length === 0) return "—";
  return members.map((member) => mentionOrCharacter(member.discordUserId, member.characterName, member.characterRealm)).join("\n");
}

/**
 * Final published roster only — selected Characters, never the full offer
 * set. Tank/Healer show a real target from the Run; melee/ranged DPS show a
 * count only because the Run schema has no melee/ranged split target.
 */
export function buildRosterEmbed(data: RosterEmbedData): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`Roster for ${data.runTitle}`)
    .setDescription(`${DIFFICULTY_LABEL[data.difficulty]} · ${data.raidName}`)
    .addFields(
      { name: `🛡 Tanks (${data.groups.tanks.length}/${data.targets.tanks})`, value: memberList(data.groups.tanks) },
      { name: `♻ Healers (${data.groups.healers.length}/${data.targets.healers})`, value: memberList(data.groups.healers) },
      { name: `⚔ Melee DPS (${data.groups.meleeDps.length})`, value: memberList(data.groups.meleeDps) },
      { name: `🏹 Ranged DPS (${data.groups.rangedDps.length})`, value: memberList(data.groups.rangedDps) },
      ...(data.groups.lootbuddies.length > 0
        ? [{ name: `💰 Lootbuddies (${data.groups.lootbuddies.length})`, value: memberList(data.groups.lootbuddies) }]
        : []),
    )
    .setColor(0x2ecc71)
    .setFooter({ text: `Total selected: ${data.totalSelected} · Roster version ${data.version}` });
}
