/**
 * Discord native timestamp — Discord localizes per viewer.
 * Prefer this for personal DMs and shared posts over server-side User timezones.
 */
export function discordTimestamp(iso: string, style: "F" | "f" | "R" | "t" | "T" | "d" | "D" = "F"): string {
  const unix = Math.floor(new Date(iso).getTime() / 1000);
  if (!Number.isFinite(unix)) {
    return iso;
  }
  return `<t:${unix}:${style}>`;
}
