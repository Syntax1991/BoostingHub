export const DEFAULT_TIME_ZONE = "Europe/Berlin";

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Node and the browser disagree on some `en-GB` month names (`Sept` vs `Sep`).
 * Assemble display strings from numeric `formatToParts` so SSR and client hydration match.
 */
function zonedParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    hour12: false,
  }).formatToParts(value);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    weekday: read("weekday"),
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour: Number(read("hour")),
    minute: Number(read("minute")),
  };
}

/**
 * Persist and compare instants in UTC. Format only at the presentation boundary.
 */
export function toUtcIso(value: Date | string): string {
  return asDate(value).toISOString();
}

export function formatDate(value: Date | string, timeZone = DEFAULT_TIME_ZONE): string {
  const parts = zonedParts(asDate(value), timeZone);
  return `${parts.weekday} ${pad(parts.day)}/${pad(parts.month)}/${parts.year}`;
}

export function formatTime(value: Date | string, timeZone = DEFAULT_TIME_ZONE): string {
  const parts = zonedParts(asDate(value), timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatDateTime(value: Date | string, timeZone = DEFAULT_TIME_ZONE): string {
  return `${formatDate(value, timeZone)} ${formatTime(value, timeZone)}`;
}

export function formatRelative(value: Date | string, now = new Date()): string {
  const diffMs = asDate(value).getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / 60_000);
  const absMinutes = Math.abs(diffMinutes);

  if (absMinutes < 60) {
    return diffMinutes >= 0 ? `in ${absMinutes}m` : `${absMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 48) {
    return diffHours >= 0 ? `in ${diffHours}h` : `${Math.abs(diffHours)}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return diffDays >= 0 ? `in ${diffDays}d` : `${Math.abs(diffDays)}d ago`;
}

/**
 * `datetime-local` wall time in the default operations timezone, for form values.
 */
export function toDatetimeLocalValue(value: Date | string, timeZone = DEFAULT_TIME_ZONE): string {
  const parts = zonedParts(asDate(value), timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * Interpret a `YYYY-MM-DDTHH:mm` string as wall time in `timeZone` and return UTC ISO.
 */
export function fromDatetimeLocalValue(local: string, timeZone = DEFAULT_TIME_ZONE): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!match) {
    throw new RangeError("Invalid datetime-local value.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0);

  let guess = desiredUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(guess), timeZone);
    const asZone = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    const delta = desiredUtc - asZone;
    if (delta === 0) {
      break;
    }
    guess += delta;
  }

  return new Date(guess).toISOString();
}

/**
 * WoW lockouts are weekly. EU historically resets Wednesday 07:00 UTC;
 * the identifier is the ISO week of that reset, not a boolean on the character.
 */
export function resetIdentifierFor(instant: Date | string = new Date()): string {
  const date = asDate(instant);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
