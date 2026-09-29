import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Native modal dialogs are centered by ONE global rule (globals.css), not per-dialog
 * patches. Tailwind's preflight `margin: 0` would otherwise pin every showModal()
 * dialog to the top-left. Visual centering itself is checked in the browser.
 */

const SRC = path.resolve(__dirname, "..");
const globalsCss = readFileSync(path.join(SRC, "app", "globals.css"), "utf8");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith(".tsx") ? [full] : [];
  });
}

/** className of every native <dialog>, keyed by file (relative to src). */
function dialogClassNames() {
  const found: Array<{ file: string; className: string }> = [];
  for (const file of tsxFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/<dialog\b[^>]*?className="([^"]*)"/g)) {
      found.push({ file: path.relative(SRC, file).replaceAll("\\", "/"), className: match[1]! });
    }
  }
  return found;
}

describe("native dialog centering", () => {
  it("globals.css restores auto margins for modal dialogs inside @layer base", () => {
    const base = globalsCss.match(/@layer base\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(base).toMatch(/dialog:modal\s*\{\s*margin:\s*auto;\s*\}/);
  });

  it("every native dialog is found and none needs its own centering patch", () => {
    const dialogs = dialogClassNames();
    expect(dialogs.length).toBeGreaterThanOrEqual(29);
    for (const { file, className } of dialogs) {
      expect(className.split(/\s+/), file).not.toContain("m-auto");
      // A full-viewport width (`min(100%, …)`) leaves no room for the auto margins on
      // phones; every dialog keeps a gutter via calc(100vw-…) instead.
      expect(className, file).not.toContain("w-[min(100%");
    }
  });

  it("the intentionally top-anchored dialogs keep their own positioning (utilities beat the base rule)", () => {
    const custom = dialogClassNames().filter(({ className }) => className.split(/\s+/).includes("m-0"));
    expect(custom.map(({ file }) => file).sort()).toEqual([
      "components/characters/battle-net-import-dialog.tsx",
      "components/manage/roster-builder.tsx",
      "components/runs/signup-dialog.tsx",
    ]);
    for (const { className } of custom) {
      expect(className).toMatch(/\bfixed\b.*\bleft-1\/2\b/);
      expect(className).toContain("-translate-x-1/2");
    }
  });
});
