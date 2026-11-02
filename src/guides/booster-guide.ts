/**
 * Canonical Manawyrm Hub Booster Guide (Discord v2).
 *
 * Live Discord posts identify themselves via embed footer:
 *   `Manawyrm Hub · guide:booster:v2:<cardKey>[ · asset:<12hex>]`
 *
 * The optional `asset:` segment is a SHA-256 prefix of the attached screenshot
 * bytes so screenshot-only refreshes still trigger Discord edits.
 */
import { createHash } from "node:crypto";
import { APP_BRAND_NAME } from "@/lib/branding";

export const BOOSTER_GUIDE_KIND = "booster" as const;
export const BOOSTER_GUIDE_VERSION = "v2" as const;
export const BOOSTER_GUIDE_MARKER_PREFIX = `guide:${BOOSTER_GUIDE_KIND}:${BOOSTER_GUIDE_VERSION}:`;
export const BOOSTER_GUIDE_ASSET_PREFIX = "asset:";

/** Discord embed accent — same gold family as signup embeds / CSS --accent. */
export const BOOSTER_GUIDE_EMBED_COLOR = 0xd4af37;

export const APP_URL = "https://manawyrm-boosting.com";

export type GuideEmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

export type BoosterGuideCard = {
  /** Stable machine key — part of the footer marker. */
  key: string;
  title: string;
  description: string;
  fields?: GuideEmbedField[];
  /** Filename under docs/guides/screenshots/, or null when the card is text-only. */
  imageFile: string | null;
  linkButton?: { label: string; url: string };
};

/** First 12 hex chars of SHA-256 — short, stable, collision-resistant enough for guide assets. */
export function hashGuideAssetBytes(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}

export function boosterGuideFooter(cardKey: string, assetRevision?: string | null): string {
  const base = `${APP_BRAND_NAME} · ${BOOSTER_GUIDE_MARKER_PREFIX}${cardKey}`;
  if (!assetRevision) return base;
  return `${base} · ${BOOSTER_GUIDE_ASSET_PREFIX}${assetRevision}`;
}

/**
 * Extract the stable card key from a v2 footer. Ignores trailing ` · asset:…`
 * metadata so revision bumps never break identity parsing.
 */
export function parseBoosterGuideCardKey(footerText: string | null | undefined): string | null {
  if (!footerText) return null;
  const idx = footerText.indexOf(BOOSTER_GUIDE_MARKER_PREFIX);
  if (idx < 0) return null;
  const rest = footerText.slice(idx + BOOSTER_GUIDE_MARKER_PREFIX.length).trim();
  const match = /^([a-z0-9-]+)/i.exec(rest);
  return match?.[1] ?? null;
}

