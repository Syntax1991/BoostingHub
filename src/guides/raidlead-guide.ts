/**
 * Canonical Manawyrm Hub Raid Lead Guide (Discord v2).
 *
 * Live Discord posts identify themselves via embed footer:
 *   `Manawyrm Hub · guide:raidlead:v2:<cardKey>[ · asset:<12hex>]`
 *
 * The optional `asset:` segment is a SHA-256 prefix of the attached screenshot
 * bytes so screenshot-only refreshes still trigger Discord edits.
 */
import { APP_BRAND_NAME } from "@/lib/branding";
import { hashGuideAssetBytes } from "@/guides/booster-guide";

export { hashGuideAssetBytes };

export const RAIDLEAD_GUIDE_KIND = "raidlead" as const;
export const RAIDLEAD_GUIDE_VERSION = "v2" as const;
export const RAIDLEAD_GUIDE_MARKER_PREFIX = `guide:${RAIDLEAD_GUIDE_KIND}:${RAIDLEAD_GUIDE_VERSION}:`;
export const RAIDLEAD_GUIDE_ASSET_PREFIX = "asset:";

/** Same gold accent as Booster Guide / signup embeds. */
export const RAIDLEAD_GUIDE_EMBED_COLOR = 0xd4af37;

export const APP_URL = "https://manawyrm-boosting.com";

export type GuideEmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

export type RaidleadGuideCard = {
  key: string;
  title: string;
  description: string;
  fields?: GuideEmbedField[];
  imageFile: string | null;
  linkButton?: { label: string; url: string };
};

export function raidleadGuideFooter(cardKey: string, assetRevision?: string | null): string {
  const base = `${APP_BRAND_NAME} · ${RAIDLEAD_GUIDE_MARKER_PREFIX}${cardKey}`;
  if (!assetRevision) return base;
  return `${base} · ${RAIDLEAD_GUIDE_ASSET_PREFIX}${assetRevision}`;
}

export function parseRaidleadGuideCardKey(footerText: string | null | undefined): string | null {
  if (!footerText) return null;
  const idx = footerText.indexOf(RAIDLEAD_GUIDE_MARKER_PREFIX);
  if (idx < 0) return null;
  const rest = footerText.slice(idx + RAIDLEAD_GUIDE_MARKER_PREFIX.length).trim();
  const match = /^([a-z0-9-]+)/i.exec(rest);
  return match?.[1] ?? null;
}

