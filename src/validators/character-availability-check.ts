import { z } from "zod";
import { fromDatetimeLocalValue, toUtcIso } from "@/lib/datetime";

/**
 * Availability Check proposed start.
 * Accepts UTC ISO or datetime-local wall time (Europe/Berlin via fromDatetimeLocalValue).
 * Rejects clearly historical past instants (minute-precision form values may be slightly behind now).
 */
export const availabilityCheckAtSchema = z
  .string()
  .trim()
  .min(1, "Choose a date and time.")
  .transform((value, ctx) => {
    let iso: string;
    try {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
        iso = fromDatetimeLocalValue(value);
      } else if (!Number.isNaN(Date.parse(value))) {
        iso = toUtcIso(value);
      } else {
        ctx.addIssue({ code: "custom", message: "Enter a valid date and time." });
        return z.NEVER;
      }
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a valid date and time." });
      return z.NEVER;
    }

    const parsed = Date.parse(iso);
    // Allow up to one minute behind wall-clock for datetime-local minute truncation.
    if (parsed < Date.now() - 60_000) {
      ctx.addIssue({ code: "custom", message: "Choose a current or future time." });
      return z.NEVER;
    }
    return iso;
  });

export function parseAvailabilityCheckAt(
  value: string | string[] | undefined | null,
): { ok: true; checkAt: string } | { ok: false; error: string } | { ok: true; checkAt: null } {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null || String(raw).trim() === "") {
    return { ok: true, checkAt: null };
  }
  const parsed = availabilityCheckAtSchema.safeParse(String(raw));
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid date and time.",
    };
  }
  return { ok: true, checkAt: parsed.data };
}
