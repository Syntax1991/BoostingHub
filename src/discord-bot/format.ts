/**
 * Presentation-only formatting for Discord embeds. Never re-derives domain
 * rules (eligibility, roles, difficulty labels) — those come from the Bot
 * API DTOs as-is.
 */

/** Discord renders <t:unix:F> as a localized full date/time in the viewer's own timezone. */
export function discordTimestamp(iso: string): string {
  const seconds = Math.floor(new Date(iso).getTime() / 1000);
  return `<t:${seconds}:F>`;
}

export function characterLabel(name: string, realm: string): string {
  return realm ? `${name}-${realm}` : name;
}

/** `<@id>` mentions the User; falls back to Character-Realm when no Discord id is linked. */
export function mentionOrCharacter(discordUserId: string | null, characterName: string, characterRealm: string): string {
  const character = characterLabel(characterName, characterRealm);
  return discordUserId ? `<@${discordUserId}> — ${character}` : character;
}

export function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
