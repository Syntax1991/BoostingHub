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

  it("exposes a mobile menu control instead of a multi-column bottom bar", () => {
    expect(shell).toContain("Open navigation menu");
    expect(shell).not.toMatch(/grid-cols-\d+/);
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

describe("mobile navigation drawer", () => {
  it("replaces the bottom bar with a fixed left drawer that does not stay in the page flow", () => {
    const shell = read("components/layout/app-shell.tsx");
    expect(shell).not.toMatch(/sticky bottom-0/);
    expect(shell).toContain("fixed inset-0 z-40 md:hidden");
    expect(shell).toContain("w-[min(85vw,20rem)]");
  });
});

describe("form controls inside narrow dialogs", () => {
  it("never widen their container: globals.css caps select / textarea / input width in @layer base", () => {
    // A long option (Run label) or a number input's intrinsic width otherwise sized the
    // dialogs' grid labels and made Create Schedule scroll sideways on phones.
    const base = read("app/globals.css").match(/@layer base\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const rule = base.match(/select,\s*textarea,\s*input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)\s*\{([^}]*)\}/);
    expect(rule, "form-control rule in @layer base").toBeTruthy();
    expect(rule![1]).toMatch(/min-width:\s*0;/);
    expect(rule![1]).toMatch(/max-width:\s*100%;/);
  });
});

describe("Attendance table", () => {
  it("contains its absolutely positioned sr-only labels, so they cannot widen the page", () => {
    const section = read("components/runs/run-attendance-section.tsx");
    expect(section).toContain('className="sr-only"');
    const table = section.match(/<div className="([^"]*overflow-x-auto[^"]*)">\s*<table className="([^"]*)"/);
    expect(table, "overflow-x-auto wrapper directly around the table").toBeTruthy();
    expect(table![1].split(/\s+/)).toContain("relative");
  });
});
