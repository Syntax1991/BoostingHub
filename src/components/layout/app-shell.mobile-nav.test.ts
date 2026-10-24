import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getManagementNavItems } from "@/auth/authorization";

/**
 * Mobile navigation drawer regression guards.
 * Runtime open/close is covered in browser acceptance; these pin the wiring so
 * bottom-nav / duplicate route lists cannot silently return.
 */

const shell = readFileSync(path.resolve(__dirname, "app-shell.tsx"), "utf8");

function classNameContaining(source: string, marker: string): string {
  const match = [...source.matchAll(/className=(?:\{)?(?:cn\()?["'`]([^"'`]*?)["'`]/g)].find(([, value]) =>
    value!.includes(marker),
  );
  if (!match) {
    const plain = [...source.matchAll(/className="([^"]*)"/g)].find(([, value]) => value!.includes(marker));
    if (!plain) throw new Error(`no className containing "${marker}"`);
    return plain[1]!;
  }
  return match[1]!;
}

describe("AppShell mobile navigation drawer", () => {
  it("no longer renders the sticky mobile bottom navigation", () => {
    expect(shell).not.toMatch(/sticky bottom-0/);
    expect(shell).not.toMatch(/grid-cols-6/);
    expect(shell).not.toContain("border-t border-border bg-surface md:hidden");
  });

  it("renders a mobile-only menu toggle with accessible open/close state", () => {
    expect(shell).toContain('aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}');
    expect(shell).toContain("aria-expanded={mobileNavOpen}");
    expect(shell).toContain('aria-controls="mobile-navigation-drawer"');
    expect(shell).toContain("md:hidden");
    expect(shell).toMatch(/<Menu[\s\S]*aria-hidden/);
  });

  it("opens an off-canvas left drawer with backdrop, labeled dialog, and scrollable nav", () => {
    expect(shell).toContain('id="mobile-navigation-drawer"');
    expect(shell).toContain('role="dialog"');
    expect(shell).toContain('aria-modal="true"');
    expect(shell).toContain('aria-label="Close navigation menu"');
    expect(shell).toContain("bg-black/60");
    expect(shell).toContain("w-[min(85vw,20rem)]");
    expect(shell).toContain("overflow-y-auto");
    expect(shell).toContain("pt-[env(safe-area-inset-top)]");
    expect(shell).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(classNameContaining(shell, "fixed inset-0 z-40")).toContain("md:hidden");
  });

  it("closes on route selection, backdrop, Escape, and restores body scroll", () => {
    expect(shell).toContain("onClick={closeMobileNav}");
    expect(shell).toContain('if (event.key === "Escape") setMobileNavOpen(false)');
    expect(shell).toContain('document.body.style.overflow = "hidden"');
    expect(shell).toContain("document.body.style.overflow = previousOverflow");
    expect(shell).toMatch(/setMobileNavOpen\(false\);\r?\n\s*\}, \[pathname\]/);
  });

  it("reuses one primary NAV list and authorization management filtering", () => {
    const navBlocks = shell.match(/const NAV = \[/g) ?? [];
    expect(navBlocks).toHaveLength(1);
    expect(shell).toContain("getManagementNavItems(user.accountRole)");
    expect(shell).toContain("canAccessManagement(user.accountRole)");
    // No second hard-coded manage href array for mobile.
    expect(shell).not.toMatch(/const MOBILE_NAV\s*=/);
    expect(shell).not.toMatch(/const MANAGEMENT_NAV\s*=/);
  });

  it("groups Main and Management in the drawer without inventing routes", () => {
    expect(shell).toMatch(/uppercase tracking-wide text-muted">\s*Main\s*</);
    expect(shell).toMatch(/Management\s*</);
    const primaryHrefs = [...shell.matchAll(/\{ href: "(\/[^"]+)", label:/g)].map((m) => m[1]);
    expect(primaryHrefs).toEqual([
      "/dashboard",
      "/runs",
      "/my-runs",
      "/characters",
      "/profile",
      "/settings",
    ]);
    expect(getManagementNavItems("USER")).toEqual([]);
    expect(getManagementNavItems("RAID_LEAD").map((i) => i.href)).toEqual([
      "/manage",
      "/manage/runs",
      "/manage/schedule",
    ]);
    expect(getManagementNavItems("ADMIN").some((i) => i.href === "/manage/raid-catalog")).toBe(true);
  });

  it("keeps desktop SideNav architecture (md+ aside) unchanged", () => {
    expect(shell).toContain("hidden w-60 shrink-0 border-r border-border bg-surface md:flex md:flex-col");
    expect(shell).toContain('aria-label="Primary"');
  });

  it("marks active routes with aria-current and visible active styling", () => {
    expect(shell).toContain('aria-current={active ? "page" : undefined}');
    expect(shell).toContain("bg-accent/15 text-accent");
    expect(shell).toContain("min-h-11");
  });
});
