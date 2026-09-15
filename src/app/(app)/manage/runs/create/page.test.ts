import { describe, expect, it, vi } from "vitest";
import { runCreatePath, RUN_CREATE_PATH } from "@/lib/run-routes";

const redirectMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
);

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

describe("run create path helpers", () => {
  it("exposes the canonical /runs/create path", () => {
    expect(RUN_CREATE_PATH).toBe("/runs/create");
    expect(runCreatePath()).toBe("/runs/create");
  });
});

describe("GET /manage/runs/create (legacy route)", () => {
  it("redirects to /runs/create without rendering a form", async () => {
    redirectMock.mockClear();
    const { default: LegacyCreateRunsRedirectPage } = await import("./page");
    expect(() => LegacyCreateRunsRedirectPage()).toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/runs/create");
    expect(redirectMock).toHaveBeenCalledTimes(1);
  });
});
