/**
 * Capture Booster Guide screenshots from a local DEV_AUTH session.
 *
 * Prerequisites:
 *   - `npm run dev` on BASE_URL (default http://localhost:3000)
 *   - DEV_AUTH_ENABLED=true with seeded identities
 *   - `npx playwright install chromium` once
 *
 * DEV_AUTH may be used to sign in, but development identity UI must be hidden
 * before every screenshot (via [data-guide-hide="true"]). Capture fails if
 * forbidden development-auth text remains visible.
 *
 * `bo-06-discord-signups.png` is a sanitized real Discord capture and is NOT
 * overwritten here. The builder-driven HTML preview is written only to
 * `_discord-signup-preview.*` for regression.
 *
 * Usage:
 *   npx tsx scripts/capture-guide-screenshots.mts
 *   npx tsx scripts/capture-guide-screenshots.mts --base-url=http://localhost:3000
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { renderGuideSignupPreviewHtml } from "@/guides/booster-guide-discord-preview";
import {
  assertNoDevelopmentAuthUiVisible,
  hideGuideExcludedUi,
} from "@/guides/guide-screenshot-capture";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "docs/guides/screenshots");
const VIEWPORT = { width: 1440, height: 900 };

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function loginAsKael(page: Page, baseUrl: string) {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  const button = page.getByRole("button", { name: /Kael Stormhowl/i });
  await button.waitFor({ timeout: 15_000 });
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 20_000 }),
    button.click(),
  ]);
}

async function shot(page: Page, file: string) {
  await hideGuideExcludedUi(page);
  await assertNoDevelopmentAuthUiVisible(page);
  await page.waitForTimeout(300);
  const path = resolve(OUT, file);
  await page.screenshot({ path, type: "png" });
  console.log(`wrote ${file}`);
}

/**
 * Builder-driven Discord signup preview for regression only.
 * Card 4's committed screenshot (`bo-06-discord-signups.png`) is a sanitized
 * real Discord capture — this helper must not overwrite it.
 */
async function captureDiscordPreview() {
  const html = renderGuideSignupPreviewHtml();
  if (/\bSplit\b/.test(html)) {
    throw new Error("Discord preview still contains obsolete 'Split' loot wording");
  }
  if (!/\bCommunity\b/.test(html) && !/\bVIP\b/.test(html)) {
    throw new Error("Discord preview missing a valid current loot type label");
  }
  const previewPath = resolve(OUT, "_discord-signup-preview.html");
  await writeFile(previewPath, html, "utf8");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await page.goto(`file://${previewPath.replace(/\\/g, "/")}`, { waitUntil: "load" });
  await page.screenshot({ path: resolve(OUT, "_discord-signup-preview.png"), type: "png" });
  console.log("wrote _discord-signup-preview.png (builder-driven regression preview; does not replace bo-06)");
  await browser.close();
}

async function openSignupDialog(page: Page, baseUrl: string): Promise<boolean> {
  await page.goto(`${baseUrl}/runs`, { waitUntil: "networkidle" });
  const openSignup = page
    .getByRole("button", { name: /^Sign up$/i })
    .first()
    .or(page.getByRole("button", { name: /^Signed/i }).first());
  if ((await openSignup.count()) === 0) return false;
  await openSignup.click();
  await page.getByRole("heading", { name: /Sign up/i }).waitFor({ timeout: 10_000 });
  await page.getByText("Save Booster Offers").first().scrollIntoViewIfNeeded().catch(() => undefined);
  return true;
}

async function main() {
  const baseUrl = (arg("base-url") ?? "http://localhost:3000").replace(/\/$/, "");
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });

  await loginAsKael(page, baseUrl);
  await shot(page, "bo-01-dashboard.png");

  await page.goto(`${baseUrl}/characters`, { waitUntil: "networkidle" });
  await shot(page, "bo-02-characters.png");

  await page.goto(`${baseUrl}/runs`, { waitUntil: "networkidle" });
  await shot(page, "bo-03-runs.png");

  if (await openSignupDialog(page, baseUrl)) {
    await shot(page, "bo-04-signup.png");
    await page.keyboard.press("Escape");
  } else {
    console.warn("No Sign up / Signed button found — leaving bo-04-signup.png unchanged");
  }

  await page.goto(`${baseUrl}/my-runs`, { waitUntil: "networkidle" });
  await shot(page, "bo-05-my-runs.png");

  await browser.close();
  await captureDiscordPreview();
  console.log("Guide screenshots capture complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
