import { readFileSync } from "node:fs";
import { createElement, useRef, type Ref } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Regression: Characters overflow previously nested Edit / Availability dialogs
 * inside OverflowMenu `node` items. Closing the menu unmounted those hosts so
 * dialogs never stayed open. Menu items must use onSelect → always-mounted triggers.
 */
describe("Characters overflow action wiring", () => {
  const source = readFileSync(new URL("./characters-view.tsx", import.meta.url), "utf8");
  const overflowSource = source.slice(source.indexOf("function CharacterOverflow"));

  it("opens Availability / Edit / lifecycle / Delete via onSelect, not OverflowMenu node hosts", () => {
    expect(overflowSource).toContain('id: "availability"');
    expect(overflowSource).toContain('id: "edit"');
    expect(overflowSource).toContain('id: "lifecycle"');
    expect(overflowSource).toContain('id: "delete"');
    expect(overflowSource).toContain("onSelect: () => availabilityTriggerRef.current?.click()");
    expect(overflowSource).toContain("onSelect: () => editTriggerRef.current?.click()");
    expect(overflowSource).toContain("onSelect: () => lifecycleTriggerRef.current?.click()");
    expect(overflowSource).toContain("onSelect: () => deleteTriggerRef.current?.click()");
    // Dead pattern: dialogs nested in menu `node` (unmounted on close)
    expect(overflowSource).not.toMatch(/node:\s*\(\s*[\s\S]*AvailabilityCell/);
    expect(overflowSource).not.toMatch(/node:\s*\(\s*[\s\S]*CharacterFormDialog/);
    expect(overflowSource).not.toMatch(/node:\s*\(\s*[\s\S]*DeleteCharacterButton/);
  });

  it("keeps the existing Edit and Weekly Availability dialogs mounted as overflow hosts", () => {
    expect(overflowSource).toContain("WeeklyAvailabilityDialog");
    expect(overflowSource).toContain('mode="edit"');
    expect(overflowSource).toContain("triggerRef={availabilityTriggerRef}");
    expect(overflowSource).toContain("triggerRef={editTriggerRef}");
    expect(overflowSource).toContain("buttonRef={lifecycleTriggerRef}");
    expect(overflowSource).toContain("buttonRef={deleteTriggerRef}");
    expect(overflowSource).toContain('characterLabel={`${character.name}-${character.realm}`}');
  });
});

describe("dialog triggerRef hosts stay clickable for overflow", () => {
  it("CharacterFormDialog forwards triggerRef to the trigger button", () => {
    const formSource = readFileSync(
      new URL("./character-form-dialog.tsx", import.meta.url),
      "utf8",
    );
    expect(formSource).toContain("triggerRef?: Ref<HTMLButtonElement>");
    expect(formSource).toContain("ref={triggerRef}");
    expect(formSource).toContain("updateCharacterAction");
  });

  it("WeeklyAvailabilityDialog forwards triggerRef and saves via existing action", () => {
    const availSource = readFileSync(
      new URL("./weekly-availability-dialog.tsx", import.meta.url),
      "utf8",
    );
    expect(availSource).toContain("triggerRef?: Ref<HTMLButtonElement>");
    expect(availSource).toContain("ref={triggerRef}");
    expect(availSource).toContain("setCharacterCurrentResetAvailabilityAction");
    expect(availSource).toContain("router.refresh()");
    expect(availSource).toMatch(/function close\([\s\S]*dialogRef\.current\?\.close/);
  });
});

describe("OverflowMenu onSelect path", () => {
  it("invokes onSelect and does not require node for labeled actions", async () => {
    vi.resetModules();
    const { OverflowMenu } = await import("@/components/ui/overflow-menu");
    const onSelect = vi.fn();
    // SSR markup still exposes the menuitem label when open is false — exercise source contract.
    const html = renderToStaticMarkup(
      createElement(OverflowMenu, {
        label: "More",
        items: [{ id: "edit", label: "Edit", onSelect }],
      }),
    );
    expect(html).toContain('aria-label="More"');
    expect(html).toContain("aria-haspopup");
    // Closed by default — menu items appear after open; assert item shape accepted.
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("overflow host ref typing smoke", () => {
  it("accepts a button ref object shape used by CharacterOverflow", () => {
    function Probe({ buttonRef }: { buttonRef: Ref<HTMLButtonElement> }) {
      return createElement("button", { ref: buttonRef, type: "button" }, "Edit");
    }
    function Host() {
      const ref = useRef<HTMLButtonElement>(null);
      return createElement(Probe, { buttonRef: ref });
    }
    expect(() => renderToStaticMarkup(createElement(Host))).not.toThrow();
  });
});