export function parseRaidleadGuideAssetRevision(footerText: string | null | undefined): string | null {
  if (!footerText) return null;
  const match = new RegExp(`·\\s*${RAIDLEAD_GUIDE_ASSET_PREFIX}([a-f0-9]{12})\\b`, "i").exec(footerText);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Six canonical Discord guide cards, written for a new Raid Lead. Each card answers
 * one question in a few steps and names the next step. Button names match the UI.
 */
export const RAIDLEAD_GUIDE_CARDS: readonly RaidleadGuideCard[] = [
  {
    key: "raid-lead-basics",
    title: "📗 Raid Lead Guide: How do I get started?",
    description: [
      `**1.** Press the button below and sign in with **Discord**.`,
      `**2.** Open the **Dashboard**. **Boosting Control Center** shows what each run needs next, like **Build Roster** or **Start Run**.`,
      `**3.** Open **Manage** → **Runs** to see all your runs.`,
      ``,
      `You manage the runs you lead. No **Manage** menu? Ask an Admin for the Raid Lead role.`,
      ``,
      `**Next:** create a run.`,
    ].join("\n"),
    imageFile: "live-rl-01-dashboard.png",
    linkButton: { label: "Open Manawyrm Hub", url: APP_URL },
  },
  {
    key: "create-run",
    title: "🛠️ How do I create a run?",
    description: [
      `**1.** Open **Runs** and press **Create Run**.`,
      `**2.** Choose the **Product**, **Difficulty** and **Run type** (Saved, Unsaved, VIP or Community). Mythic runs can't be Saved.`,
      `**3.** Enter how many **Tanks**, **Healers** and **DPS** you need.`,
      `**4.** Set the start time under **Runs**, then press **Create 1 Draft**.`,
      ``,
      `Need more runs? Press **Add Run** first. Only you and Admins can manage a draft, and boosters can't see it yet.`,
      ``,
      `**Next:** open signups.`,
    ].join("\n"),
    imageFile: "live-rl-04-create-run.png",
  },
  {
    key: "open-manage-signups",
    title: "📣 How do I manage signups?",
    description: [
      `**1.** Open your run and press **Open Run**. You only see this button while the run is a draft, so it is not in the picture.`,
      `**2.** Boosters can now sign up. The Discord channel appears once the run's raid week is the current or next one.`,
      `**3.** Press **Close Signups** when you have enough. **Reopen Signups** opens them again.`,
      ``,
      `Plans changed? Use **Edit Run** or **Cancel Run** before the run starts. **Reactivate Run** brings a cancelled run back.`,
      ``,
      `**Next:** build your roster.`,
    ].join("\n"),
    imageFile: "live-rl-06-run-overview.png",
  },
  {
    key: "build-roster",
    title: "👥 How do I build my roster?",
    description: [
      `Signing up does not put anyone in the raid. You choose the team.`,
      ``,
      `**1.** Open the **Roster** tab of your run.`,
      `**2.** Under **Signups**, click a player to add them. Click again to remove them.`,
      `**3.** Press **Save** (it appears after your first change), then **Publish**. Your roster now shows in Discord.`,
      ``,
      `Short on people? **Auto Build Roster** fills the team for you, **Add Booster** adds someone by hand, and **Ping roles** asks Discord for missing roles.`,
      ``,
      `Changed something after publishing? Press **Update**.`,
      ``,
      `**Next:** start the run.`,
    ].join("\n"),
    imageFile: "live-rl-05-roster.png",
  },
  {
    key: "run-attendance",
    title: "▶️ How do I start and manage a run?",
    description: [
      `**1.** Open the **Operations** tab and fix anything that blocks the start.`,
      `**2.** Go back to **Roster** and press **Start Run**. Signups close and players get their Raid Invite.`,
      `**3.** During the raid, open **Attendance** and mark **Late**, **No show** or **Standby** when it happens.`,
      ``,
      `Someone didn't show up? Press **Replace** on their row.`,
      ``,
      `**Next:** finish the run.`,
    ].join("\n"),
    imageFile: "live-rl-08-start-run.png",
  },
  {
    key: "complete-run",
    title: "✅ How do I finish a run?",
    description: [
      `**1.** On **Attendance**, check that all exceptions are marked.`,
      `**2.** Press **Mark all unmarked as Present**.`,
      `**3.** Press **Complete Run**.`,
      ``,
      `Found a mistake later? Press **Correct Attendance** and give a reason.`,
      ``,
      `**Last step:** press **Archive Run** on the run's Discord signup message. This saves the chat and removes the channel. You can also use **Archive** in the **⋯** menu under **Manage** → **Runs**.`,
    ].join("\n"),
    imageFile: "rl-09-finish-run.png",
  },
] as const;

export function buildRaidleadGuideEmbed(
  card: RaidleadGuideCard,
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
    color: RAIDLEAD_GUIDE_EMBED_COLOR,
    footer: { text: raidleadGuideFooter(card.key, options?.assetRevision ?? null) },
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

export function buildRaidleadGuideComponents(card: RaidleadGuideCard): unknown[] | undefined {
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

export function measureRaidleadGuideEmbed(
  card: RaidleadGuideCard,
  assetRevision: string | null = "a".repeat(12),
): {
  titleChars: number;
  descriptionChars: number;
  fieldCount: number;
  maxFieldChars: number;
  footerChars: number;
  totalChars: number;
} {
  const footer = raidleadGuideFooter(card.key, card.imageFile ? assetRevision : null);
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
