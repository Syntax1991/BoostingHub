/** Discord embed field value hard limit. */
export const DISCORD_EMBED_FIELD_VALUE_LIMIT = 1024;

/** Discord embed field count hard limit. */
export const DISCORD_EMBED_FIELD_COUNT_LIMIT = 25;

/**
 * Chunk participant lines into Embed-field-sized groups without splitting a line
 * or silently dropping anyone. Empty input yields one empty chunk (caller may
 * replace with a placeholder).
 */
export function chunkEmbedFieldLines(
  lines: string[],
  limit: number = DISCORD_EMBED_FIELD_VALUE_LIMIT,
): string[][] {
  if (lines.length === 0) return [[]];

  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const line of lines) {
    if (line.length > limit) {
      throw new Error(
        `Single embed participant line exceeds Discord field limit (${line.length} > ${limit}).`,
      );
    }
    const separator = current.length > 0 ? 1 : 0;
    if (current.length > 0 && currentLen + separator + line.length > limit) {
      chunks.push(current);
      current = [line];
      currentLen = line.length;
      continue;
    }
    current.push(line);
    currentLen += separator + line.length;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}
