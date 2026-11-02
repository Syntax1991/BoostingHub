import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
);

const requireUserOrRedirectMock = vi.hoisted(() => vi.fn());
const getCreateManyFormMock = vi.hoisted(() => vi.fn());
const listRunsMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

vi.mock("@/auth/session", () => ({
  requireUserOrRedirect: requireUserOrRedirectMock,
  requireManagerOrRedirect: vi.fn(),
  requireAdminOrRedirect: vi.fn(),
}));

vi.mock("@/services/run.service", () => ({
  runService: {
    getCreateManyForm: getCreateManyFormMock,
    listRuns: listRunsMock,
  },
}));

vi.mock("@/services/run-detail.service", () => ({
  runDetailService: { getRunDetail: vi.fn() },
}));

function user(role: AuthenticatedUser["accountRole"]): AuthenticatedUser {
  return {
    id: `user-${role.toLowerCase()}`,
    name: role,
    email: null,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole: role,
    accountStatus: "ACTIVE",
  };
}

describe("runController.getCreateRunsPage", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    requireUserOrRedirectMock.mockReset();
    getCreateManyFormMock.mockReset();
  });

  it("allows RAID_LEAD and loads the create form with login returnTo /runs/create", async () => {
    const lead = user("RAID_LEAD");
    requireUserOrRedirectMock.mockResolvedValue(lead);
    getCreateManyFormMock.mockResolvedValue({ raids: [], templates: [], maxRuns: 25 });
    const { runController } = await import("@/controllers/app.controller");
    const form = await runController.getCreateRunsPage();
    expect(requireUserOrRedirectMock).toHaveBeenCalledWith("/runs/create");
    expect(getCreateManyFormMock).toHaveBeenCalledWith(lead);
    expect(form).toEqual({ raids: [], templates: [], maxRuns: 25 });
  });

  it("allows ADMIN", async () => {
    const admin = user("ADMIN");
    requireUserOrRedirectMock.mockResolvedValue(admin);
    getCreateManyFormMock.mockResolvedValue({ raids: [] });
    const { runController } = await import("@/controllers/app.controller");
    await runController.getCreateRunsPage();
    expect(getCreateManyFormMock).toHaveBeenCalledWith(admin);
  });

  it("redirects USER to /dashboard", async () => {
    requireUserOrRedirectMock.mockResolvedValue(user("USER"));
    const { runController } = await import("@/controllers/app.controller");
    await expect(runController.getCreateRunsPage()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(getCreateManyFormMock).not.toHaveBeenCalled();
  });
});

describe("runController.getRunsPage canCreate", () => {
  beforeEach(() => {
    requireUserOrRedirectMock.mockReset();
    listRunsMock.mockReset();
    listRunsMock.mockResolvedValue([]);
  });

  it("sets canCreate for RAID_LEAD and ADMIN, not USER", async () => {
    const { runController } = await import("@/controllers/app.controller");

    requireUserOrRedirectMock.mockResolvedValue(user("RAID_LEAD"));
    expect((await runController.getRunsPage({})).canCreate).toBe(true);

    requireUserOrRedirectMock.mockResolvedValue(user("ADMIN"));
    expect((await runController.getRunsPage({})).canCreate).toBe(true);

    requireUserOrRedirectMock.mockResolvedValue(user("USER"));
    expect((await runController.getRunsPage({})).canCreate).toBe(false);
  });
});
