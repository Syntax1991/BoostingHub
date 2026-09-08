import { z } from "zod";

/**
 * Seeded run/character IDs are UUID-shaped but may use a type prefix
 * (`r` for runs, `c` for characters) in the first nibble. Strict RFC UUID
 * parsing would reject those operational IDs.
 */
export const entityIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[0-9a-zA-Z][0-9a-zA-Z-]*$/, "Invalid id");
