import { ExternalLink } from "lucide-react";
import { getWarcraftLogsCharacterUrl } from "@/lib/warcraft-logs";

/**
 * Informational outbound Warcraft Logs profile link.
 * Renders nothing when the character has no usable `warcraftLogsId`.
 */
export function WarcraftLogsLink({
  warcraftLogsId,
  label = "WCL",
  className = "inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-surface-raised",
}: {
  warcraftLogsId: string | null | undefined;
  label?: string;
  className?: string;
}) {
  const url = getWarcraftLogsCharacterUrl(warcraftLogsId);
  if (!url) {
    return null;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label={`${label} (opens in new tab)`}
    >
      <span>{label}</span>
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}
