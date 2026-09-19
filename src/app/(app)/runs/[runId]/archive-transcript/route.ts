import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { canManageRun } from "@/auth/authorization";
import { requireUser } from "@/auth/session";
import { isDomainError } from "@/lib/errors";
import { runRepository } from "@/repositories/run.repository";
import { discordSyncService } from "@/services/discord-sync.service";

/**
 * GET /runs/:runId/archive-transcript
 *
 * Manager download of the persisted Discord channel HTML transcript.
 * Authorization mirrors run management — not a public participant surface.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireUser();
    const { runId } = await params;
    const run = await runRepository.findById(runId);
    if (!run || !canManageRun(user, run)) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND", message: "Run was not found." }, { status: 404 });
    }

    const transcript = await discordSyncService.getArchiveTranscriptForDownload(runId);
    if (!transcript) {
      return NextResponse.json(
        { ok: false, code: "NOT_FOUND", message: "Archive transcript is not available yet." },
        { status: 404 },
      );
    }

    return new NextResponse(transcript.html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `attachment; filename="${transcript.filename.replace(/"/g, "")}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    if (isDomainError(error)) {
      return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, code: "UNEXPECTED", message: "Something went wrong." }, { status: 500 });
  }
}
