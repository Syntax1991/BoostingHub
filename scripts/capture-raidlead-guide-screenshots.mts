/**
 * Capture Raid Lead Guide screenshots from a local DEV_AUTH session.
 *
 * Prerequisites:
 *   - `npm run dev` on BASE_URL (default http://localhost:3000)
 *   - DEV_AUTH_ENABLED=true with seeded identities
 *   - seeded Thorne Ironvein RAID_LEAD fixtures
 *   - `npx playwright install chromium` once
 *
 * Usage:
 *   npx tsx scripts/capture-raidlead-guide-screenshots.mts
 *   npm run guide:raidlead:screenshots
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import {
  assertNoDevelopmentAuthUiVisible,
  hideGuideExcludedUi,
} from "@/guides/guide-screenshot-capture";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "docs/guides/screenshots");
const VIEWPORT = { width: 1440, height: 900 };

/** Stable seed UUIDs from src/prisma/seed.ts (Thorne-owned fixtures). */
const RUNS = {
  heroicRostering: "r3333333-3333-4333-8333-333333333333", // Sunday Heroic Boost — draft roster
  heroicPublished: "r5555555-5555-4555-8555-555555555555", // Published — Start Run controls
  heroicWeekend: "r7777777-7777-4777-8777-777777777777", // Open — signup window controls
  heroicInProgress: "r9999991-9991-4991-8991-999999999991", // Attendance
} as const;

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function loginAsThorne(page: Page, baseUrl: string) {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  const button = page.getByRole("button", { name: /Thorne Ironvein/i });
  await button.waitFor({ timeout: 15_000 });
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 20_000 }),
    button.click(),
  ]);
}

async function shot(page: Page, file: string) {
  await hideGuideExcludedUi(page);
  await assertNoDevelopmentAuthUiVisible(page);
  await page.waitForTimeout(350);
  const path = resolve(OUT, file);
  await page.screenshot({ path, type: "png" });
  console.log(`wrote ${file}`);
}

async function main() {
  const baseUrl = (arg("base-url") ?? "http://localhost:3000").replace(/\/$/, "");
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });

  await loginAsThorne(page, baseUrl);

  // Card 1 — Raid Lead dashboard
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "networkidle" });
  await shot(page, "rl-01-dashboard.png");

  // Supporting — Runs list + Manage Runs
  await page.goto(`${baseUrl}/runs`, { waitUntil: "networkidle" });
  await shot(page, "rl-02-runs.png");

  await page.goto(`${baseUrl}/manage/runs`, { waitUntil: "networkidle" });
  await shot(page, "rl-03-manage-runs.png");

  // Card 2 — Create Run
  await page.goto(`${baseUrl}/runs/create`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create Run/i }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  await shot(page, "rl-04-create-run.png");

  // Card 4 — Roster builder (Sunday Heroic Boost has draft selections)
  await page.goto(`${baseUrl}/runs/${RUNS.heroicRostering}?tab=roster`, { waitUntil: "networkidle" });
  await page.getByText(/Save Roster|Publish Roster|Composition/i).first().waitFor({ timeout: 15_000 }).catch(() => undefined);
  // Prefer showing participant rows over empty lower chrome.
  const saveRoster = page.getByRole("button", { name: /Save Roster/i }).first();
  if ((await saveRoster.count()) > 0) {
    await saveRoster.scrollIntoViewIfNeeded().catch(() => undefined);
  } else {
    await page.getByText(/Selected Role|Offers|Draft selected/i).first().scrollIntoViewIfNeeded().catch(() => undefined);
  }
  await shot(page, "rl-05-roster.png");

  // Card 3 — Run overview / Open & signup controls
  await page.goto(`${baseUrl}/runs/${RUNS.heroicWeekend}`, { waitUntil: "networkidle" });
  await shot(page, "rl-06-run-overview.png");

  // Card 5 — Attendance (+ Start Run supporting shot on Published)
  await page.goto(`${baseUrl}/runs/${RUNS.heroicInProgress}?tab=attendance`, {
    waitUntil: "networkidle",
  });
  await shot(page, "rl-07-attendance.png");

  await page.goto(`${baseUrl}/runs/${RUNS.heroicPublished}`, { waitUntil: "networkidle" });
  await shot(page, "rl-08-start-run.png");

  await browser.close();
  console.log("Raid Lead guide screenshots capture complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
