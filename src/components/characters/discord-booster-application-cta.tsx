export function DiscordBoosterApplicationCta({
  discordTicketUrl,
}: {
  discordTicketUrl: string | null;
}) {
  return (
    <div className="max-w-xs text-right text-xs text-muted">
      <p>Booster applications are reviewed through Discord.</p>
      {discordTicketUrl ? (
        <a
          href={discordTicketUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-sm text-accent hover:underline"
        >
          Open Discord Ticket
        </a>
      ) : (
        <p className="mt-1">Contact staff in Discord to apply.</p>
      )}
    </div>
  );
}
