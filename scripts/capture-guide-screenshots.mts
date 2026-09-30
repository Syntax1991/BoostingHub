/**
 * Capture Booster Guide screenshots from a local DEV_AUTH session.
 *
 * Prerequisites:
 *   - `npm run dev` on BASE_URL (default http://localhost:3000)
 *   - DEV_AUTH_ENABLED=true with seeded identities
 *   - `npx playwright install chromium` once
 *
 * Usage:
 *   npx tsx scripts/capture-guide-screenshots.mts
 *   npx tsx scripts/capture-guide-screenshots.mts --base-url=http://localhost:3000
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "docs/guides/screenshots");
const VIEWPORT = { width: 1440, height: 900 };

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function hideChrome(page: Page) {
  await page.addStyleTag({
    content: `
      nextjs-portal, [data-nextjs-toast], button[aria-label*="Next.js"] { display: none !important; }
      * { caret-color: transparent !important; }
    `,
  });
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
  await hideChrome(page);
  await page.waitForTimeout(400);
  const path = resolve(OUT, file);
  await page.screenshot({ path, type: "png" });
  console.log(`wrote ${file}`);
}

async function captureDiscordPreview() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Discord Signups preview</title>
<style>
  html, body { margin: 0; background: #1e1f22; color: #dbdee1; font-family: "gg sans", "Segoe UI", sans-serif; }
  .frame { width: 1440px; height: 900px; display: flex; align-items: center; justify-content: center; }
  .channel { width: 720px; background: #313338; border-radius: 8px; padding: 20px 24px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
  .bot { display: flex; gap: 12px; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; background: #5865f2; flex: none; }
  .col { flex: 1; min-width: 0; }
  .name { font-weight: 600; color: #fff; font-size: 16px; }
  .tag { display: inline-block; margin-left: 6px; font-size: 10px; background: #5865f2; color: #fff; border-radius: 3px; padding: 1px 4px; vertical-align: middle; }
  .embed { margin-top: 8px; border-left: 4px solid #d4af37; background: #2b2d31; border-radius: 4px; padding: 12px 14px 14px; }
  .title { font-weight: 700; color: #fff; font-size: 16px; margin-bottom: 6px; }
  .desc { font-size: 14px; line-height: 1.35; color: #dbdee1; white-space: pre-line; }
  .fields { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 12px; }
  .field .n { font-size: 12px; font-weight: 700; color: #fff; margin-bottom: 2px; }
  .field .v { font-size: 14px; color: #dbdee1; }
  .roles { margin-top: 12px; }
  .role-h { font-size: 12px; font-weight: 700; color: #fff; margin: 8px 0 4px; }
  .role-l { font-size: 14px; color: #dbdee1; margin: 2px 0; }
  .footer { margin-top: 12px; font-size: 12px; color: #949ba4; }
  .row { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
  .btn { border: 0; border-radius: 3px; padding: 8px 14px; font-size: 14px; font-weight: 500; color: #fff; cursor: default; }
  .primary { background: #5865f2; }
  .success { background: #248046; }
  .secondary { background: #4e5058; }
  .danger { background: #da373c; }
</style>
</head>
<body>
  <div class="frame">
    <div class="channel">
      <div class="bot">
        <div class="avatar" aria-hidden="true"></div>
        <div class="col">
          <div><span class="name">Manawyrm Hub</span><span class="tag">APP</span></div>
          <div class="embed">
            <div class="title">Signups</div>
            <div class="desc">Heroic · Split · The Venomous Abyss
Signup does not mean selected.</div>
            <div class="fields">
              <div class="field"><div class="n">Scheduled</div><div class="v">Saturday evening</div></div>
              <div class="field"><div class="n">Signed users</div><div class="v">6</div></div>
              <div class="field"><div class="n">Status</div><div class="v">Open</div></div>
              <div class="field"><div class="n">Loot</div><div class="v">Split</div></div>
              <div class="field"><div class="n">★ Raid Lead</div><div class="v">@RaidLead</div></div>
            </div>
            <div class="roles">
              <div class="role-h">Signups by role</div>
              <div class="role-h">🛡 Tank · 2</div>
              <div class="role-l">@BoosterA</div>
              <div class="role-l">@BoosterB</div>
              <div class="role-h">✚ Healer · 2</div>
              <div class="role-l">@BoosterC</div>
              <div class="role-l">@BoosterD</div>
              <div class="role-h">⚔ DPS · 2</div>
              <div class="role-l">@BoosterE</div>
              <div class="role-l">@BoosterF</div>
            </div>
            <div class="footer">Signups are open. Signup does not mean selected.</div>
          </div>
          <div class="row">
            <button class="btn primary" type="button">Signup</button>
            <button class="btn success" type="button">Quick Signup</button>
            <button class="btn secondary" type="button">Sign as Lootbuddy</button>
            <button class="btn danger" type="button">Cancel Signup</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
  const previewPath = resolve(OUT, "_discord-signup-preview.html");
  await writeFile(previewPath, html, "utf8");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await page.goto(`file://${previewPath.replace(/\\/g, "/")}`, { waitUntil: "load" });
  await page.screenshot({ path: resolve(OUT, "bo-06-discord-signups.png"), type: "png" });
  console.log("wrote bo-06-discord-signups.png (controlled Discord-faithful preview)");
  await browser.close();
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

  // Open Sign up dialog (fresh Sign up, or Signed ×N which opens the same editor).
  const openSignup =
    page.getByRole("button", { name: /^Sign up$/i }).first().or(page.getByRole("button", { name: /^Signed/i }).first());
  if (await openSignup.count()) {
    await openSignup.click();
    await page.getByRole("heading", { name: /Sign up/i }).waitFor({ timeout: 10_000 });
    // Prefer a focused crop feel: ensure Booster section is visible.
    await page.getByText("Save Booster Offers").first().scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(500);
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
