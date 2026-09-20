import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type InteractionEditReplyOptions,
  type StringSelectMenuInteraction,
} from "discord.js";
import { BotApiClient } from "@/discord-bot/bot-api-client";
import { buildCharacterScopedCustomId, buildCustomId } from "@/discord-bot/custom-ids";
import { describeBotApiError } from "@/discord-bot/interactions/error-copy";
import {
  discardSession,
  getSession,
  setStagedRoles,
  startSession,
  type CharacterRole,
  type StagedBoosterSession,
  type WowClass,
} from "@/discord-bot/interactions/signup-staging";
import { requestImmediateSync } from "@/discord-bot/sync-loop";
import { formatTargetRaidLockoutLabel } from "@/lib/raid-lockout-label";
import type { RunLootType } from "@/models/enums";

const MAX_SELECT_OPTIONS = 25;
/** Discord allows at most 5 action rows per message; one row is reserved for the Confirm/Cancel buttons. */
const MAX_ROLE_SELECT_ROWS = 4;

const ROLE_ORDER: readonly CharacterRole[] = ["TANK", "HEALER", "DPS"];
const ROLE_LABELS: Record<CharacterRole, string> = { TANK: "Tank", HEALER: "Healer", DPS: "DPS" };

const CLASS_ORDER: readonly WowClass[] = [
  "DEATH_KNIGHT",
  "DEMON_HUNTER",
  "DRUID",
  "EVOKER",
  "HUNTER",
  "MAGE",
  "MONK",
  "PALADIN",
  "PRIEST",
  "ROGUE",
  "SHAMAN",
  "WARLOCK",
  "WARRIOR",
];
const CLASS_LABELS: Record<WowClass, string> = {
  DEATH_KNIGHT: "Death Knight",
  DEMON_HUNTER: "Demon Hunter",
  DRUID: "Druid",
  EVOKER: "Evoker",
  HUNTER: "Hunter",
  MAGE: "Mage",
  MONK: "Monk",
  PALADIN: "Paladin",
  PRIEST: "Priest",
  ROGUE: "Rogue",
  SHAMAN: "Shaman",
  WARLOCK: "Warlock",
  WARRIOR: "Warrior",
};

/** Discord Lootbuddy signup always persists as Loot only — Mode is a Web-only detail. */
const DISCORD_LOOTBUDDY_MODE = "LOOT_ONLY" as const;

function orderedRoles(roles: CharacterRole[]): CharacterRole[] {
  return ROLE_ORDER.filter((role) => roles.includes(role));
}

type RaidSaveInfo = {
  bossesDefeated: number;
  totalBossCount: number;
  isComplete: boolean;
};
type EligibleContentSave = {
  totalBossCount: number;
  raidSave: RaidSaveInfo | null;
  label: { text: string };
};
type EligibleCharacterOption = {
  characterId: string;
  characterName: string;
  realm: string;
  /** Every role this Character's class can perform. */
  roles: CharacterRole[];
  /** Specialization-derived default, or null when specialization is missing/unrecognized. */
  defaultRole: CharacterRole | null;
  /** Informational per-content lockouts — a saved Character remains fully selectable. */
  contentSaves?: EligibleContentSave[];
};

function primaryContentLockout(option: EligibleCharacterOption): EligibleContentSave | null {
  return option.contentSaves?.find((row) => row.raidSave) ?? option.contentSaves?.[0] ?? null;
}
export type IneligibleCharacterOption = {
  characterId: string;
  characterName: string;
  realm: string;
  reason: string;
  message: string;
  /** Present only when reason is "ALREADY_SELECTED_OTHER_RUN". */
  conflictingRunTitle?: string;
};
type ActiveBoosterOffers = {
  characterIds: string[];
  offeredRolesByCharacterId: Record<string, CharacterRole[]>;
};
type ActiveLootbuddy = {
  signupId: string;
  wowClass: WowClass | null;
  mode: "LOOT_ONLY" | "PLAYING";
};
type SignupOptionsPayload = {
  run: {
    title: string;
    signupWindowOpen: boolean;
    difficulty: "NORMAL" | "HEROIC" | "MYTHIC";
    totalBossCount: number;
    lootType: RunLootType;
  };
  booster: { eligible: EligibleCharacterOption[]; ineligible: IneligibleCharacterOption[] };
  activeBoosterOffers: ActiveBoosterOffers;
  activeLootbuddies: ActiveLootbuddy[];
};

