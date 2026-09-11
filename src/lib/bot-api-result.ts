import { NextResponse } from "next/server";
import { isDomainError } from "@/lib/errors";

/** Consistent JSON envelope for the Discord Bot API — a plain HTTP surface, not Server Actions. */
export function botApiOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function botApiError(error: unknown): NextResponse {
  if (isDomainError(error)) {
    return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof Error && error.name === "ZodError") {
    return NextResponse.json({ ok: false, code: "VALIDATION_FAILED", message: "Invalid request." }, { status: 400 });
  }
  return NextResponse.json({ ok: false, code: "UNEXPECTED", message: "Something went wrong." }, { status: 500 });
}
