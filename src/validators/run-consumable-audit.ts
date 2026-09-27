import { z } from "zod";
import { WARCRAFT_LOGS_REPORT_CODE, parseWarcraftLogsReportCode } from "@/lib/warcraft-logs";
import { entityIdSchema } from "@/validators/ids";

export { parseWarcraftLogsReportCode };

const reportInputSchema = z
  .string()
  .trim()
  .min(1, "Enter a Warcraft Logs report link or report code.")
  .max(300)
  .transform((value, ctx) => {
    const code = parseWarcraftLogsReportCode(value);
    if (!code) {
      ctx.addIssue({ code: "custom", message: "Enter a Warcraft Logs report link or report code." });
      return z.NEVER;
    }
    return code;
  });

export const runIdInputSchema = z.object({ runId: entityIdSchema });

export const attachRunWarcraftLogsReportSchema = z.object({
  runId: entityIdSchema,
  report: reportInputSchema,
});

export const detachRunWarcraftLogsReportSchema = z.object({
  runId: entityIdSchema,
  reportCode: z.string().regex(WARCRAFT_LOGS_REPORT_CODE, "Invalid report code."),
});

export const decideRunWarcraftLogsFightSchema = z.object({
  runId: entityIdSchema,
  fightId: entityIdSchema,
  assign: z.boolean(),
});
