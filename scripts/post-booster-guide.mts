/**
 * Post the English booster guide (docs/guides/booster.en.md) into a Discord
 * channel via the bot, split into messages < 2000 chars with screenshots attached.
 *
 * Usage (dry run, prints messages only):
 *   npx tsx --env-file=.env scripts/post-booster-guide.mts
 * Post for real:
 *   npx tsx --env-file=.env scripts/post-booster-guide.mts --post
 *
 * Options:
 *   --channel=<id>       target channel (default: GUIDE_CHANNEL_IDS.booster, the booster guide channel)
 *   --post               actually send; without it nothing is sent
 *
 * --post always sends NEW messages. It never edits or de-duplicates a guide that
 * is already posted — re-running it posts the guide a second time. To reword an
 * already-posted guide, edit those messages instead of re-posting.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GUIDE_CHANNEL_IDS } from "@/discord-bot/guide-channels";

const ROOT = resolve(import.meta.dirname, "..");
const SCREENSHOTS = resolve(ROOT, "docs/guides/screenshots");
const API = "https://discord.com/api/v10";
const APP_URL = "https://manawyrm-boosting.com";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

type GuideMessage = { content: string; files: string[] };

const MESSAGES: GuideMessage[] = [
  {
    content: `## 📘 Booster Guide

A quick introduction to **Manawyrm Hub**: sign in, add characters, sign up for runs and track your status under **My Runs**.

App: ${APP_URL}

**Important:** Your account role is usually **USER**.
**Booster** and **Lootbuddy** are not account roles — they are **Boosting Roles** on your account, granted by an admin.

### 1. Sign in
Open Manawyrm Hub → **Continue with Discord**.
After signing in you land on the **Dashboard**.`,
    files: ["common-01-login.png"],
  },
  {
    content: `### 2. Dashboard
At a glance:
• **Your attention** — scheduling conflicts
• **Upcoming Runs** — open / ongoing runs
• **Next selected run** — your next SELECTED run
• **Characters** — active / booster-eligible characters

### 3. Add characters
Under **Characters**:
1. Optionally connect Battle.net (EU/US)
2. Or use **Add Character** (region / realm / name + spec)
3. Check **Account Access** and **Availability**

**Booster role:** To sign up as a booster your account needs the Booster role (valid for every difficulty). Apply via Discord — not in the app. Without it you can still sign up as a **Lootbuddy**.`,
    files: ["bo-01-dashboard.png", "bo-02-characters.png"],
  },
  {
    content: `### 4. Sign up for a run
Open **Runs** → look for runs with **Signups open** → **Sign up**.

Columns:
• **RAID** — title, difficulty, status
• **SCHEDULE** — date / time
• **LEAD** — raid lead
• **COMP** — e.g. 2T / 4H / 14D
• **YOU** — your status
• **ACTION** — Sign up / Signed ×N

**Booster**
1. Tick your character(s)
2. Choose roles (Tank / Healer / DPS)
3. **Save Booster Offers**

**Lootbuddy** (independent, no character needed)
• Class + mode (Loot only / Play along)
• **Save Lootbuddies**

Tip: Website and Discord share the same signups — Discord buttons: next message.`,
    files: ["bo-03-runs.png", "bo-04-signup.png"],
  },
  {
    content: `### 5. Signing up via the Discord bot
Requirement: Discord linked to Manawyrm Hub (sign in with Discord on the website once).

Every open run has a channel with a signup embed and buttons:

• **Signup** — as booster (character + roles)
• **Quick Signup** — all eligible characters with specialization default role (additive)
• **Sign as Lootbuddy** — pick classes → saved as **Loot only**
• **Cancel Signup** — withdraws booster **and** lootbuddy

**Booster flow**
1. Click **Signup** (reply is only visible to you)
2. Select character(s) → **Next**
3. Set roles → **Confirm**

**Lootbuddy:** Mode **Play along** and finer setups are website-only.

**\`/mysignups\`** — your current signups (like My Runs). There is no \`/signup\`.

After publish: roster embed in the channel. On start you may get a raid invite DM.`,
    files: [],
  },
  {
    content: `### 6. Status under My Runs
• **Selected** — in the published roster
• **Pending** — raid lead hasn't decided yet
• **Not Selected / Withdrawn** — history

**Withdraw** pulls back an offer while allowed (Pending usually free; Selected often only before publish/start).

### Run lifecycle (booster view)
Sign up (Pending)
→ Roster
→ Publish (Selected / Not Selected)
→ Start → Attendance → Complete → Payout

### ✅ Checklist
1. Sign in with Discord (links Discord to Manawyrm Hub)
2. Add character(s)
3. Apply for the Booster role via Discord
4. Sign up: website **Runs → Sign up** *or* Discord buttons
5. Check status: **My Runs** / \`/mysignups\`; withdraw / **Cancel Signup** if needed`,
    files: ["bo-05-my-runs.png"],
  },
];

async function send(token: string, channelId: string, body: object, files: string[]) {
  const form = new FormData();
  const payload = {
    ...body,
    allowed_mentions: { parse: [] },
    attachments: files.map((name, id) => ({ id, filename: name })),
  };
  form.append("payload_json", JSON.stringify(payload));
  for (const [i, name] of files.entries()) {
    const data = await readFile(resolve(SCREENSHOTS, name));
    form.append(`files[${i}]`, new Blob([data], { type: "image/png" }), name);
  }
  const res = await fetch(`${API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text()}`);
  return (await res.json()) as { id: string };
}

async function main() {
  const channelId = arg("channel") ?? GUIDE_CHANNEL_IDS.booster;
  const post = process.argv.includes("--post");

  for (const m of MESSAGES) {
    if (m.content.length >= 2000) throw new Error(`Message too long (${m.content.length})`);
    for (const f of m.files) await readFile(resolve(SCREENSHOTS, f));
  }

  if (!post) {
    for (const [i, m] of MESSAGES.entries()) {
      console.log(`\n=== Message ${i + 1} (${m.content.length} chars) files: ${m.files.join(", ") || "-"}\n${m.content}`);
    }
    console.log(`\nDry run. Re-run with --post to send to channel ${channelId}.`);
    return;
  }

  const token = requireEnv("DISCORD_BOT_TOKEN");
  for (const [i, m] of MESSAGES.entries()) {
    const { id } = await send(token, channelId, { content: m.content }, m.files);
    console.log(`Posted message ${i + 1}: ${id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