/** Rendered once, right after the character-select step — the User should see which of their characters is double-booked before choosing. */
function describeReservationBlocked(ineligible: IneligibleCharacterOption[]): string[] {
  const blocked = ineligible.filter(
    (item) =>
      item.reason === "ALREADY_SELECTED_OTHER_RUN" || item.reason === "CHARACTER_UNAVAILABLE",
  );
  if (blocked.length === 0) return [];
  return [
    "",
    "Unavailable characters:",
    ...blocked.map((item) =>
      item.reason === "CHARACTER_UNAVAILABLE"
        ? `• ${item.characterName}-${item.realm}: marked unavailable for this difficulty this reset.`
        : `• ${item.characterName}-${item.realm}: already selected for ${item.conflictingRunTitle ?? "another run"}.`,
    ),
  ];
}

/** Informational only — verified lockouts remain fully selectable. */
function describeSavedCharacters(
  eligible: EligibleCharacterOption[],
  run: Pick<SignupOptionsPayload["run"], "difficulty" | "totalBossCount" | "lootType">,
): string[] {
  const withLockout = eligible.filter((option) => primaryContentLockout(option)?.raidSave);
  if (withLockout.length === 0) return [];
  return [
    "",
    "Lockouts this reset:",
    ...withLockout.map((option) => {
      const row = primaryContentLockout(option)!;
      const label = formatTargetRaidLockoutLabel({
        difficulty: run.difficulty,
        totalBossCount: row.totalBossCount,
        raidSave: row.raidSave
          ? {
              raidId: "",
              difficulty: run.difficulty,
              resetIdentifier: "",
              bossesDefeated: row.raidSave.bossesDefeated,
              totalBossCount: row.raidSave.totalBossCount,
              isComplete: row.raidSave.isComplete,
            }
          : null,
        lootType: run.lootType,
      });
      return `• ${option.characterName} — ${label.text}`;
    }),
  ];
}
type OfferResult = { created: number; reactivated: number; withdrawn: number; kept: number };
/** The subset of a Discord reply-capable interaction every handler here needs — real button and select interactions both satisfy it. */
type ReplyableInteraction = {
  user: { id: string };
  editReply: (payload: InteractionEditReplyOptions) => Promise<unknown>;
};

/**
 * One option per Character, BOOSTER only. The label shows the Character's
 * currently offered roles, or its specialization-derived default, for
 * information only — selecting this menu only stages the choice (see
 * `handleCharacterSelect`); nothing is persisted until Confirm.
 */
export function buildCharacterSelectOptions(
  eligible: EligibleCharacterOption[],
  activeOffer: ActiveBoosterOffers,
  run?: Pick<SignupOptionsPayload["run"], "difficulty" | "totalBossCount" | "lootType">,
): StringSelectMenuOptionBuilder[] {
  const activeIds = new Set(activeOffer.characterIds);
  return eligible.slice(0, MAX_SELECT_OPTIONS).map((option) => {
    const existingRoles = activeOffer.offeredRolesByCharacterId[option.characterId] ?? [];
    const roleLabel = existingRoles.length > 0
      ? existingRoles.map((role) => ROLE_LABELS[role]).join("/")
      : option.defaultRole
        ? `${ROLE_LABELS[option.defaultRole]} (default)`
        : null;
    const builder = new StringSelectMenuOptionBuilder()
      .setLabel(roleLabel ? `${option.characterName}-${option.realm} — ${roleLabel}` : `${option.characterName}-${option.realm}`)
      .setValue(option.characterId)
      .setDefault(activeIds.has(option.characterId));
    // Informational only — a saved Character is still fully selectable.
    const lockoutRow = primaryContentLockout(option);
    if (lockoutRow?.raidSave && run) {
      const label = formatTargetRaidLockoutLabel({
        difficulty: run.difficulty,
        totalBossCount: lockoutRow.totalBossCount,
        raidSave: {
          raidId: "",
          difficulty: run.difficulty,
          resetIdentifier: "",
          bossesDefeated: lockoutRow.raidSave.bossesDefeated,
          totalBossCount: lockoutRow.raidSave.totalBossCount,
          isComplete: lockoutRow.raidSave.isComplete,
        },
        lootType: run.lootType,
      });
      builder.setDescription(label.text.slice(0, 100));
    } else if (lockoutRow?.raidSave) {
      builder.setDescription(`${lockoutRow.raidSave.bossesDefeated}/${lockoutRow.raidSave.totalBossCount}`);
    }
    return builder;
  });
}

