import { z } from "zod";
import { RUN_STATUSES } from "@/models/enums";
import { entityIdSchema } from "@/validators/ids";

export const manageRunFilterSchema = z.object({
  status: z.enum(RUN_STATUSES).optional(),
  raidLeadId: entityIdSchema.optional(),
  timeframe: z.enum(["upcoming", "past"]).optional(),
});

export type ManageRunFilterInput = z.infer<typeof manageRunFilterSchema>;

export function parseManageRunFilters(searchParams: {
  status?: string | string[];
  raidLeadId?: string | string[];
  timeframe?: string | string[];
}): ManageRunFilterInput {
  const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);
  const parsed = manageRunFilterSchema.safeParse({
    status: first(searchParams.status) || undefined,
    raidLeadId: first(searchParams.raidLeadId) || undefined,
    timeframe: first(searchParams.timeframe) || undefined,
  });
  return parsed.success ? parsed.data : {};
}
