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
});