/** A Character whose class can perform only one role never needs a chosen default guessed — the role is a fact of its class, not a preference. */
function singleRoleFallback(option: EligibleCharacterOption): CharacterRole | null {
  return option.roles.length === 1 ? option.roles[0] : null;
}

/**
 * The Signup button: shows an ephemeral multi-select of eligible Characters.
 * Nothing is persisted by opening this menu — submitting it only stages a
 * configuration session (see `handleCharacterSelect`).
 */
export async function handleSignupButton(interaction: ButtonInteraction, api: BotApiClient, runId: string): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  let options: SignupOptionsPayload;
  try {
    options = (await api.getSignupOptions(runId, interaction.user.id)) as SignupOptionsPayload;
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error) });
    return;
  }

  if (!options.run.signupWindowOpen) {
    await interaction.editReply({ content: "Signups are closed for this run." });
    return;
  }

  const { eligible, ineligible } = options.booster;
  const reservationLines = describeReservationBlocked(ineligible);

  if (eligible.length === 0) {
    await interaction.editReply({
      content: ["You have no eligible booster characters for this run.", ...reservationLines].join("\n"),
    });
    return;
  }

  const selectOptions = buildCharacterSelectOptions(eligible, options.activeBoosterOffers, options.run);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId("signup", runId))
    .setPlaceholder("Select characters to offer, then configure roles")
    .setMinValues(0)
    .setMaxValues(selectOptions.length)
    .addOptions(selectOptions);

  await interaction.editReply({
    content: [
      `Select the characters to offer for **${options.run.title}**. You'll confirm roles before anything is saved.`,
      ...describeSavedCharacters(eligible, options.run),
      ...reservationLines,
    ].join("\n"),
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

/**
 * The Character select's submission. Stages a configuration session instead
 * of persisting anything — each selected Character's role set resolves to
 * its existing offer's roles, else its specialization default, else (for a
 * single-role class) the only role it can perform, else stays unresolved
 * until the User picks at least one in the role editor.
 */
export async function handleCharacterSelect(interaction: StringSelectMenuInteraction, api: BotApiClient, runId: string): Promise<void> {
  await interaction.deferUpdate();

  let options: SignupOptionsPayload;
  try {
    options = (await api.getSignupOptions(runId, interaction.user.id)) as SignupOptionsPayload;
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error), components: [] });
    return;
  }

  const byId = new Map(options.booster.eligible.map((option) => [option.characterId, option]));
  const isExistingSignup = options.activeBoosterOffers.characterIds.length > 0;

  const session = startSession({
    discordUserId: interaction.user.id,
    runId,
    isExistingSignup,
    offers: interaction.values.map((characterId) => {
      const option = byId.get(characterId);
      const existing = options.activeBoosterOffers.offeredRolesByCharacterId[characterId];
      if (existing?.length) {
        return { characterId, offeredRoles: orderedRoles(existing) };
      }
      const fallback = option?.defaultRole ?? (option ? singleRoleFallback(option) : null);
      return { characterId, offeredRoles: fallback ? [fallback] : [] };
    }),
  });

  await renderCharacterSelectionStep(interaction, api, runId, session);
}

/**
 * Intermediate step after the Character multi-select: lists the staged
 * Characters and waits for an explicit Next before opening the role editor.
 */
