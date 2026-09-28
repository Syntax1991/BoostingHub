/** Discord epoch (2015-01-01T00:00:00.000Z) in Unix milliseconds. */
const DISCORD_EPOCH_MS = BigInt(1_420_070_400_000);

/**
 * Smallest Discord snowflake at the given instant. Snowflakes are ordered by
 * creation time, so `after=<this id>` returns every message created at or
 * after `at` — a lossless starting point for a history scan.
 */
export function snowflakeAtTime(at: Date | number): string {
  const ms = BigInt(typeof at === "number" ? at : at.getTime());
  const sinceEpoch = ms > DISCORD_EPOCH_MS ? ms - DISCORD_EPOCH_MS : BigInt(0);
  return (sinceEpoch << BigInt(22)).toString();
}

export function isSnowflake(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,25}$/.test(value);
}

/** Numeric comparison of two snowflakes (string comparison is wrong across lengths). */
export function compareSnowflakes(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
