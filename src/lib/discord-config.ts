/**
 * Central Discord destination links. Public URLs only — never secrets.
 * Booster applications are reviewed in Discord; BoostingHub remains the
 * authoritative qualification store.
 */
export function getDiscordBoosterTicketUrl(): string | null {
  const value = process.env.DISCORD_BOOSTER_TICKET_URL?.trim();
  return value && value.length > 0 ? value : null;
}
