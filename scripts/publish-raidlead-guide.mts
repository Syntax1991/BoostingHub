/**
 * Publish / update the Manawyrm Hub Raid Lead Guide in Discord.
 *
 * Default is dry-run (preview). Never prints tokens.
 *
 *   npm run guide:raidlead:preview
 *   npm run guide:raidlead:publish
 *   npm run guide:raidlead:publish -- --retire-legacy
 *
 * Options:
 *   --channel=<id>     target channel (default: GUIDE_CHANNEL_IDS.raidlead)
 *   --publish          apply creates/edits (and optional legacy retirement)
 *   --retire-legacy    after upsert + re-read verification, delete the complete
 *                      known six-message legacy Raid Lead Guide set
 *   --snapshot-dir=…   override local rollback snapshot directory
 *                      (default: tmp-raidlead-guide-snapshots/)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GUIDE_CHANNEL_IDS } from "@/discord-bot/guide-channels";
import { RAIDLEAD_GUIDE_CARDS, buildRaidleadGuideEmbed } from "@/guides/raidlead-guide";
import {
  DISCORD_API,
  defaultGuideSnapshotDir,
  defaultScreenshotsDir,
  executeRaidleadGuidePublish,
  planRaidleadGuidePublish,
  resolveGuideAssetRevisions,
  validateRaidleadGuideCards,
  type DiscordMessageLike,
  type GuideDiscordClient,
} from "@/guides/raidlead-guide-publisher";

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

export async function writeGuideRollbackSnapshot(
  dir: string,
  channelId: string,
  messages: DiscordMessageLike[],
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = resolve(dir, `raidlead-guide-snapshot-${stamp}.json`);
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
  const channelId = arg("channel") ?? GUIDE_CHANNEL_IDS.raidlead;
  const publish = process.argv.includes("--publish");
  const retireLegacy = process.argv.includes("--retire-legacy");
  const snapshotDir = arg("snapshot-dir") ?? defaultGuideSnapshotDir();
  const screenshotsDir = defaultScreenshotsDir();

  const cardErrors = validateRaidleadGuideCards(RAIDLEAD_GUIDE_CARDS);
  if (cardErrors.length) {
    throw new Error(`Guide card validation failed:\n${cardErrors.join("\n")}`);
  }

  const assetRevisions = await resolveGuideAssetRevisions(screenshotsDir);
  console.log(`Raid Lead Guide cards: ${RAIDLEAD_GUIDE_CARDS.length}`);
  for (const [i, card] of RAIDLEAD_GUIDE_CARDS.entries()) {
    const revision = assetRevisions[card.key] ?? null;
    const embed = buildRaidleadGuideEmbed(card, { assetRevision: revision });
    console.log(
      `  ${i + 1}. ${card.key} — "${card.title}" image=${card.imageFile ?? "-"} asset=${revision ?? "-"} footer=${embed.footer.text}`,
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

  const snapshotPath = await writeGuideRollbackSnapshot(snapshotDir, channelId, messages);
  console.log(`Rollback snapshot written: ${snapshotPath}`);

  const plan = planRaidleadGuidePublish({
    channelId,
    botUserId: me.id,
    messages,
    assetRevisions,
    retireLegacy,
  });

  if (plan.errors.length) {
    console.error("Refusing to publish:");
    for (const err of plan.errors) console.error(`  - ${err}`);
    process.exit(1);
  }

  if (plan.legacyMessageIds.length && !retireLegacy) {
    console.log(
      `Warning: legacy guide fingerprints matched ${plan.legacyMessageIds.length}/6. After verifying the new guide, re-run with --retire-legacy.`,
    );
  }

  console.log("Plan:");
  for (const action of plan.actions) {
    console.log(`  - ${JSON.stringify(action)}`);
  }
  if (retireLegacy) {
    console.log(`  - retire-legacy candidates=${JSON.stringify(plan.legacyMessageIds)} complete=${plan.legacyComplete}`);
  }

  const result = await executeRaidleadGuidePublish({
    client,
    channelId,
    plan,
    screenshotsDir,
    botUserId: me.id,
    retireLegacy,
    dryRun: false,
  });

  console.log(
    `Done. unchanged=${result.unchanged} updated=${result.updated} created=${result.created} retiredLegacy=${result.retiredLegacy}`,
  );
  if (result.retirementSkippedReason) {
    console.error(`Legacy retirement skipped: ${result.retirementSkippedReason}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
