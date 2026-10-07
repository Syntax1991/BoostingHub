import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UserAccessDialog } from "@/components/manage/user-access-dialog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

describe("UserAccessDialog", () => {
  it("renders Access trigger and read-only Character role context", () => {
    const html = renderToStaticMarkup(
      createElement(UserAccessDialog, {
        userId: "u1",
        userName: "Areson",
        accountRole: "ADMIN",
        isBooster: true,
        characterRoles: ["HEALER", "RANGED_DPS"],
      }),
    );
    expect(html).toContain("Access");
    expect(html).toContain('aria-label="Manage access for Areson"');
    expect(html).toContain("Boosting Roles");
    expect(html).toContain("Healer");
    expect(html).toContain("Ranged DPS");
    expect(html).toContain("Read-only from active Characters");
  });

  it("renders Access trigger for OWNER (protection enforced inside dialog)", () => {
    const html = renderToStaticMarkup(
      createElement(UserAccessDialog, {
        userId: "owner",
        userName: "Platform Owner",
        accountRole: "OWNER",
        isBooster: true,
        characterRoles: [],
      }),
    );
    expect(html).toContain("Access");
    expect(html).toContain('aria-label="Manage access for Platform Owner"');
  });
});
