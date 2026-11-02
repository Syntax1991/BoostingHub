import { describe, expect, it } from "vitest";
import {
  DISCORD_EMBED_FIELD_VALUE_LIMIT,
  chunkEmbedFieldLines,
} from "@/lib/discord-embed-field-chunking";

describe("chunkEmbedFieldLines", () => {
  it("returns one empty chunk for empty input", () => {
    expect(chunkEmbedFieldLines([])).toEqual([[]]);
  });

  it("throws when a single line exceeds the limit", () => {
    const line = "x".repeat(DISCORD_EMBED_FIELD_VALUE_LIMIT + 1);
    expect(() => chunkEmbedFieldLines([line])).toThrow(/exceeds Discord field limit/);
  });

  it("never splits a line, never drops lines, and keeps order", () => {
    const lines = Array.from({ length: 80 }, (_, index) => `<@${100000000000000000 + index}> <:mage:1549226600000000125>`);
    const chunks = chunkEmbedFieldLines(lines);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(lines);
    for (const chunk of chunks) expect(chunk.join("\n").length).toBeLessThanOrEqual(DISCORD_EMBED_FIELD_VALUE_LIMIT);
  });
});
