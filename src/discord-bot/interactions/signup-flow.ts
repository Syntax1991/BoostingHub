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
  beginAddLootbuddy,
  beginEditLootbuddy,
  completePendingLootbuddy,
  discardSession,
  getSession,
  getLootbuddySession,
  removeLootbuddyEntry,
  setPendingLootbuddyClass,
  setStagedRole,
  startSession,
  startLootbuddySession,
  discardLootbuddySession,
  type CharacterRole,
  type LootbuddyMode,
  type StagedBoosterSession,
  type StagedLootbuddySession,
  type WowClass,
} from "@/discord-bot/interactions/signup-staging";
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
const MODE_ORDER: readonly LootbuddyMode[] = ["LOOT_ONLY", "PLAYING"];
const MODE_LABELS: Record<LootbuddyMode, string> = { LOOT_ONLY: "Loot only", PLAYING: "Play along" };

function orderedRoles(roles: CharacterRole[]): CharacterRole[] {
  return ROLE_ORDER.filter((role) => roles.includes(role));
}

type RaidSaveInfo = {
  bossesDefeated: number;
  totalBossCount: number;
  isComplete: boolean;
};
type EligibleCharacterOption = {
  characterId: string;
  characterName: string;
  realm: string;
  /** Every role this Character's class can perform. */
  roles: CharacterRole[];
  /** Specialization-derived default, or null when specialization is missing/unrecognized. */
  defaultRole: CharacterRole | null;
  /** Informational only — a saved Character remains fully selectable. */
  raidSave?: RaidSaveInfo | null;
};
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
  roleByCharacterId: Record<string, CharacterRole>;
};
type ActiveLootbuddy = {
  signupId: string;
  wowClass: WowClass | null;
  mode: LootbuddyMode;
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

/** Rendered once, right after the character-select step — the User should see which of their characters is double-booked, and where, before choosing. */
function describeReservationBlocked(ineligible: IneligibleCharacterOption[]): string[] {
  const blocked = ineligible.filter((item) => item.reason === "ALREADY_SELECTED_OTHER_RUN");
  if (blocked.length === 0) return [];
  return [
    "",
    "Unavailable characters:",
    ...blocked.map(
      (item) => `• ${item.characterName}-${item.realm}: already selected for ${item.conflictingRunTitle ?? "another run"}.`,
    ),
  ];
}

/** Informational only — verified lockouts remain fully selectable. */
function describeSavedCharacters(
  eligible: EligibleCharacterOption[],
  run: Pick<SignupOptionsPayload["run"], "difficulty" | "totalBossCount" | "lootType">,
): string[] {
  const withLockout = eligible.filter((option) => option.raidSave);
  if (withLockout.length === 0) return [];
  return [
    "",
    "Lockouts this reset:",
    ...withLockout.map((option) => {
      const label = formatTargetRaidLockoutLabel({
        difficulty: run.difficulty,
        totalBossCount: run.totalBossCount,
        raidSave: option.raidSave
          ? {
              raidId: "",
              difficulty: run.difficulty,
              resetIdentifier: "",
              bossesDefeated: option.raidSave.bossesDefeated,
              totalBossCount: option.raidSave.totalBossCount,
              isComplete: option.raidSave.isComplete,
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
 * current or specialization-derived default role for information only —
 * selecting this menu only stages the choice (see `handleCharacterSelect`);
 * nothing is persisted until Confirm.
 */
export function buildCharacterSelectOptions(
  eligible: EligibleCharacterOption[],
  activeOffer: ActiveBoosterOffers,
  run?: Pick<SignupOptionsPayload["run"], "difficulty" | "totalBossCount" | "lootType">,
): StringSelectMenuOptionBuilder[] {
  const activeIds = new Set(activeOffer.characterIds);
  return eligible.slice(0, MAX_SELECT_OPTIONS).map((option) => {
    const existingRole = activeOffer.roleByCharacterId[option.characterId];
    const roleLabel = existingRole
      ? ROLE_LABELS[existingRole]
      : option.defaultRole
        ? `${ROLE_LABELS[option.defaultRole]} (default)`
        : null;
    const builder = new StringSelectMenuOptionBuilder()
      .setLabel(roleLabel ? `${option.characterName}-${option.realm} — ${roleLabel}` : `${option.characterName}-${option.realm}`)
      .setValue(option.characterId)
      .setDefault(activeIds.has(option.characterId));
    // Informational only — a saved Character is still fully selectable.
    if (option.raidSave && run) {
      const label = formatTargetRaidLockoutLabel({
        difficulty: run.difficulty,
        totalBossCount: run.totalBossCount,
        raidSave: {
          raidId: "",
          difficulty: run.difficulty,
          resetIdentifier: "",
          bossesDefeated: option.raidSave.bossesDefeated,
          totalBossCount: option.raidSave.totalBossCount,
          isComplete: option.raidSave.isComplete,
        },
        lootType: run.lootType,
      });
      builder.setDescription(label.text.slice(0, 100));
    } else if (option.raidSave) {
      builder.setDescription(`${option.raidSave.bossesDefeated}/${option.raidSave.totalBossCount}`);
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
 * of persisting anything — each selected Character's role resolves to its
 * existing offer's role, else its specialization default, else (for a
 * single-role class) the only role it can perform, else stays unresolved
 * until the User picks one in the role editor.
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
      const role =
        options.activeBoosterOffers.roleByCharacterId[characterId] ??
        option?.defaultRole ??
        (option ? singleRoleFallback(option) : null) ??
        null;
      return { characterId, role };
    }),
  });

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
    .map(([characterId, role]) => ({ characterId, role, option: byId.get(characterId) }))
    .filter((entry) => (entry.option?.roles?.length ?? 0) > 1);
  const singleRole = staged
    .map(([characterId, role]) => ({ characterId, role, option: byId.get(characterId) }))
    .filter((entry) => (entry.option?.roles?.length ?? 0) <= 1);

  const shownHybrids = hybrids.slice(0, MAX_ROLE_SELECT_ROWS);
  const roleRows = shownHybrids.map(({ characterId, role, option }) => {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(buildCharacterScopedCustomId("signup-role", runId, characterId))
      .setPlaceholder(`Role for ${option?.characterName ?? "character"}`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        orderedRoles(option?.roles ?? []).map((candidate) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${option?.characterName}-${option?.realm}: ${ROLE_LABELS[candidate]}`)
            .setValue(candidate)
            .setDefault(candidate === role),
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
      : `Configure a role for each character, then ${confirmLabel.toLowerCase()}.`,
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
  const unresolved = staged.filter(([, role]) => !role);
  if (unresolved.length > 0) {
    lines.push(
      `Choose a role for: ${unresolved
        .map(([characterId]) => byId.get(characterId)?.characterName ?? characterId)
        .join(", ")}.`,
    );
  }
  if (remaining > 0) {
    lines.push(`${remaining} more character${remaining === 1 ? "" : "s"} can have their role changed from the Web signup dialog.`);
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
  const role = interaction.values[0] as CharacterRole;

  const updated = setStagedRole(interaction.user.id, runId, characterId, role);
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

  const unresolved = [...session.offers.entries()].filter(([, role]) => !role);
  if (unresolved.length > 0) {
    await renderStagingEditor(
      interaction,
      api,
      runId,
      session,
      "Choose a role for every character before confirming.",
    );
    return;
  }

  const offers = [...session.offers.entries()].map(([characterId, role]) => ({ characterId, role: role! }));

  try {
    const result = await api.setCharacterOffers(runId, interaction.user.id, { offers });
    discardSession(interaction.user.id, runId);
    await interaction.editReply({ content: describeOfferResult(result, offers.length), components: [] });
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

//#region Lootbuddy — characterless, N entries, its own staged wizard

function describeLootbuddyEntries(entries: StagedLootbuddySession["entries"]): string[] {
  if (entries.length === 0) return ["No lootbuddy entries staged yet."];
  return entries.map((entry, index) => `${index + 1}. ${CLASS_LABELS[entry.wowClass]} — ${MODE_LABELS[entry.mode]}`);
}

/**
 * Renders the staged summary — the home view of the Lootbuddy wizard.
 * Add/Edit/Remove/Confirm/Cancel fit in exactly one action row (Discord's
 * 5-button cap); Edit and Remove are omitted entirely when there is nothing
 * to edit or remove rather than shown disabled.
 */
async function renderLootbuddySummary(
  interaction: ReplyableInteraction,
  runId: string,
  session: StagedLootbuddySession,
  runTitle: string,
  errorMessage?: string,
): Promise<void> {
  const confirmLabel = session.entries.some((entry) => entry.signupId) ? "Confirm Changes" : "Confirm Signup";
  const buttons = [
    new ButtonBuilder().setCustomId(buildCustomId("lootbuddy-add", runId)).setLabel("Add Lootbuddy").setStyle(ButtonStyle.Primary),
  ];
  if (session.entries.length > 0) {
    buttons.push(
      new ButtonBuilder().setCustomId(buildCustomId("lootbuddy-edit", runId)).setLabel("Edit").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(buildCustomId("lootbuddy-remove", runId)).setLabel("Remove").setStyle(ButtonStyle.Secondary),
    );
  }
  buttons.push(
    new ButtonBuilder().setCustomId(buildCustomId("lootbuddy-confirm", runId)).setLabel(confirmLabel).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(buildCustomId("lootbuddy-discard", runId)).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );

  const lines: string[] = [];
  if (errorMessage) lines.push(`⚠️ ${errorMessage}`);
  lines.push(`Lootbuddies for **${runTitle}**:`, "", ...describeLootbuddyEntries(session.entries));

  await interaction.editReply({
    content: lines.join("\n"),
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)],
  });
}

function classSelectMenu(customId: string, placeholder: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(CLASS_ORDER.map((wowClass) => new StringSelectMenuOptionBuilder().setLabel(CLASS_LABELS[wowClass]).setValue(wowClass)));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function modeSelectMenu(customId: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("Choose a mode")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(MODE_ORDER.map((mode) => new StringSelectMenuOptionBuilder().setLabel(MODE_LABELS[mode]).setValue(mode)));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

const EXPIRED_LOOTBUDDY_MESSAGE = "This lootbuddy editor has expired. Click Sign as Lootbuddy again to continue.";

/**
 * The Sign as Lootbuddy button: starts (or resets) the staged session from
 * the User's current active entries and shows the summary view. Nothing is
 * persisted by opening this — only Confirm writes anything.
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

  const session = startLootbuddySession({
    discordUserId: interaction.user.id,
    runId,
    entries: options.activeLootbuddies.map((entry) => ({
      signupId: entry.signupId,
      wowClass: entry.wowClass ?? "WARRIOR",
      mode: entry.mode,
    })),
  });

  await renderLootbuddySummary(interaction, runId, session, options.run.title);
}

/** Add: begins the wizard for a brand-new entry and shows the Class step. */
export async function handleLootbuddyAddButton(interaction: ButtonInteraction, runId: string): Promise<void> {
  await interaction.deferUpdate();
  const session = beginAddLootbuddy(interaction.user.id, runId);
  if (!session) {
    await interaction.editReply({ content: EXPIRED_LOOTBUDDY_MESSAGE, components: [] });
    return;
  }
  await interaction.editReply({
    content: "Choose a class for the new lootbuddy entry.",
    components: [classSelectMenu(buildCustomId("lootbuddy-class-select", runId), "Choose a class")],
  });
}

/** Edit: shows a picker of existing staged entries; choosing one begins the wizard for that slot. */
export async function handleLootbuddyEditButton(interaction: ButtonInteraction, runId: string): Promise<void> {
  await interaction.deferUpdate();
  const session = getLootbuddySession(interaction.user.id, runId);
  if (!session || session.entries.length === 0) {
    await interaction.editReply({ content: EXPIRED_LOOTBUDDY_MESSAGE, components: [] });
    return;
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId("lootbuddy-edit-pick", runId))
    .setPlaceholder("Choose an entry to edit")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      session.entries.map((entry, index) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${index + 1}. ${CLASS_LABELS[entry.wowClass]} — ${MODE_LABELS[entry.mode]}`)
          .setValue(String(index)),
      ),
    );
  await interaction.editReply({
    content: "Choose which lootbuddy entry to edit.",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

/** The Edit picker's submission: begins the Class→Mode wizard for the chosen slot. */
export async function handleLootbuddyEditPickSelect(interaction: StringSelectMenuInteraction, runId: string): Promise<void> {
  await interaction.deferUpdate();
  const index = Number(interaction.values[0]);
  const session = beginEditLootbuddy(interaction.user.id, runId, index);
  if (!session) {
    await interaction.editReply({ content: EXPIRED_LOOTBUDDY_MESSAGE, components: [] });
    return;
  }
  await interaction.editReply({
    content: `Choose a new class for entry ${index + 1}.`,
    components: [classSelectMenu(buildCustomId("lootbuddy-class-select", runId), "Choose a class")],
  });
}

/** Remove: shows a picker of existing staged entries; choosing one removes it immediately and returns to the summary. */
export async function handleLootbuddyRemoveButton(interaction: ButtonInteraction, runId: string): Promise<void> {
  await interaction.deferUpdate();
  const session = getLootbuddySession(interaction.user.id, runId);
  if (!session || session.entries.length === 0) {
    await interaction.editReply({ content: EXPIRED_LOOTBUDDY_MESSAGE, components: [] });
    return;
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId("lootbuddy-remove-pick", runId))
    .setPlaceholder("Choose an entry to remove")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      session.entries.map((entry, index) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${index + 1}. ${CLASS_LABELS[entry.wowClass]} — ${MODE_LABELS[entry.mode]}`)
          .setValue(String(index)),
      ),
    );
  await interaction.editReply({
    content: "Choose which lootbuddy entry to remove.",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

/** The Remove picker's submission: removes that entry from the staged session (never persisted state) and returns to the summary. */
export async function handleLootbuddyRemovePickSelect(interaction: StringSelectMenuInteraction, api: BotApiClient, runId: string): Promise<void> {
  await interaction.deferUpdate();
  const index = Number(interaction.values[0]);
  const session = removeLootbuddyEntry(interaction.user.id, runId, index);
  if (!session) {
    await interaction.editReply({ content: EXPIRED_LOOTBUDDY_MESSAGE, components: [] });
    return;
  }
  let options: SignupOptionsPayload;
  try {
    options = (await api.getSignupOptions(runId, interaction.user.id)) as SignupOptionsPayload;
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error), components: [] });
    return;
  }
  await renderLootbuddySummary(interaction, runId, session, options.run.title);
}

/** The wizard's Class step submission — advances to the Mode step. */
export async function handleLootbuddyClassSelect(interaction: StringSelectMenuInteraction, runId: string): Promise<void> {
  await interaction.deferUpdate();
  const wowClass = interaction.values[0] as WowClass;
  const session = setPendingLootbuddyClass(interaction.user.id, runId, wowClass);
  if (!session) {
    await interaction.editReply({ content: EXPIRED_LOOTBUDDY_MESSAGE, components: [] });
    return;
  }
  await interaction.editReply({
    content: `${CLASS_LABELS[wowClass]} — now choose a mode.`,
    components: [modeSelectMenu(buildCustomId("lootbuddy-mode-select", runId))],
  });
}

/** The wizard's Mode step submission — completes the pending Add/Edit and returns to the summary. Nothing is persisted yet. */
export async function handleLootbuddyModeSelect(interaction: StringSelectMenuInteraction, api: BotApiClient, runId: string): Promise<void> {
  await interaction.deferUpdate();
  const mode = interaction.values[0] as LootbuddyMode;
  const session = completePendingLootbuddy(interaction.user.id, runId, mode);
  if (!session) {
    await interaction.editReply({ content: EXPIRED_LOOTBUDDY_MESSAGE, components: [] });
    return;
  }
  let options: SignupOptionsPayload;
  try {
    options = (await api.getSignupOptions(runId, interaction.user.id)) as SignupOptionsPayload;
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error), components: [] });
    return;
  }
  await renderLootbuddySummary(interaction, runId, session, options.run.title);
}

/**
 * Confirm: the one and only point where the staged Lootbuddy entry set is
 * persisted, via a single `setLootbuddies` call carrying the complete
 * desired set. A failed call keeps the session so the User can fix and
 * retry rather than losing their configuration. Never touches the User's
 * Booster offers on this Run.
 */
export async function handleLootbuddyConfirmButton(interaction: ButtonInteraction, api: BotApiClient, runId: string): Promise<void> {
  await interaction.deferUpdate();
  const session = getLootbuddySession(interaction.user.id, runId);
  if (!session) {
    await interaction.editReply({ content: EXPIRED_LOOTBUDDY_MESSAGE, components: [] });
    return;
  }

  const lootbuddies = session.entries.map((entry) => ({ signupId: entry.signupId, wowClass: entry.wowClass, mode: entry.mode }));

  try {
    await api.setLootbuddies(runId, interaction.user.id, { lootbuddies });
    discardLootbuddySession(interaction.user.id, runId);
    await interaction.editReply({ content: describeLootbuddyResult(lootbuddies.length), components: [] });
  } catch (error) {
    let options: SignupOptionsPayload;
    try {
      options = (await api.getSignupOptions(runId, interaction.user.id)) as SignupOptionsPayload;
    } catch {
      await interaction.editReply({ content: describeBotApiError(error), components: [] });
      return;
    }
    await renderLootbuddySummary(interaction, runId, session, options.run.title, describeBotApiError(error));
  }
}

/** Cancel: discards the staged editor only. Never touches persisted signup state. */
export async function handleLootbuddyDiscardButton(interaction: ButtonInteraction, runId: string): Promise<void> {
  await interaction.deferUpdate();
  discardLootbuddySession(interaction.user.id, runId);
  await interaction.editReply({ content: "Lootbuddy changes cancelled.", components: [] });
}

export function describeLootbuddyResult(entryCount: number): string {
  if (entryCount === 0) {
    return "Your lootbuddy entries for this run were cleared.";
  }
  return `Signed up with ${entryCount} lootbuddy entr${entryCount === 1 ? "y" : "ies"}.`;
}

//#endregion