async function renderCharacterSelectionStep(
  interaction: ReplyableInteraction,
  api: BotApiClient,
  runId: string,
  session: StagedBoosterSession,
): Promise<void> {
  let options: SignupOptionsPayload;
  try {
    options = (await api.getSignupOptions(runId, interaction.user.id)) as SignupOptionsPayload;
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error), components: [] });
    return;
  }

  const byId = new Map(options.booster.eligible.map((option) => [option.characterId, option]));
  const staged = [...session.offers.keys()];
  const lines =
    staged.length === 0
      ? ["No characters selected. Continue to clear your booster signup on this run, or cancel."]
      : [
          `Selected for **${options.run.title}**:`,
          ...staged.map((characterId) => {
            const option = byId.get(characterId);
            return `• ${option ? `${option.characterName}-${option.realm}` : characterId}`;
          }),
          "",
          "Click **Next** to choose roles.",
        ];

  await interaction.editReply({
    content: lines.join("\n"),
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildCustomId("signup-next", runId))
          .setLabel("Next")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(buildCustomId("signup-discard", runId))
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

/** Next: opens the role editor for the staged Character set. */
export async function handleSignupNextButton(interaction: ButtonInteraction, api: BotApiClient, runId: string): Promise<void> {
  await interaction.deferUpdate();
  const session = getSession(interaction.user.id, runId);
  if (!session) {
    await interaction.editReply({
      content: "This signup editor has expired. Click Signup again to continue.",
      components: [],
    });
    return;
  }
  await renderStagingEditor(interaction, api, runId, session);
}

/**
 * Renders the staging editor from session state only — never from what's
 * persisted. One role select per staged Character whose class can perform
 * more than one role (a longer tail points to the Web dialog rather than
 * capping the product-wide offer count); single-role Characters are listed
 * as read-only text since there is nothing to choose. Confirm/Cancel are
 * always present once at least the character-select step has run, even
 * with zero Characters staged (Confirm then clears the signup).
 */
async function renderStagingEditor(
  interaction: ReplyableInteraction,
  api: BotApiClient,
  runId: string,
  session: StagedBoosterSession,
  errorMessage?: string,
): Promise<void> {
  let options: SignupOptionsPayload;
  try {
    options = (await api.getSignupOptions(runId, interaction.user.id)) as SignupOptionsPayload;
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error), components: [] });
    return;
  }

  const byId = new Map(options.booster.eligible.map((option) => [option.characterId, option]));
  const staged = [...session.offers.entries()];

  const hybrids = staged
    .map(([characterId, roles]) => ({ characterId, roles, option: byId.get(characterId) }))
    .filter((entry) => (entry.option?.roles?.length ?? 0) > 1);
  const singleRole = staged
    .map(([characterId, roles]) => ({ characterId, roles, option: byId.get(characterId) }))
    .filter((entry) => (entry.option?.roles?.length ?? 0) <= 1);

  const shownHybrids = hybrids.slice(0, MAX_ROLE_SELECT_ROWS);
  // One multi-value select per hybrid: a Character may volunteer for several
  // roles at once, and the Raid Lead picks exactly one of them later.
  const roleRows = shownHybrids.map(({ characterId, roles, option }) => {
    const candidates = orderedRoles(option?.roles ?? []);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(buildCharacterScopedCustomId("signup-role", runId, characterId))
      .setPlaceholder(`Roles for ${option?.characterName ?? "character"}`)
      .setMinValues(1)
      .setMaxValues(Math.max(candidates.length, 1))
      .addOptions(
        candidates.map((candidate) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${option?.characterName}-${option?.realm}: ${ROLE_LABELS[candidate]}`)
            .setValue(candidate)
            .setDefault(roles.includes(candidate)),
        ),
      );
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  });

  const confirmLabel = session.isExistingSignup ? "Confirm Changes" : "Confirm Signup";
  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId("signup-confirm", runId))
      .setLabel(confirmLabel)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(buildCustomId("signup-discard", runId))
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  const remaining = hybrids.length - shownHybrids.length;
  const lines: string[] = [];
  if (errorMessage) lines.push(`⚠️ ${errorMessage}`);
  lines.push(
    staged.length === 0
      ? "No characters selected — confirming will clear your booster signup on this run."
      : `Choose every role each character can fill, then ${confirmLabel.toLowerCase()}.`,
  );
  if (singleRole.length > 0) {
    lines.push(
      singleRole
        .map(({ characterId, option }) => {
          const role = option?.roles?.[0];
          return `• ${option?.characterName ?? characterId}-${option?.realm ?? ""}: ${role ? ROLE_LABELS[role] : "—"} (fixed)`;
        })
        .join("\n"),
    );
  }
  const unresolved = staged.filter(([, roles]) => roles.length === 0);
  if (unresolved.length > 0) {
    lines.push(
      `Choose at least one role for: ${unresolved
        .map(([characterId]) => byId.get(characterId)?.characterName ?? characterId)
        .join(", ")}.`,
    );
  }
  if (remaining > 0) {
    lines.push(`${remaining} more character${remaining === 1 ? "" : "s"} can have their roles changed from the Web signup dialog.`);
  }

  await interaction.editReply({
    content: lines.join("\n"),
    components: [...roleRows, buttonRow],
  });
}

/** One per-Character role select's submission. Updates the staged session only — no Bot API mutation until Confirm. */
export async function handleRoleSelect(
  interaction: StringSelectMenuInteraction,
  api: BotApiClient,
  runId: string,
  characterId: string,
): Promise<void> {
  await interaction.deferUpdate();
  const roles = orderedRoles(interaction.values as CharacterRole[]);

  const updated = setStagedRoles(interaction.user.id, runId, characterId, roles);
  if (!updated) {
    await interaction.editReply({
      content: "This signup editor has expired. Click Signup again to continue.",
      components: [],
    });
    return;
  }

  const session = getSession(interaction.user.id, runId)!;
  await renderStagingEditor(interaction, api, runId, session);
}

/**
 * Confirm: the one and only point where a staged BOOSTER configuration is
 * persisted, via a single `setCharacterOffers` call carrying the complete
 * staged desired set. A failed call keeps the session so the User can fix
 * and retry rather than losing their configuration. Never touches the
 * User's Lootbuddy entries on this Run.
 */
export async function handleConfirmSignupButton(interaction: ButtonInteraction, api: BotApiClient, runId: string): Promise<void> {
  await interaction.deferUpdate();

  const session = getSession(interaction.user.id, runId);
  if (!session) {
    await interaction.editReply({
      content: "This signup editor has expired. Click Signup again to continue.",
      components: [],
    });
    return;
  }

  const unresolved = [...session.offers.entries()].filter(([, roles]) => roles.length === 0);
  if (unresolved.length > 0) {
    await renderStagingEditor(
      interaction,
      api,
      runId,
      session,
      "Choose at least one role for every character before confirming.",
    );
    return;
  }

  const offers = [...session.offers.entries()].map(([characterId, offeredRoles]) => ({ characterId, offeredRoles }));

  try {
    const result = await api.setCharacterOffers(runId, interaction.user.id, { offers });
    discardSession(interaction.user.id, runId);
    await interaction.editReply({ content: describeOfferResult(result, offers.length), components: [] });
    requestImmediateSync();
  } catch (error) {
    await renderStagingEditor(interaction, api, runId, session, describeBotApiError(error));
  }
}

/** Cancel: discards the staged editor only. Never touches persisted signup state — this is not the "Cancel Signup" button. */
export async function handleDiscardSignupButton(interaction: ButtonInteraction, runId: string): Promise<void> {
  await interaction.deferUpdate();
  discardSession(interaction.user.id, runId);
  await interaction.editReply({ content: "Signup changes cancelled.", components: [] });
}

export function describeOfferResult(result: OfferResult, offerCount: number): string {
  if (offerCount === 0) {
    return "Your offers for this run were cleared.";
  }
  const active = result.created + result.reactivated + result.kept;
  return `Signed up with ${active} character${active === 1 ? "" : "s"} offered.`;
}

//#region Lootbuddy — two-step Discord signup (class → done)

function classSelectMenu(customId: string, placeholder: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(CLASS_ORDER.length)
    .addOptions(CLASS_ORDER.map((wowClass) => new StringSelectMenuOptionBuilder().setLabel(CLASS_LABELS[wowClass]).setValue(wowClass)));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

const STALE_LOOTBUDDY_WIZARD_MESSAGE =
  "Lootbuddy signup is now just: pick class(es). Click **Sign as Lootbuddy** again. To leave, use **Cancel Signup**.";

/**
 * Sign as Lootbuddy: shows a multi class select immediately. Choosing
 * class(es) persists one LOOT_ONLY entry per class (replacing any previous
 * Discord lootbuddy set). Withdrawal is via Cancel Signup — not this button.
 */
export async function handleLootbuddyButton(interaction: ButtonInteraction, api: BotApiClient, runId: string): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  let options: SignupOptionsPayload;
  try {
    options = (await api.getSignupOptions(runId, interaction.user.id)) as SignupOptionsPayload;
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error) });
    return;
  }

  if (!options.run.signupWindowOpen && options.activeLootbuddies.length === 0) {
    await interaction.editReply({ content: "Signups are closed for this run." });
    return;
  }

  if (!options.run.signupWindowOpen) {
    await interaction.editReply({
      content: [
        `You are already signed as lootbuddy for **${options.run.title}**.`,
        "Signups are closed, so classes cannot be changed. Use **Cancel Signup** to leave.",
      ].join("\n"),
    });
    return;
  }

  const current =
    options.activeLootbuddies.length > 0
      ? options.activeLootbuddies
          .map((entry) => CLASS_LABELS[(entry.wowClass ?? "WARRIOR") as WowClass] ?? entry.wowClass)
          .join(", ")
      : null;

  await interaction.editReply({
    content: [
      `Choose one or more classes to sign as lootbuddy for **${options.run.title}**.`,
      current ? `Currently signed: ${current}. Your selection replaces it.` : null,
      "To leave later, use **Cancel Signup**.",
    ]
      .filter(Boolean)
      .join("\n"),
    components: [classSelectMenu(buildCustomId("lootbuddy-class-select", runId), "Choose class(es)")],
  });
}

/**
 * Class multi-select: persists immediately as one LOOT_ONLY entry per class.
 * Replaces the User's previous lootbuddy set for this Run.
 */
export async function handleLootbuddyClassSelect(
  interaction: StringSelectMenuInteraction,
  api: BotApiClient,
  runId: string,
): Promise<void> {
  await interaction.deferUpdate();
  const wowClasses = interaction.values as WowClass[];
  const labels = wowClasses.map((wowClass) => CLASS_LABELS[wowClass]).join(", ");

  try {
    await api.setLootbuddies(runId, interaction.user.id, {
      lootbuddies: wowClasses.map((wowClass) => ({ wowClass, mode: DISCORD_LOOTBUDDY_MODE })),
    });
    await interaction.editReply({
      content: `Signed up as lootbuddy (**${labels}**). Use **Cancel Signup** to leave.`,
      components: [],
    });
    requestImmediateSync();
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error), components: [] });
  }
}

/** Legacy multi-step wizard buttons — redirect to the two-step flow. */
export async function handleStaleLootbuddyWizardButton(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferUpdate();
  await interaction.editReply({ content: STALE_LOOTBUDDY_WIZARD_MESSAGE, components: [] });
}

/** Legacy multi-step wizard selects — redirect to the two-step flow. */
export async function handleStaleLootbuddyWizardSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  await interaction.deferUpdate();
  await interaction.editReply({ content: STALE_LOOTBUDDY_WIZARD_MESSAGE, components: [] });
}

export function describeLootbuddyResult(entryCount: number): string {
  if (entryCount === 0) {
    return "Your lootbuddy entries for this run were cleared.";
  }
  return `Signed up with ${entryCount} lootbuddy entr${entryCount === 1 ? "y" : "ies"}.`;
}

//#endregion
