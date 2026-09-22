import { DEFAULT_TIME_ZONE } from "@/lib/datetime";

/**
 * Platform-supported IANA timezone validation. Rejects arbitrary offsets
 * like "UTC+2" and unknown zone ids.
 */
export function isValidIanaTimeZone(timeZone: string): boolean {
  const trimmed = timeZone.trim();
  if (!trimmed) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Prefer `Intl.supportedValuesOf("timeZone")`. Always includes Europe/Berlin.
 */
export function listIanaTimeZones(): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  const zones = new Set<string>(supported.length > 0 ? supported : [DEFAULT_TIME_ZONE]);
  zones.add(DEFAULT_TIME_ZONE);
  return [...zones].sort((a, b) => a.localeCompare(b));
}

export function normalizeTimeZone(timeZone: string | null | undefined): string {
  if (timeZone && isValidIanaTimeZone(timeZone)) {
    return timeZone.trim();
  }
  return DEFAULT_TIME_ZONE;
}
