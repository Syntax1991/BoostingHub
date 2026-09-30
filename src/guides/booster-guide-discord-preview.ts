/**
 * Builder-driven Discord Signups guide preview.
 *
 * This is a generated UI approximation for guide screenshots — not a real
 * Discord client capture. Titles, fields, loot type, button labels/order/styles
 * come from buildSignupEmbed / buildSignupButtons with anonymized fixture data.
 */
import { ButtonStyle } from "discord.js";
import {
  buildSignupButtons,
  buildSignupEmbed,
  emptySignupEmbedMembers,
} from "@/discord-bot/embeds/signup-embed";
import { parseCustomId } from "@/discord-bot/custom-ids";
import { APP_BRAND_NAME } from "@/lib/branding";
import type { SignupEmbedData, SignupEmbedMember } from "@/services/discord-sync.service";

const PREVIEW_RUN_ID = "rguide01-0000-4000-8000-000000000001";

function anonMember(
  partial: Pick<SignupEmbedMember, "signupId" | "userId" | "userName" | "wowClass"> & {
    discordUsername: string;
  },
): SignupEmbedMember {
  return {
    discordUserId: null,
    characterName: null,
    characterRealm: null,
    discordUsername: partial.discordUsername,
    signupId: partial.signupId,
    userId: partial.userId,
    userName: partial.userName,
    wowClass: partial.wowClass,
  };
}

/** Deterministic anonymized fixture — HEROIC + COMMUNITY (valid current enum). */
export function guideSignupPreviewFixture(): SignupEmbedData {
  const tanks = [
    anonMember({
      signupId: "s-guide-t1",
      userId: "u-guide-t1",
      userName: "BoosterA",
      discordUsername: "BoosterA",
      wowClass: "PALADIN",
    }),
    anonMember({
      signupId: "s-guide-t2",
      userId: "u-guide-t2",
      userName: "BoosterB",
      discordUsername: "BoosterB",
      wowClass: "WARRIOR",
    }),
  ];
  const healers = [
    anonMember({
      signupId: "s-guide-h1",
      userId: "u-guide-h1",
      userName: "BoosterC",
      discordUsername: "BoosterC",
      wowClass: "PRIEST",
    }),
    anonMember({
      signupId: "s-guide-h2",
      userId: "u-guide-h2",
      userName: "BoosterD",
      discordUsername: "BoosterD",
      wowClass: "SHAMAN",
    }),
  ];
  const dps = [
    anonMember({
      signupId: "s-guide-d1",
      userId: "u-guide-d1",
      userName: "BoosterE",
      discordUsername: "BoosterE",
      wowClass: "MAGE",
    }),
    anonMember({
      signupId: "s-guide-d2",
      userId: "u-guide-d2",
      userName: "BoosterF",
      discordUsername: "BoosterF",
      wowClass: "HUNTER",
    }),
  ];

  return {
    runId: PREVIEW_RUN_ID,
    runTitle: "Guide Preview Run",
    raidName: "The Venomous Abyss",
    productLabel: "The Venomous Abyss",
    contentSummary: "The Venomous Abyss 8/8",
    titleCoverage: "8/8",
    raidLeadName: "RaidLead",
    raidLeadDiscordUserId: null,
    difficulty: "HEROIC",
    lootType: "COMMUNITY",
    scheduledStartAt: "2026-10-04T19:00:00.000Z",
    runStatus: "OPEN",
    signupWindowOpen: true,
    uniqueSignupCount: 6,
    roleStatus: {
      tank: { signed: 2, picked: 0, target: 2 },
      healer: { signed: 2, picked: 0, target: 4 },
      dps: { signed: 2, picked: 0, target: 14 },
      lootbuddy: { signed: 0, picked: 0 },
    },
    members: {
      signed: {
        tanks,
        healers,
        dps,
        lootbuddies: [],
      },
      picked: emptySignupEmbedMembers(),
    },
    discordRolePing: false,
  };
}

const BUTTON_STYLE_CLASS: Record<number, string> = {
  [ButtonStyle.Primary]: "primary",
  [ButtonStyle.Secondary]: "secondary",
  [ButtonStyle.Success]: "success",
  [ButtonStyle.Danger]: "danger",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Turn Discord timestamp markup into a readable local date for the HTML preview only. */
function humanizeDiscordMarkup(value: string): string {
  return value.replace(/<t:(\d+):[tTdDfFR]>/g, (_full, seconds: string) => {
    const date = new Date(Number(seconds) * 1000);
    return date.toLocaleString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Berlin",
    });
  });
}

