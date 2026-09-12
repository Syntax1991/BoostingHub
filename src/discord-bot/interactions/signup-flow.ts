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
  setStagedRole,
  startSession,
  type CharacterRole,
  type StagedBoosterSession,
} from "@/discord-bot/interactions/signup-staging";

const MAX_SELECT_OPTIONS = 25;
/** Discord allows at most 5 action rows per message; one row is reserved for the Confirm/Cancel buttons. */
const MAX_ROLE_SELECT_ROWS = 4;

const ROLE_ORDER: readonly CharacterRole[] = ["TANK", "HEALER", "DPS"];
const ROLE_LABELS: Record<CharacterRole, string> = { TANK: "Tank", HEALER: "Healer", DPS: "DPS" };

function orderedRoles(roles: CharacterRole[]): CharacterRole[] {
  return ROLE_ORDER.filter((role) => roles.includes(role));
}

type EligibleCharacterOption = {
  characterId: string;
  characterName: string;
  realm: string;
  /** Every role this Character's class can perform. Absent for LOOTBUDDY options. */
  roles?: CharacterRole[];
  /** Specialization-derived default, or null when specialization is missing/unrecognized. Absent for LOOTBUDDY. */
  defaultRole?: CharacterRole | null;
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
type ActiveOffer = {
  participationType: "BOOSTER" | "LOOTBUDDY" | null;
  characterIds: string[];
  roleByCharacterId: Record<string, CharacterRole>;
};
type SignupOptionsPayload = {
  run: { title: string; signupWindowOpen: boolean };
  booster: { eligible: EligibleCharacterOption[]; ineligible: IneligibleCharacterOption[] };
  lootbuddy: { eligible: EligibleCharacterOption[]; ineligible: IneligibleCharacterOption[] };
  activeOffer: ActiveOffer;
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
type OfferResult = { created: number; reactivated: number; withdrawn: number; kept: number };
/** The subset of a Discord reply-capable interaction every handler here needs — real button and select interactions both satisfy it. */
type ReplyableInteraction = {
  user: { id: string };
  editReply: (payload: InteractionEditReplyOptions) => Promise<unknown>;
};

/**
 * One option per Character. For BOOSTER, the label shows the Character's
 * current or specialization-derived default role for information only —
 * selecting this menu only stages the choice (see `handleCharacterSelect`);
 * nothing is persisted until Confirm.
 */
export function buildCharacterSelectOptions(
  eligible: EligibleCharacterOption[],
  participationType: "BOOSTER" | "LOOTBUDDY",
  activeOffer: ActiveOffer,
): StringSelectMenuOptionBuilder[] {
  const activeIds = new Set(activeOffer.participationType === participationType ? activeOffer.characterIds : []);
  return eligible.slice(0, MAX_SELECT_OPTIONS).map((option) => {
    const existingRole = activeOffer.roleByCharacterId[option.characterId];
    const roleLabel = existingRole
      ? ROLE_LABELS[existingRole]
      : option.defaultRole
        ? `${ROLE_LABELS[option.defaultRole]} (default)`
        : null;
    return new StringSelectMenuOptionBuilder()
      .setLabel(roleLabel ? `${option.characterName}-${option.realm} — ${roleLabel}` : `${option.characterName}-${option.realm}`)
      .setValue(option.characterId)
      .setDefault(activeIds.has(option.characterId));
  });
}

/** A Character whose class can perform only one role never needs a chosen default guessed — the role is a fact of its class, not a preference. */
function singleRoleFallback(option: EligibleCharacterOption): CharacterRole | null {
  return option.roles?.length === 1 ? option.roles[0] : null;
}

/**
 * The Signup / Sign as Lootbuddy button: shows an ephemeral multi-select of
 * eligible Characters. Nothing is persisted by opening this menu — for
 * BOOSTER, submitting it only stages a configuration session (see
 * `handleCharacterSelect`); for LOOTBUDDY, which has no role dimension to
 * configure, submitting it still applies immediately.
 */
export async function handleSignupButton(
  interaction: ButtonInteraction,
  api: BotApiClient,
  runId: string,
  participationType: "BOOSTER" | "LOOTBUDDY",
): Promise<void> {
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

  const ineligible = participationType === "BOOSTER" ? options.booster.ineligible : options.lootbuddy.ineligible;
  const eligible = participationType === "BOOSTER" ? options.booster.eligible : options.lootbuddy.eligible;
  const reservationLines = describeReservationBlocked(ineligible);

  if (eligible.length === 0) {
    await interaction.editReply({
      content: ["You have no eligible characters for this offer type on this run.", ...reservationLines].join("\n"),
    });
    return;
  }

  const selectOptions = buildCharacterSelectOptions(eligible, participationType, options.activeOffer);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(participationType === "BOOSTER" ? "signup" : "lootbuddy", runId))
    .setPlaceholder(
      participationType === "BOOSTER"
        ? "Select characters to offer, then configure roles"
        : "Select characters to offer, then submit",
    )
    .setMinValues(0)
    .setMaxValues(selectOptions.length)
    .addOptions(selectOptions);

  await interaction.editReply({
    content: [
      `Select the characters to offer for **${options.run.title}**.${
        participationType === "BOOSTER" ? " You'll confirm roles before anything is saved." : " This replaces your current offers for this run."
      }`,
      ...reservationLines,
    ].join("\n"),
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

/**
 * The Character select's submission. LOOTBUDDY has no role dimension and
 * still applies immediately. BOOSTER stages a configuration session instead
 * of persisting anything — each selected Character's role resolves to its
 * existing offer's role, else its specialization default, else (for a
 * single-role class) the only role it can perform, else stays unresolved
 * until the User picks one in the role editor.
 */
export async function handleCharacterSelect(
  interaction: StringSelectMenuInteraction,
  api: BotApiClient,
  runId: string,
  participationType: "BOOSTER" | "LOOTBUDDY",
): Promise<void> {
  await interaction.deferUpdate();

  if (participationType === "LOOTBUDDY") {
    const offers = interaction.values.map((characterId) => ({ characterId }));
    try {
      const result = await api.setCharacterOffers(runId, interaction.user.id, {
        participationType: "LOOTBUDDY",
        offers,
        lootbuddyMode: "LOOT_ONLY",
        lootbuddyVerification: "NONE",
      });
      await interaction.editReply({ content: describeOfferResult(result, offers.length), components: [] });
    } catch (error) {
      await interaction.editReply({ content: describeBotApiError(error), components: [] });
    }
    return;
  }

  let options: SignupOptionsPayload;
  try {
    options = (await api.getSignupOptions(runId, interaction.user.id)) as SignupOptionsPayload;
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error), components: [] });
    return;
  }

  const byId = new Map(options.booster.eligible.map((option) => [option.characterId, option]));
  const isExistingSignup =
    options.activeOffer.participationType === "BOOSTER" && options.activeOffer.characterIds.length > 0;

  const session = startSession({
    discordUserId: interaction.user.id,
    runId,
    isExistingSignup,
    offers: interaction.values.map((characterId) => {
      const option = byId.get(characterId);
      const role =
        options.activeOffer.roleByCharacterId[characterId] ??
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
      ? "No characters selected — confirming will clear your signup on this run."
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
 * and retry rather than losing their configuration.
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
    const result = await api.setCharacterOffers(runId, interaction.user.id, {
      participationType: "BOOSTER",
      offers,
    });
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
