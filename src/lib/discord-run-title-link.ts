import { absoluteRunUrl } from "@/lib/app-url";
import { escapeDiscordInlineText } from "@/lib/run-start-message";

/**
 * First description line for persistent Signup/Roster embeds: the Run title
 * as a Discord markdown link to the canonical Run page when a public origin
 * is configured; otherwise the escaped plain title (no broken markdown).
 */
export function formatDiscordRunTitleLink(
  runTitle: string,
  runId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const label = escapeDiscordInlineText(runTitle);
  const url = absoluteRunUrl(runId, undefined, env);
  if (!url) return label;
  return `[${label}](${url})`;
}
