import { describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() => vi.fn(() => {
  throw new Error("NEXT_REDIRECT");
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

describe("GET /manage/runs/create-many (legacy route)", () => {
  it("redirects to the canonical /manage/runs/create workflow instead of rendering a second form", async () => {
    const { default: CreateManyRunsRedirectPage } = await import("./page");
    expect(() => CreateManyRunsRedirectPage()).toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/manage/runs/create");
    expect(redirectMock).toHaveBeenCalledTimes(1);
  });
});
