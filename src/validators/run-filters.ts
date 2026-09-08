import { z } from "zod";
import { RAID_DIFFICULTIES, RUN_STATUSES } from "@/models/enums";

export const runFilterSchema = z.object({
  difficulty: z.enum(RAID_DIFFICULTIES).optional(),
  status: z.enum(RUN_STATUSES).optional(),
});

export type RunFilterInput = z.infer<typeof runFilterSchema>;

export function parseRunFilters(searchParams: {
  difficulty?: string | string[];
  status?: string | string[];
}): RunFilterInput {
  const difficulty = Array.isArray(searchParams.difficulty)
    ? searchParams.difficulty[0]
    : searchParams.difficulty;
  const status = Array.isArray(searchParams.status)
    ? searchParams.status[0]
    : searchParams.status;

  const parsed = runFilterSchema.safeParse({
    difficulty: difficulty || undefined,
    status: status || undefined,
  });

  return parsed.success ? parsed.data : {};
}

export const devLoginSchema = z.object({
  userId: z.string().uuid(),
});
