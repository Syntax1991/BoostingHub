/**
 * Publish / update the Manawyrm Hub Booster Guide in Discord.
 *
 * Default is dry-run (preview). Never prints tokens.
 *
 *   npm run guide:booster:preview
 *   npm run guide:booster:publish
 *   npm run guide:booster:publish -- --retire-legacy
 *
 * Options:
 *   --channel=<id>     target channel (default: GUIDE_CHANNEL_IDS.booster)
 *   --publish          apply creates/edits (and optional legacy retirement)
 *   --retire-legacy    after upserting the five v2 cards, delete positively
 *                      identified legacy bot guide messages (no v2 marker)
 *   --snapshot-dir=…   write a local rollback snapshot (message ids + content)
 *                      before mutating; never commit this
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GUIDE_CHANNEL_IDS } from "@/discord-bot/guide-channels";
import { BOOSTER_GUIDE_CARDS, buildBoosterGuideEmbed } from "@/guides/booster-guide";
import {
  DISCORD_API,
  defaultScreenshotsDir,
  executeBoosterGuidePublish,
  planBoosterGuidePublish,
  validateBoosterGuideCards,
  type DiscordMessageLike,
  type GuideDiscordClient,
} from "@/guides/booster-guide-publisher";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function discordJson<T>(
  token: string,
  method: string,
  path: string,
  body?: BodyInit,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${DISCORD_API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      ...(headers ?? {}),
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord ${res.status} ${method} ${path}: ${text.slice(0, 500)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function listAllMessages(token: string, channelId: string): Promise<DiscordMessageLike[]> {
  const out: DiscordMessageLike[] = [];
  let before: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const qs = new URLSearchParams({ limit: "100" });
    if (before) qs.set("before", before);
    const batch = await discordJson<DiscordMessageLike[]>(
      token,
      "GET",
      `/channels/${channelId}/messages?${qs}`,
    );
    if (batch.length === 0) break;
    out.push(...batch);
    before = batch[batch.length - 1]?.id;
    if (batch.length < 100) break;
  }
  return out;
}

function buildMultipart(payload: object, files: Array<{ name: string; data: Buffer }>): FormData {
  const form = new FormData();
  const withAttachments = {
    ...payload,
    allowed_mentions: { parse: [] as string[] },
    attachments: files.map((file, id) => ({ id, filename: file.name })),
  };
  form.append("payload_json", JSON.stringify(withAttachments));
  for (const [i, file] of files.entries()) {
    form.append(
      `files[${i}]`,
      new Blob([Uint8Array.from(file.data)], { type: "image/png" }),
      file.name,
    );
  }
  return form;
}

function createRestClient(token: string): GuideDiscordClient {
  return {
    async listMessages(channelId) {
      return listAllMessages(token, channelId);
    },
    async createMessage({ channelId, embed, components, files }) {
      const payload: Record<string, unknown> = {
        content: "",
        embeds: [embed],
      };
      if (components) payload.components = components;
      const form = buildMultipart(payload, files);
      return discordJson<{ id: string }>(token, "POST", `/channels/${channelId}/messages`, form);
    },
    async editMessage({ channelId, messageId, embed, components, files }) {
      const payload: Record<string, unknown> = {
        content: "",
        embeds: [embed],
        components: components ?? [],
      };
      const form = buildMultipart(payload, files);
      return discordJson<{ id: string }>(
        token,
        "PATCH",
        `/channels/${channelId}/messages/${messageId}`,
        form,
      );
    },
    async deleteMessage(channelId, messageId) {
      await discordJson<void>(token, "DELETE", `/channels/${channelId}/messages/${messageId}`);
    },
  };
}

async function writeSnapshot(
  dir: string,
  channelId: string,
  messages: DiscordMessageLike[],
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = resolve(dir, `booster-guide-snapshot-${stamp}.json`);
  const payload = {
    channelId,
    savedAt: new Date().toISOString(),
    messages: messages.map((m) => ({
      id: m.id,
      content: m.content ?? "",
      embeds: m.embeds ?? [],
      attachments: (m.attachments ?? []).map((a) => ({
        id: a.id,
        filename: a.filename,
        url: a.url,
      })),
    })),
  };
  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
  return path;
}

async function main() {
  const channelId = arg("channel") ?? GUIDE_CHANNEL_IDS.booster;
  const publish = process.argv.includes("--publish");
  const retireLegacy = process.argv.includes("--retire-legacy");
  const snapshotDir = arg("snapshot-dir");
  const screenshotsDir = defaultScreenshotsDir();

  const cardErrors = validateBoosterGuideCards(BOOSTER_GUIDE_CARDS);
  if (cardErrors.length) {
    throw new Error(`Guide card validation failed:\n${cardErrors.join("\n")}`);
  }

  console.log(`Booster guide cards: ${BOOSTER_GUIDE_CARDS.length}`);
  for (const [i, card] of BOOSTER_GUIDE_CARDS.entries()) {
    const embed = buildBoosterGuideEmbed(card);
    console.log(
      `  ${i + 1}. ${card.key} — "${card.title}" image=${card.imageFile ?? "-"} footer=${embed.footer.text}`,
    );
  }

  if (!publish) {
    console.log("\nDry-run / preview only (no Discord reads or writes).");
    console.log("Re-run with --publish to upsert the live guide.");
    if (retireLegacy) console.log("Note: --retire-legacy is ignored without --publish.");
    return;
  }

  const token = requireEnv("DISCORD_BOT_TOKEN");
  const client = createRestClient(token);
  const me = await discordJson<{ id: string }>(token, "GET", "/users/@me");
  const messages = await client.listMessages(channelId);

  if (snapshotDir) {
    const path = await writeSnapshot(snapshotDir, channelId, messages);
    console.log(`Rollback snapshot written: ${path}`);
  }

  const plan = planBoosterGuidePublish({
    channelId,
    botUserId: me.id,
    messages,
    retireLegacy,
  });

  if (plan.errors.length) {
    console.error("Refusing to publish:");
    for (const err of plan.errors) console.error(`  - ${err}`);
    process.exit(1);
  }

  if (plan.legacyMessageIds.length && !retireLegacy) {
    console.log(
      `Warning: ${plan.legacyMessageIds.length} legacy guide message(s) remain. After verifying the new guide, re-run with --retire-legacy.`,
    );
  }

  console.log("Plan:");
  for (const action of plan.actions) {
    console.log(`  - ${JSON.stringify(action)}`);
  }

  const result = await executeBoosterGuidePublish({
    client,
    channelId,
    plan,
    screenshotsDir,
    dryRun: false,
  });

  console.log(
    `Done. unchanged=${result.unchanged} updated=${result.updated} created=${result.created} retiredLegacy=${result.retiredLegacy}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
