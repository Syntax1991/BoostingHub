/**
 * Post the English booster guide (docs/guides/booster.en.md) into a Discord thread
 * via the bot, split into messages < 2000 chars with screenshots attached,
 * followed by a "Back to menu" link button.
 *
 * Usage (dry run, prints messages only):
 *   npx tsx --env-file=.env scripts/post-booster-guide.mts
 * Post for real:
 *   npx tsx --env-file=.env scripts/post-booster-guide.mts --post
 *
 * Options:
 *   --thread=<id>        target thread (default 1552698422677737694)
 *   --menu-channel=<id>  channel/thread the "Back to menu" button links to (default 1423239170268074055)
 *   --post               actually send; without it nothing is sent
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SCREENSHOTS = resolve(ROOT, "docs/guides/screenshots");
const API = "https://discord.com/api/v10";
const APP_URL = "https://phoenix-star.de";

const BACK_EMOJI = { id: "1289594271640453161", name: "Left_Arrow_Green", animated: true };

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

A quick introduction to **BoostingHub**: sign in, add characters, sign up for runs and track your status under **My Runs**.

App: ${APP_URL}

**Important:** Your account role is usually **USER**.
**BOOSTER** and **LOOTBUDDY** are not account roles — they are **participation types per run**.

### 1. Sign in
Open BoostingHub → **Continue with Discord**.
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

**Booster access:** To sign up as a booster you need an approved qualification (e.g. Heroic). Request Booster Access via Discord — not in the app. Without approval you can still sign up as a **Lootbuddy**.`,
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
Requirement: Discord linked to BoostingHub (sign in with Discord on the website once).

Every open run has a channel with a signup embed and buttons:

• **Signup** — as booster (character + roles)
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
1. Sign in with Discord (links Discord to BoostingHub)
2. Add character(s)
3. Request Booster Access via Discord
4. Sign up: website **Runs → Sign up** *or* Discord buttons
5. Check status: **My Runs** / \`/mysignups\`; withdraw / **Cancel Signup** if needed`,
    files: ["bo-05-my-runs.png"],
  },
];

async function send(token: string, threadId: string, body: object, files: string[]) {
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
  const res = await fetch(`${API}/channels/${threadId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text()}`);
  return (await res.json()) as { id: string };
}

async function main() {
  const threadId = arg("thread") ?? "1552698422677737694";
  const menuChannelId = arg("menu-channel") ?? "1423239170268074055";
  const post = process.argv.includes("--post");

  for (const m of MESSAGES) {
    if (m.content.length >= 2000) throw new Error(`Message too long (${m.content.length})`);
    for (const f of m.files) await readFile(resolve(SCREENSHOTS, f));
  }

  if (!post) {
    for (const [i, m] of MESSAGES.entries()) {
      console.log(`\n=== Message ${i + 1} (${m.content.length} chars) files: ${m.files.join(", ") || "-"}\n${m.content}`);
    }
    console.log(`\n=== Back to menu button → channel ${menuChannelId}`);
    console.log(`\nDry run. Re-run with --post to send to thread ${threadId}.`);
    return;
  }

  const token = requireEnv("DISCORD_BOT_TOKEN");
  const threadRes = await fetch(`${API}/channels/${threadId}`, { headers: { Authorization: `Bot ${token}` } });
  if (!threadRes.ok) throw new Error(`Cannot read thread ${threadId}: ${threadRes.status} ${await threadRes.text()}`);
  const { guild_id: guildId } = (await threadRes.json()) as { guild_id: string };
  const menuUrl = `https://discord.com/channels/${guildId}/${menuChannelId}`;

  const backToMenu = {
    components: [
      {
        type: 1,
        components: [{ type: 2, style: 5, label: "Back to menu", url: menuUrl, emoji: BACK_EMOJI }],
      },
    ],
  };

  for (const [i, m] of MESSAGES.entries()) {
    const { id } = await send(token, threadId, { content: m.content }, m.files);
    console.log(`Posted message ${i + 1}: ${id}`);
  }
  const { id } = await send(token, threadId, backToMenu, []);
  console.log(`Posted back-to-menu: ${id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
