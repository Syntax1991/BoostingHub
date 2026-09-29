import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Narrow-screen (≈360–390 px) layout guards. The runtime scrollWidth checks in a
 * browser are the real acceptance; these pin the class decisions that fixed it so a
 * later edit cannot silently bring the page-wide horizontal overflow back.
 */

const SRC = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(SRC, file), "utf8");

/** className of the first element whose classes contain `marker`. */
function classNameContaining(source: string, marker: string): string {
  const match = [...source.matchAll(/className="([^"]*)"/g)].find(([, value]) => value!.includes(marker));
  if (!match) throw new Error(`no className containing "${marker}"`);
  return match[1]!;
}

describe("AppShell mobile header", () => {
  const shell = read("components/layout/app-shell.tsx");

  it("keeps the name / role text out of the phone header row but readable for screen readers", () => {
    // It was the element that pushed the header — and with it the whole page — past 390 px.
    const identity = classNameContaining(shell, "sm:not-sr-only");
    expect(identity.split(/\s+/)).toEqual(expect.arrayContaining(["sr-only", "sm:not-sr-only"]));
    expect(identity).not.toMatch(/\bhidden\b/); // never display:none — still announced below sm
  });

  it("lets the right-hand header cluster shrink instead of widening the page", () => {
    expect(classNameContaining(shell, "ml-auto flex")).toContain("min-w-0");
  });

  it("fixes the header itself instead of hiding the overflow on html / body / the header", () => {
    for (const file of ["app/globals.css", "app/layout.tsx"]) {
      expect(read(file), file).not.toMatch(/overflow-x-hidden|overflow-x:\s*hidden/);
    }
    const header = shell.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(header).toContain("Sign out");
    expect(header).not.toContain("overflow-x-hidden");
  });

  it("gives the mobile bottom navigation one column per entry, so none wraps to a second row", () => {
    const entries = (shell.match(/const NAV = \[([\s\S]*?)\];/)?.[1].match(/\{ href:/g) ?? []).length;
    expect(entries).toBeGreaterThan(0);
    expect(classNameContaining(shell, "border-t border-border bg-surface md:hidden")).toContain(`grid-cols-${entries}`);
  });
});

describe("notification popup", () => {
  const bell = read("components/notifications/notification-bell.tsx");
  const panel = classNameContaining(bell, "z-40");
  const classes = panel.split(/\s+/);

  it("spans the page width minus a gutter below sm, so it cannot run off the left edge", () => {
    // The wrapper only becomes the positioning anchor from sm up.
    expect(classNameContaining(bell, "relative").split(/\s+/)).toContain("sm:relative");
    expect(classNameContaining(bell, "relative").split(/\s+/)).not.toContain("relative");
    expect(classes).toEqual(expect.arrayContaining(["absolute", "inset-x-3"]));
  });

  it("keeps the desktop dropdown right-anchored to the bell with its original width", () => {
    expect(classes).toEqual(
      expect.arrayContaining([
        "sm:inset-x-auto",
        "sm:right-0",
        "sm:w-[min(22rem,calc(100vw-1.5rem))]",
        "sm:max-w-[calc(100vw-1.5rem)]",
      ]),
    );
  });
});

describe("Characters table", () => {
  const view = read("components/characters/characters-view.tsx");

  it("stays wide and scrolls inside its own overflow-x-auto wrapper", () => {
    const table = view.match(/<div className="([^"]*overflow-x-auto[^"]*)">\s*<table className="([^"]*)"/);
    expect(table, "overflow-x-auto wrapper directly around the table").toBeTruthy();
    expect(table![2]).toContain("min-w-[1180px]");
  });
});