export function parseBoosterGuideAssetRevision(footerText: string | null | undefined): string | null {
  if (!footerText) return null;
  const match = new RegExp(`·\\s*${BOOSTER_GUIDE_ASSET_PREFIX}([a-f0-9]{12})\\b`, "i").exec(footerText);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Five canonical Discord guide cards, written for a new Booster. Each card answers
 * one question in a few steps and names the next step. Button names match the UI.
 */
export const BOOSTER_GUIDE_CARDS: readonly BoosterGuideCard[] = [
  {
    key: "getting-started",
    title: "📘 Booster Guide: How do I get started?",
    description: [
      `**1.** Press the button below and sign in with **Discord**.`,
      `**2.** The **Dashboard** shows your next run and all upcoming runs.`,
      `**3.** Open **Characters** and look for the **BOOSTER** tag next to **Boosting roles**.`,
      ``,
      `No tag yet? Press **Apply via Discord** on that page, or ask staff. You can still join runs as a Lootbuddy without it.`,
      ``,
      `**Next:** add your characters.`,
    ].join("\n"),
    imageFile: "live-bo-01-dashboard.png",
    linkButton: { label: "Open Manawyrm Hub", url: APP_URL },
  },
  {
    key: "characters",
    title: "🧙 How do I add my characters?",
    description: [
      `**1.** Open **Characters** and press **Add Character**.`,
      `**2.** Paste the character's Raider.IO link.`,
      `**3.** Choose the specs you play, then press **Add character**.`,
      ``,
      `Your specs decide which roles you can offer.`,
      ``,
      `Busy this week? Press **⋯** on the character and choose **Availability**.`,
      ``,
      `**Next:** sign up for a run.`,
    ].join("\n"),
    imageFile: "live-bo-02-characters.png",
  },
  {
    key: "signing-up",
    title: "📝 How do I sign up for a run?",
    description: [
      `**1.** Open **Runs** and press **Sign up** on the run you want.`,
      `**2.** Tick your characters and the roles you can play.`,
      `**3.** Press **Save Booster Offers**.`,
      ``,
      `Here for loot? Under **Lootbuddies**, choose a class and press **Save Lootbuddies**. You can do both.`,
      ``,
      `Signing up does not put you in the raid yet. The Raid Lead picks the team.`,
      ``,
      `**Next:** see what happens after you sign up. Prefer Discord? Read the next card first.`,
    ].join("\n"),
    imageFile: "live-bo-04-signup.png",
  },
  {
    key: "discord-signups",
    title: "⚡ How do I sign up through Discord?",
    description: [
      `Every open run has its own Discord channel with a signup message. Use its buttons:`,
    ].join("\n"),
    fields: [
      {
        name: "Signup",
        value: "Choose your characters and press **Next**. Choose your roles and press **Confirm Signup**.",
      },
      {
        name: "Quick Sign",
        value: "One click signs up all your available characters with their main role. The Raid Lead still picks the team.",
      },
      {
        name: "LB",
        value: "Sign up as a Lootbuddy and pick one or more classes.",
      },
      {
        name: "Unsign",
        value: "Removes all your signups for this run. If you are on the roster, you must give a reason. Once the run has started, talk to your Raid Lead.",
      },
      {
        name: "Add / Edit Note",
        value: "Leave a short note for the Raid Lead. Sign up first.",
      },
    ],
    imageFile: null,
  },
  {
    key: "after-signing-up",
    title: "✅ What happens after I sign up?",
    description: [
      `Open **My Runs** to see your status:`,
      ``,
      `**Pending:** the Raid Lead has not decided yet.`,
      `**Selected:** you are on the roster.`,
      `**Not Selected:** you were not picked this time.`,
      `**Withdrawn:** you left the run.`,
      ``,
      `You get a notification if you are picked or removed, and a Raid Invite when the run starts.`,
      ``,
      `Can't make it? Press **Withdraw** on **My Runs**. In Discord, \`/mysignups\` shows your signups.`,
      ``,
      `**Next:** be ready when your run starts. Good luck!`,
    ].join("\n"),
    imageFile: "live-bo-05-my-runs.png",
  },
] as const;

/** Discord embed payload (API shape) for one card — no attachments. */
export function buildBoosterGuideEmbed(
  card: BoosterGuideCard,
  options?: { assetRevision?: string | null },
): {
  title: string;
  description: string;
  color: number;
  fields?: GuideEmbedField[];
  footer: { text: string };
  image?: { url: string };
} {
  const embed: {
    title: string;
    description: string;
    color: number;
    fields?: GuideEmbedField[];
    footer: { text: string };
    image?: { url: string };
  } = {
    title: card.title,
    description: card.description,
    color: BOOSTER_GUIDE_EMBED_COLOR,
    footer: { text: boosterGuideFooter(card.key, options?.assetRevision ?? null) },
  };
  if (card.fields?.length) {
    embed.fields = card.fields.map((field) => ({
      name: field.name,
      value: field.value,
      inline: field.inline ?? false,
    }));
  }
  if (card.imageFile) {
    embed.image = { url: `attachment://${card.imageFile}` };
  }
  return embed;
}

export function buildBoosterGuideComponents(card: BoosterGuideCard): unknown[] | undefined {
  if (!card.linkButton) return undefined;
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 5,
          label: card.linkButton.label,
          url: card.linkButton.url,
        },
      ],
    },
  ];
}

/** Rough Discord embed size accounting used by publisher tests. */
export function measureBoosterGuideEmbed(
  card: BoosterGuideCard,
  assetRevision: string | null = "a".repeat(12),
): {
  titleChars: number;
  descriptionChars: number;
  fieldCount: number;
  maxFieldChars: number;
  footerChars: number;
  totalChars: number;
} {
  const footer = boosterGuideFooter(card.key, card.imageFile ? assetRevision : null);
  const fields = card.fields ?? [];
  const fieldNameChars = fields.reduce((n, f) => n + f.name.length, 0);
  const fieldValueChars = fields.reduce((n, f) => n + f.value.length, 0);
  const maxFieldChars = fields.reduce((n, f) => Math.max(n, f.value.length), 0);
  const totalChars =
    card.title.length + card.description.length + fieldNameChars + fieldValueChars + footer.length;
  return {
    titleChars: card.title.length,
    descriptionChars: card.description.length,
    fieldCount: fields.length,
    maxFieldChars,
    footerChars: footer.length,
    totalChars,
  };
}
