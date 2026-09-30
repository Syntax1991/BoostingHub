/**
 * Canonical Manawyrm Hub Booster Guide (Discord v2).
 *
 * Live Discord posts identify themselves via embed footer:
 *   `Manawyrm Hub · guide:booster:v2:<cardKey>`
 *
 * English copy here is authoritative for Discord. Markdown guides under
 * docs/guides/booster.en.md / booster.md mirror the same structure for the website.
 */
import { APP_BRAND_NAME } from "@/lib/branding";

export const BOOSTER_GUIDE_KIND = "booster" as const;
export const BOOSTER_GUIDE_VERSION = "v2" as const;
export const BOOSTER_GUIDE_MARKER_PREFIX = `guide:${BOOSTER_GUIDE_KIND}:${BOOSTER_GUIDE_VERSION}:`;

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

export function boosterGuideFooter(cardKey: string): string {
  return `${APP_BRAND_NAME} · ${BOOSTER_GUIDE_MARKER_PREFIX}${cardKey}`;
}

export function parseBoosterGuideCardKey(footerText: string | null | undefined): string | null {
  if (!footerText) return null;
  const idx = footerText.indexOf(BOOSTER_GUIDE_MARKER_PREFIX);
  if (idx < 0) return null;
  const key = footerText.slice(idx + BOOSTER_GUIDE_MARKER_PREFIX.length).trim();
  return key.length > 0 ? key : null;
}

/**
 * Five canonical Discord guide cards. Keep descriptions short — screenshots
 * carry the visual explanation.
 */
export const BOOSTER_GUIDE_CARDS: readonly BoosterGuideCard[] = [
  {
    key: "getting-started",
    title: `📘 ${APP_BRAND_NAME} — Booster Guide`,
    description: [
      `Sign in with **Discord**, then use the **Dashboard** to jump into **Runs**, **Characters**, and **My Runs**.`,
      ``,
      `App: ${APP_URL}`,
      ``,
      `**Booster** is a Boosting Role granted by the community/admin. It applies to your **account**, not to a single Character.`,
    ].join("\n"),
    imageFile: "bo-01-dashboard.png",
    linkButton: { label: "Open Manawyrm Hub", url: APP_URL },
  },
  {
    key: "characters",
    title: "🧙 Characters",
    description: [
      `Connect **Battle.net** or use **Add Character**.`,
      ``,
      `• Your **specialization** sets the default role used by Quick Signup.`,
      `• Set **Availability** so others know when you can play.`,
      `• The Booster role is **account-wide**.`,
      `• Lockouts are **informational** — they do not block signup by themselves.`,
      `• Inactive or unavailable Characters are **skipped** by Quick Signup.`,
    ].join("\n"),
    imageFile: "bo-02-characters.png",
  },
  {
    key: "signing-up",
    title: "📝 Signing up",
    description: [
      `**Website:** **Runs** → **Sign up**`,
      ``,
      `**Manual Booster flow**`,
      `1. Select one or more Characters`,
      `2. Choose offered roles (Tank / Healer / DPS)`,
      `3. **Save Booster Offers**`,
      ``,
      `The website is best when you want fine-grained role choices.`,
      ``,
      `**Lootbuddy** signups are independent and can coexist with Booster offers.`,
    ].join("\n"),
    imageFile: "bo-04-signup.png",
  },
  {
    key: "discord-signups",
    title: "⚡ Discord Signups",
    description: [
      `Every open Run channel has a persistent **Signups** message with four buttons:`,
    ].join("\n"),
    fields: [
      {
        name: "Signup",
        value: "Choose Characters and offered roles manually.",
      },
      {
        name: "Quick Signup",
        value: [
          "One click signs every currently eligible Booster Character using its current specialization's default role.",
          "",
          "• Additive — existing offers stay unchanged",
          "• Unavailable / reserved Characters are skipped",
          "• No recognized default role → skipped",
          "• Use normal **Signup** for manual role control",
        ].join("\n"),
      },
      {
        name: "Sign as Lootbuddy",
        value: "Discord creates **Loot-only** entries (Play along and finer setups are website-only).",
      },
      {
        name: "Cancel Signup",
        value: "Withdraws your current Booster **and** Lootbuddy participation for this Run (protected roster rows may block).",
      },
    ],
    imageFile: "bo-06-discord-signups.png",
  },
  {
    key: "after-signing-up",
    title: "✅ After signing up",
    description: [
      `**Pending** — you offered yourself`,
      `**Selected** — you are in the published Roster`,
      `**Not Selected / Withdrawn** — history / current outcome`,
      ``,
      `**Lifecycle**`,
      `Signup → Roster → Publish → Start → Attendance → Complete → Payout`,
      ``,
      `Quick status in Discord: \`/mysignups\``,
      ``,
      `**Checklist**`,
      `1. Sign in with Discord`,
      `2. Add Character(s) + Booster role`,
      `3. Sign up (website or Discord)`,
      `4. Track status in **My Runs** / \`/mysignups\``,
    ].join("\n"),
    imageFile: "bo-05-my-runs.png",
  },
] as const;

export function boosterGuideCardByKey(key: string): BoosterGuideCard | undefined {
  return BOOSTER_GUIDE_CARDS.find((card) => card.key === key);
}

/** Discord embed payload (API shape) for one card — no attachments. */
export function buildBoosterGuideEmbed(card: BoosterGuideCard): {
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
    footer: { text: boosterGuideFooter(card.key) },
  };
  if (card.fields?.length) {
    embed.fields = card.fields.map((field) => ({
      name: field.name,
      value: field.value,
      inline: field.inline ?? false,
    }));
  }
  if (card.imageFile) {
    // Attachment is referenced as attachment://filename when uploaded with the message.
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
export function measureBoosterGuideEmbed(card: BoosterGuideCard): {
  titleChars: number;
  descriptionChars: number;
  fieldCount: number;
  maxFieldChars: number;
  footerChars: number;
  totalChars: number;
} {
  const footer = boosterGuideFooter(card.key);
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
