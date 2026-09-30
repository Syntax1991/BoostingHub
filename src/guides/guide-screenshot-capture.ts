/**
 * Shared helpers for Booster Guide screenshot capture.
 * Keep DEV_AUTH usable for login, but fail the capture if development UI remains visible.
 */
import type { Page } from "playwright";

export const GUIDE_HIDE_SELECTOR = '[data-guide-hide="true"]';

export const FORBIDDEN_GUIDE_SCREENSHOT_TEXT = [
  "Development Identities",
  "Development Identity",
  "DEV_AUTH",
  "Login as",
] as const;

export async function hideGuideExcludedUi(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      ${GUIDE_HIDE_SELECTOR} { display: none !important; }
      nextjs-portal, [data-nextjs-toast], button[aria-label*="Next.js"] { display: none !important; }
      * { caret-color: transparent !important; }
    `,
  });
  await page.locator(GUIDE_HIDE_SELECTOR).evaluateAll((nodes) => {
    for (const node of nodes) {
      (node as HTMLElement).style.setProperty("display", "none", "important");
    }
  });
}

/**
 * Fail hard if development-auth UI text is still visible in the viewport.
 * Uses Playwright visibility — hidden [data-guide-hide] nodes do not count.
 */
export async function assertNoDevelopmentAuthUiVisible(page: Page): Promise<void> {
  for (const text of FORBIDDEN_GUIDE_SCREENSHOT_TEXT) {
    const locator = page.getByText(text, { exact: false });
    const count = await locator.count();
    for (let i = 0; i < count; i += 1) {
      const item = locator.nth(i);
      if (await item.isVisible()) {
        throw new Error(`Guide screenshot blocked: forbidden development UI still visible ("${text}")`);
      }
    }
  }
}

/** True when a string would fail the capture assertion (unit-test helper). */
export function containsForbiddenGuideScreenshotText(haystack: string): boolean {
  const lower = haystack.toLowerCase();
  return FORBIDDEN_GUIDE_SCREENSHOT_TEXT.some((needle) => lower.includes(needle.toLowerCase()));
}
