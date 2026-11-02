/**
 * Publish / update a Manawyrm Hub guide in Discord.
 *
 * Default is dry-run (preview). Never prints tokens.
 *
 *   npm run guide:booster:preview
 *   npm run guide:raidlead:publish
 *
 * Options:
 *   --guide=<kind>     booster or raidlead (required)
 *   --channel=<id>     target channel (default: GUIDE_CHANNEL_IDS.<kind>)
 *   --publish          apply creates/edits
 *   --replace          replace the guide with new messages instead of editing it:
 *                      alone: read-only plan · with --publish: create and verify new
 *                      messages, delete nothing · with --retire-old: delete the old
 *                      ids saved by the publish run
 *   --snapshot-dir=…   override local rollback snapshot directory
 *                      (default: tmp-<kind>-guide-snapshots/)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GUIDE_CHANNEL_IDS } from "@/discord-bot/guide-channels";
import { boosterGuidePublisher } from "@/guides/booster-guide";
import { buildGuideComponents, type GuideKind } from "@/guides/guide-card";
import {
  DISCORD_API,
  defaultScreenshotsDir,
  loadGuideScreenshot,
  resolveGuideAssetRevisions,
  type DiscordMessageLike,
  type GuideDiscordClient,
  type GuidePublisher,
} from "@/guides/guide-publisher";
import {
  discordHttpErrorFrom,
  fetchDiscordAsset,
  hasActiveGuideReplacement,
  runGuideReplaceCli,
  type GuideReplaceMessage,
} from "@/guides/guide-replace";
import { raidleadGuidePublisher } from "@/guides/raidlead-guide";

const PUBLISHERS: Record<GuideKind, GuidePublisher> = {
  booster: boosterGuidePublisher,
  raidlead: raidleadGuidePublisher,
};

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const SUPPRESS_NOTIFICATIONS_FLAG = 1 << 12;

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
    throw discordHttpErrorFrom(res.status, method, path, await res.text(), res.headers);
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
    async createMessage({ channelId, embed, components, files, nonce }) {
      const payload: Record<string, unknown> = {
        content: "",
        embeds: [embed],
      };
      if (components) payload.components = components;
      // Replace mode: Discord returns the first message for a repeated nonce, and no push goes out.
      if (nonce) Object.assign(payload, { nonce, enforce_nonce: true, flags: SUPPRESS_NOTIFICATIONS_FLAG });
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

async function writeGuideRollbackSnapshot(
  kind: GuideKind,
  dir: string,
  channelId: string,
  messages: DiscordMessageLike[],
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = resolve(dir, `${kind}-guide-snapshot-${stamp}.json`);
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
  const kind = arg("guide") as GuideKind | undefined;
  if (kind !== "booster" && kind !== "raidlead") {
    throw new Error("--guide=booster or --guide=raidlead is required.");
  }
  const publisher = PUBLISHERS[kind];
  const { cards, format } = publisher;
  const channelId = arg("channel") ?? GUIDE_CHANNEL_IDS[kind];
  const publish = process.argv.includes("--publish");
  const replace = process.argv.includes("--replace");
  const snapshotDir = arg("snapshot-dir") ?? resolve(process.cwd(), `tmp-${kind}-guide-snapshots`);
  const screenshotsDir = defaultScreenshotsDir();

  const cardErrors = publisher.validateCards();
  if (cardErrors.length) {
    throw new Error(`Guide card validation failed:\n${cardErrors.join("\n")}`);
  }

  const assetRevisions = await resolveGuideAssetRevisions(screenshotsDir, cards);
  console.log(`${kind} guide cards: ${cards.length}`);
  for (const [i, card] of cards.entries()) {
    const revision = assetRevisions[card.key] ?? null;
    const embed = format.buildEmbed(card, { assetRevision: revision });
    console.log(
      `  ${i + 1}. ${card.key} — "${card.title}" image=${card.imageFile ?? "-"} asset=${revision ?? "-"} footer="${embed.footer.text}"`,
    );
  }

  if (replace) {
    const retireOld = process.argv.includes("--retire-old");
    if (retireOld && publish) {
      throw new Error("--replace takes either --publish or --retire-old.");
    }
    const token = requireEnv("DISCORD_BOT_TOKEN");
    const rest = createRestClient(token);
    const me = await discordJson<{ id: string }>(token, "GET", "/users/@me");
    const ok = await runGuideReplaceCli(
      {
        channelId,
        botUserId: me.id,
        snapshotDir,
        adapter: {
          kind,
          cards,
          assetRevisions,
          cardErrors,
          cardKeyFromFooter: format.parseCardKey,
          needsUpdate: (message, card, revision) => publisher.needsUpdate(message, card, revision),
          render: (card, revision) => [
            format.buildEmbed(card, { assetRevision: revision }),
            buildGuideComponents(card),
          ],
        },
        client: {
          listMessages: (id) => rest.listMessages(id) as Promise<GuideReplaceMessage[]>,
          deleteMessage: (id, messageId) => rest.deleteMessage(id, messageId),
          fetchAsset: fetchDiscordAsset,
          async createCardMessage({ channelId: id, card, assetRevision, nonce }) {
            const files = card.imageFile
              ? [{ name: card.imageFile, data: await loadGuideScreenshot(screenshotsDir, card.imageFile) }]
              : [];
            return rest.createMessage({
              channelId: id,
              embed: format.buildEmbed(card, { assetRevision }),
              components: buildGuideComponents(card),
              files,
              nonce,
            });
          },
        },
      },
      retireOld ? "retire" : publish ? "publish" : "plan",
    );
    if (!ok) process.exit(1);
    return;
  }

  if (!publish) {
    console.log("\nDry-run / preview only (no Discord reads or writes).");
    console.log("Re-run with --publish to upsert the live guide.");
    return;
  }

  if (await hasActiveGuideReplacement(snapshotDir, channelId)) {
    throw new Error("An unfinished --replace run owns this channel. Finish it before a normal publish.");
  }

  const token = requireEnv("DISCORD_BOT_TOKEN");
  const client = createRestClient(token);
  const me = await discordJson<{ id: string }>(token, "GET", "/users/@me");
  const messages = await client.listMessages(channelId);

  const snapshotPath = await writeGuideRollbackSnapshot(kind, snapshotDir, channelId, messages);
  console.log(`Rollback snapshot written: ${snapshotPath}`);

  const plan = publisher.plan({ channelId, botUserId: me.id, messages, assetRevisions });

  if (plan.errors.length) {
    console.error("Refusing to publish:");
    for (const err of plan.errors) console.error(`  - ${err}`);
    process.exit(1);
  }

  console.log("Plan:");
  for (const action of plan.actions) {
    console.log(`  - ${JSON.stringify(action)}`);
  }

  const result = await publisher.execute({ client, channelId, plan, screenshotsDir, dryRun: false });

  console.log(`Done. unchanged=${result.unchanged} updated=${result.updated} created=${result.created}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
