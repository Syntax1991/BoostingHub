import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findRun: vi.fn(),
  getTranscript: vi.fn(),
}));

vi.mock("@/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/repositories/run.repository", () => ({ runRepository: { findById: mocks.findRun } }));
vi.mock("@/services/discord-sync.service", () => ({
  discordSyncService: { getArchiveTranscriptForDownload: mocks.getTranscript },
}));

import { GET } from "@/app/(app)/runs/[runId]/archive-transcript/route";

const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const LEAD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";

function user(id: string, accountRole: AuthenticatedUser["accountRole"]): AuthenticatedUser {
  return { id, accountRole, accountStatus: "ACTIVE", name: "Test User", image: null } as AuthenticatedUser;
}

function download() {
  return GET(new NextRequest(`http://app.test/runs/${RUN_ID}/archive-transcript`), {
    params: Promise.resolve({ runId: RUN_ID }),
  });
}

beforeEach(() => {
  mocks.findRun.mockResolvedValue({ id: RUN_ID, raidLeadId: LEAD_ID });
  mocks.getTranscript.mockResolvedValue({ html: "<html>log</html>", filename: 'run"1.html' });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("GET /runs/:runId/archive-transcript", () => {
  it("hides the transcript from a user who cannot manage the run", async () => {
    mocks.requireUser.mockResolvedValue(user("aaaaaaaa-aaaa-4aaa-8aaa-000000000003", "USER"));

    const response = await download();

    expect(response.status).toBe(404);
    expect(mocks.getTranscript).not.toHaveBeenCalled();
  });

  it("answers 404 for a run that does not exist", async () => {
    mocks.requireUser.mockResolvedValue(user(LEAD_ID, "ADMIN"));
    mocks.findRun.mockResolvedValue(null);

    expect((await download()).status).toBe(404);
    expect(mocks.getTranscript).not.toHaveBeenCalled();
  });

  it("answers 404 with its own message while the transcript is missing", async () => {
    mocks.requireUser.mockResolvedValue(user(LEAD_ID, "ADMIN"));
    mocks.getTranscript.mockResolvedValue(null);

    const response = await download();

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ message: "Archive transcript is not available yet." });
  });

  it("sends the transcript to a manager as a private attachment", async () => {
    mocks.requireUser.mockResolvedValue(user(LEAD_ID, "ADMIN"));

    const response = await download();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>log</html>");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="run1.html"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
