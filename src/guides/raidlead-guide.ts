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
 * Six canonical Discord guide cards for Raid Leads.
 * Keep descriptions short — screenshots carry the visual explanation.
 */
export const RAIDLEAD_GUIDE_CARDS: readonly RaidleadGuideCard[] = [
  {
    key: "raid-lead-basics",
    title: `📗 ${APP_BRAND_NAME} — Raid Lead Guide`,
    description: [
      `Sign in with **Discord**. As a **RAID_LEAD** you see **Manage** and work your assigned Runs.`,
      ``,
      `App: ${APP_URL}`,
      ``,
      `• You manage Runs where **you** are the Raid Lead.`,
      `• **ADMIN** can manage every Run.`,
      `• Use the **Dashboard** for Build Roster / Start / Attendance hand-offs.`,
    ].join("\n"),
    imageFile: "rl-01-dashboard.png",
    linkButton: { label: "Open Manawyrm Hub", url: APP_URL },
  },
  {
    key: "create-run",
    title: "🛠️ Create a Run",
    description: [
      `**Runs → Create Run** (1–25 drafts in one submit).`,
      ``,
      `**Shared defaults**`,
      `• **Product** — The Venomous Abyss, or Season 2 Bundle (Tide 1/1 + Venomous)`,
      `• **Bosses** — planned Venomous coverage (1–8)`,
      `• **Difficulty** — Normal / Heroic / Mythic`,
      `• **Run type** — Saved / Unsaved / VIP / **Community**`,
      `• **Composition** — Tanks / Healers / DPS / Lootbuddy target`,
      `• Optional Discord role ping + notes`,
      ``,
      `Set a **start time** per row, then **Create N Draft(s)**. Title is generated automatically.`,
      ``,
      `Mythic cannot use Saved. As Raid Lead, the lead is always you.`,
    ].join("\n"),
    imageFile: "rl-04-create-run.png",
  },
  {
    key: "open-manage-signups",
    title: "📣 Open & Manage Signups",
    description: [
      `On **Overview**:`,
      ``,
      `• **Open Run** — Draft → Open, signups open (creates Discord channel when eligible)`,
      `• **Close / Reopen Signups** — window only (status stays Open / Rostering)`,
      `• **Edit Run** — allowed until **Start** (roster-relevant edits need **Update Roster** before Start)`,
      `• **Cancel Run** — history kept; not available after Start`,
      ``,
      `Discord keeps a persistent **Signups** message and a persistent **Roster** message in the Run channel.`,
      ``,
      `Drafts are not listed under public **Runs**.`,
    ].join("\n"),
    imageFile: "rl-06-run-overview.png",
  },
  {
    key: "build-roster",
    title: "👥 Build the Roster",
    description: [
      `**Signup ≠ Selected.** Offers arrive first; you choose the lineup.`,
      ``,
      `**Roster tab**`,
      `1. Review Booster offers + Lootbuddies`,
      `2. Select Character / **Selected Role** (max one BOOSTER per user)`,
      `3. Add registered Boosters or **External Boosters** when needed`,
      `4. Check composition, class buffs, schedule conflicts (< 2h block), same-reset commitments (informational)`,
      `5. **Save Roster** (first save on Open → Rostering; notifies SELECTED/REMOVED)`,
      `6. **Publish Roster** → SELECTED / NOT_SELECTED and status **Published**`,
      ``,
      `After publish: dirty changes → **Update Roster**. Clean → Publish refreshes Discord only.`,
      `Roster stays editable until **Start Run**.`,
    ].join("\n"),
    imageFile: "rl-05-roster.png",
  },
  {
    key: "run-attendance",
    title: "▶️ Run & Attendance",
    description: [
      `**Start Run** (Published + published roster + ≥1 SELECTED):`,
      `• Status → **In Progress**`,
      `• Signups close`,
      `• Attendance snapshot of SELECTED players (all Unmarked)`,
      `• Raid Invite DMs + Discord Final Setup / Voice`,
      ``,
      `**Attendance**`,
      `• Mark exceptions first (Late, No show, Standby, Excused, …)`,
      `• **Mark all unmarked as Present**`,
      `• **Standby** = backup not used (not No show)`,
      `• **Complete Run** requires no **Unmarked** rows`,
      ``,
      `In-progress **Replace** paths exist for no-shows.`,
    ].join("\n"),
    imageFile: "rl-07-attendance.png",
  },
  {
    key: "complete-run",
    title: "✅ Complete the run",
    description: [
      `When every participant is marked, press **Complete Run**.`,
      ``,
      `• Attendance becomes read-only`,
      `• Mistakes found later: **Correct Attendance** (reason required, recorded in Run History)`,
      `• Completed Runs also have a **Consumables** (WCL) audit tab`,
      ``,
      `**Lifecycle**`,
      `Draft → Open → Rostering → Published → In Progress → Completed`,
      ``,
      `Discord: \`/guide raidlead\``,
    ].join("\n"),
    imageFile: "rl-06-run-overview.png",
  },
] as const;

export function raidleadGuideCardByKey(key: string): RaidleadGuideCard | undefined {
  return RAIDLEAD_GUIDE_CARDS.find((card) => card.key === key);
}

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
