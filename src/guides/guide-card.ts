/**
 * Discord guide card format, shared by the Booster and Raid Lead guides.
 *
 * Live Discord posts identify themselves via embed footer:
 *   `Manawyrm Hub · guide:<kind>:v2:<cardKey>[ · asset:<12hex>]`
 *
 * The optional `asset:` segment is a SHA-256 prefix of the attached screenshot
 * bytes so screenshot-only refreshes still trigger Discord edits.
 */
import { createHash } from "node:crypto";
import { APP_BRAND_NAME } from "@/lib/branding";

export type GuideKind = "booster" | "raidlead";

const GUIDE_VERSION = "v2";
const GUIDE_ASSET_PREFIX = "asset:";
/** Same gold accent as signup embeds. */
const GUIDE_EMBED_COLOR = 0xd4af37;

export const APP_URL = "https://manawyrm-boosting.com";

export type GuideEmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

export type GuideCard = {
  key: string;
  title: string;
  description: string;
  fields?: GuideEmbedField[];
  /** Under docs/guides/screenshots/, or null for a text-only card. */
  imageFile: string | null;
  linkButton?: { label: string; url: string };
};

export type GuideEmbed = {
  title: string;
  description: string;
  color: number;
  fields?: GuideEmbedField[];
  footer: { text: string };
  image?: { url: string };
};

/** First 12 hex chars of SHA-256 over raw screenshot bytes. */
export function hashGuideAssetBytes(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}

export function parseGuideAssetRevision(footerText: string | null | undefined): string | null {
  if (!footerText) return null;
  const match = new RegExp(`·\\s*${GUIDE_ASSET_PREFIX}([a-f0-9]{12})\\b`, "i").exec(footerText);
  return match?.[1]?.toLowerCase() ?? null;
}

export function buildGuideComponents(card: GuideCard): unknown[] | undefined {
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

export type GuideFormat = ReturnType<typeof createGuideFormat>;

export function createGuideFormat(kind: GuideKind) {
  const markerPrefix = `guide:${kind}:${GUIDE_VERSION}:`;

  function footer(cardKey: string, assetRevision?: string | null): string {
    const base = `${APP_BRAND_NAME} · ${markerPrefix}${cardKey}`;
    if (!assetRevision) return base;
    return `${base} · ${GUIDE_ASSET_PREFIX}${assetRevision}`;
  }

  /** Card key from the footer: the asset segment is not part of it. */
  function parseCardKey(footerText: string | null | undefined): string | null {
    if (!footerText) return null;
    const idx = footerText.indexOf(markerPrefix);
    if (idx < 0) return null;
    const rest = footerText.slice(idx + markerPrefix.length).trim();
    const match = /^([a-z0-9-]+)/i.exec(rest);
    return match?.[1] ?? null;
  }

  function buildEmbed(card: GuideCard, options?: { assetRevision?: string | null }): GuideEmbed {
    const embed: GuideEmbed = {
      title: card.title,
      description: card.description,
      color: GUIDE_EMBED_COLOR,
      footer: { text: footer(card.key, options?.assetRevision ?? null) },
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

  /** Rough Discord embed size accounting. */
  function measureEmbed(card: GuideCard, assetRevision: string | null = "a".repeat(12)) {
    const footerText = footer(card.key, card.imageFile ? assetRevision : null);
    const fields = card.fields ?? [];
    const fieldNameChars = fields.reduce((n, f) => n + f.name.length, 0);
    const fieldValueChars = fields.reduce((n, f) => n + f.value.length, 0);
    const maxFieldChars = fields.reduce((n, f) => Math.max(n, f.value.length), 0);
    const totalChars =
      card.title.length + card.description.length + fieldNameChars + fieldValueChars + footerText.length;
    return {
      titleChars: card.title.length,
      descriptionChars: card.description.length,
      fieldCount: fields.length,
      maxFieldChars,
      footerChars: footerText.length,
      totalChars,
    };
  }

  return { kind, markerPrefix, footer, parseCardKey, buildEmbed, measureEmbed };
}