/**
 * Render a Discord-like HTML page from the real embed/button builders.
 * Mentions are shown as @Name for the anonymized fixture (no snowflakes).
 */
export function renderGuideSignupPreviewHtml(data: SignupEmbedData = guideSignupPreviewFixture()): string {
  const embed = buildSignupEmbed(data).toJSON();
  const row = buildSignupButtons(data).toJSON();
  const components = (row.components ?? []) as Array<{
    type: number;
    style?: number;
    label?: string | null;
    custom_id?: string;
    disabled?: boolean;
  }>;

  const fields = embed.fields ?? [];
  const fieldHtml = fields
    .map((field) => {
      const name = escapeHtml(field.name ?? "");
      const value = escapeHtml(
        humanizeDiscordMarkup((field.value ?? "").replace(/\u200b/g, "").trim() || "—"),
      );
      return `<div class="field"><div class="n">${name}</div><div class="v">${value}</div></div>`;
    })
    .join("\n");

  const buttonsHtml = components
    .map((button) => {
      const styleClass = BUTTON_STYLE_CLASS[button.style ?? ButtonStyle.Secondary] ?? "secondary";
      const label = escapeHtml(button.label ?? "");
      const disabled = button.disabled ? " disabled" : "";
      return `<button class="btn ${styleClass}" type="button"${disabled}>${label}</button>`;
    })
    .join("\n");

  const description = escapeHtml(humanizeDiscordMarkup(embed.description ?? ""));
  const title = escapeHtml(embed.title ?? "Signups");
  const footer = escapeHtml(humanizeDiscordMarkup(embed.footer?.text ?? ""));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Discord Signups preview (builder-driven)</title>
<meta name="guide-preview" content="generated-from-buildSignupEmbed" />
<style>
  html, body { margin: 0; background: #1e1f22; color: #dbdee1; font-family: "gg sans", "Segoe UI", sans-serif; }
  .frame { width: 1440px; height: 900px; display: flex; align-items: center; justify-content: center; }
  .channel { width: 720px; background: #313338; border-radius: 8px; padding: 20px 24px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
  .bot { display: flex; gap: 12px; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; background: #5865f2; flex: none; }
  .col { flex: 1; min-width: 0; }
  .name { font-weight: 600; color: #fff; font-size: 16px; }
  .tag { display: inline-block; margin-left: 6px; font-size: 10px; background: #5865f2; color: #fff; border-radius: 3px; padding: 1px 4px; vertical-align: middle; }
  .note { margin-top: 6px; font-size: 11px; color: #949ba4; }
  .embed { margin-top: 8px; border-left: 4px solid #d4af37; background: #2b2d31; border-radius: 4px; padding: 12px 14px 14px; }
  .title { font-weight: 700; color: #fff; font-size: 16px; margin-bottom: 6px; }
  .desc { font-size: 14px; line-height: 1.35; color: #dbdee1; white-space: pre-line; }
  .fields { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 12px; }
  .field .n { font-size: 12px; font-weight: 700; color: #fff; margin-bottom: 2px; }
  .field .v { font-size: 14px; color: #dbdee1; white-space: pre-line; }
  .footer { margin-top: 12px; font-size: 12px; color: #949ba4; }
  .row { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
  .btn { border: 0; border-radius: 3px; padding: 8px 14px; font-size: 14px; font-weight: 500; color: #fff; cursor: default; }
  .btn:disabled { opacity: 0.5; }
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
          <div><span class="name">${escapeHtml(APP_BRAND_NAME)}</span><span class="tag">APP</span></div>
          <div class="note">Generated UI preview from buildSignupEmbed / buildSignupButtons — not a live Discord client screenshot.</div>
          <div class="embed">
            <div class="title">${title}</div>
            <div class="desc">${description}</div>
            <div class="fields">
              ${fieldHtml}
            </div>
            <div class="footer">${footer}</div>
          </div>
          <div class="row">
            ${buttonsHtml}
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/** Button actions produced by the real builder for the guide fixture. */
export function guideSignupPreviewButtonActions(
  data: SignupEmbedData = guideSignupPreviewFixture(),
): string[] {
  const row = buildSignupButtons(data).toJSON();
  const components = (row.components ?? []) as Array<{ custom_id?: string }>;
  return components.map((c) => parseCustomId(c.custom_id ?? "")?.action).filter(Boolean) as string[];
}
