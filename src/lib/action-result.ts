import { isDomainError } from "@/lib/errors";
import { ZodError } from "zod";

export type ActionResult =
  | { ok: true; message: string; runId?: string }
  | { ok: false; code: string; message: string };

export function mapActionError(error: unknown): { ok: false; code: string; message: string } {
  if (error instanceof ZodError) {
    return { ok: false, code: "VALIDATION_FAILED", message: error.issues[0]?.message ?? "Check the form and try again." };
  }
  if (isDomainError(error)) {
    return { ok: false, code: error.code, message: error.message };
  }
  return { ok: false, code: "UNEXPECTED", message: "Something went wrong. Try again." };
}
