/**
 * Post the English raid lead guide (docs/guides/raidlead.en.md) into a Discord thread
 * via the bot, split into messages < 2000 chars with screenshots attached,
 * followed by a "Back to menu" link button.
 *
 * Usage (dry run, prints messages only):
 *   npx tsx --env-file=.env scripts/post-raidlead-guide.mts
 * Post for real:
 *   npx tsx --env-file=.env scripts/post-raidlead-guide.mts --post
 *
 * Options:
 *   --thread=<id>        target thread (default 1552709968879292546)
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
    content: `## 📗 Raid Lead Guide

A quick introduction to **BoostingHub** as a **RAID_LEAD**: create runs, open signups, build the roster, start, mark attendance and complete.

App: ${APP_URL}

You only manage **your own** runs (lead = you). Admins can see and edit all runs.

### 1. Sign in
Like every user: **Continue with Discord**.
You then see **RAID LEAD** in the top right and **Manage** in the sidebar.

### 2. Dashboard — Boosting Control Center
Lists hand-offs for your assigned runs, e.g.:
• **Build Roster** / **Start Run**
• **Mark Attendance**
• **Prepare Payout** / **Review Payout**`,
    files: ["common-01-login.png", "rl-01-dashboard.png"],
  },
  {
    content: `### 3. Create a run
1. **Runs** → **Create Run**
2. Set **Shared defaults**: product, bosses, difficulty, loot type, composition (tanks / healers / DPS), optional role ping + notes
3. Enter the **start time** per row (1–25 runs at once)
4. **Create … Draft** — the run starts as **DRAFT**, signups closed

As raid lead, the lead is always you.

### 4. Manage runs
**Manage → Runs** shows your runs with status, signup window and actions (**Build Roster**, **View Run**, **Cancel Run**, …).

Drafts do **not** show up under **Runs** for regular users.`,
    files: ["rl-04-create-run.png", "rl-03-manage-runs.png"],
  },
  {
    content: `### 5. Open the run and control signups
On the run page (**Overview**):
• **Open Run** — DRAFT → OPEN, signups open
• **Close Signups** / **Reopen Signups** — window closed / open (status stays OPEN/ROSTERING)
• **Edit Run** — change planning (restricted by status / signup history)
• **Cancel Run** — cancel; history is kept

Under **Runs** you see community runs and the **Create Run** button.`,
    files: ["rl-06-run-overview.png", "rl-02-runs.png"],
  },
  {
    content: `### 6. Build and publish the roster
**Roster** tab:
1. Watch composition and **Class Buffs** (warnings, no hard blocks)
2. Select signup cards, set the **Selected Role** for boosters
3. **Save Roster** saves the draft (first save on OPEN → **ROSTERING**)
4. **Publish Roster** sets SELECTED / NOT_SELECTED → **PUBLISHED**

With composition warnings, tick the acknowledge checkboxes before publishing.

Notes:
• Max **one** selected **BOOSTER** per user; lootbuddies can be selected in addition
• "Committed elsewhere" shows other commitments — schedule conflicts (< 2 h between starts) block the selection`,
    files: ["rl-05-roster.png"],
  },
  {
    content: `### 7. Start the run
On a **PUBLISHED** run: **Start Run**.
Then: status **IN PROGRESS**, signups closed, attendance snapshot of the SELECTED players. The roster is frozen.

### 8. Attendance and complete
**Attendance** tab:
1. Set exceptions first (**Late**, **No show**, **Standby**, **Excused**, …) with a note
2. **Mark all unmarked as Present**
3. **Complete Run** — only once nobody is **Unmarked**

**Standby** is for backups who weren't needed — don't mark them as no-show.`,
    files: ["rl-08-start-run.png", "rl-07-attendance.png"],
  },
  {
    content: `### 9. Payout (short)
After **COMPLETED**, **Payout** tab:
1. Prepare the settlement draft (gold pot entered manually)
2. Calculate / finalize the split
3. An admin does **Mark Paid**

### Typical flow
Create Draft
→ Edit (if needed)
→ Open Run (signups open)
→ Collect signups / close window
→ Save roster → Publish
→ Start Run
→ Attendance → Complete
→ Payout

### ✅ Checklist
1. Sign in with Discord as RAID_LEAD
2. **Create Run** → draft
3. **Open Run**, watch signups
4. Save **Roster** and **Publish**
5. **Start Run** → Attendance → **Complete**
6. Prepare payout (admin marks paid)`,
    files: [],
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
  const threadId = arg("thread") ?? "1552709968879292546";
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
