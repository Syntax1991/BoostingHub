import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { BotApiClient } from "@/discord-bot/bot-api-client";
import { buildCharacterScopedCustomId, buildCustomId } from "@/discord-bot/custom-ids";
import { describeBotApiError } from "@/discord-bot/interactions/error-copy";

const MAX_SELECT_OPTIONS = 25;
/** Discord allows at most 5 action rows per message; every row here is a per-Character role select. */
const MAX_ROLE_SELECT_ROWS = 5;

type CharacterRole = "TANK" | "HEALER" | "DPS";
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
type ActiveOffer = {
  participationType: "BOOSTER" | "LOOTBUDDY" | null;
  characterIds: string[];
  roleByCharacterId: Record<string, CharacterRole>;
};
type SignupOptionsPayload = {
  run: { title: string; signupWindowOpen: boolean };
  booster: { eligible: EligibleCharacterOption[]; ineligible: unknown[] };
  lootbuddy: { eligible: EligibleCharacterOption[]; ineligible: unknown[] };
  activeOffer: ActiveOffer;
};
type OfferResult = { created: number; reactivated: number; withdrawn: number; kept: number };

/**
 * One option per Character. For BOOSTER, the label shows the Character's
 * current or specialization-derived default role for information only — the
 * User can still change it afterward via the per-Character role select
 * rendered once the offer is submitted (see `renderRoleAdjustment`).
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

/**
 * The Signup / Sign as Lootbuddy button: shows an ephemeral multi-select of
 * eligible Characters. Submitting it applies each selected Character's
 * existing or specialization-derived default role immediately; a follow-up
 * per-Character role select (shown right after) lets the User change any of
 * them without a second round trip through this menu.
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

  const eligible = participationType === "BOOSTER" ? options.booster.eligible : options.lootbuddy.eligible;
  if (eligible.length === 0) {
    await interaction.editReply({
      content: "You have no eligible characters for this offer type on this run.",
    });
    return;
  }

  const selectOptions = buildCharacterSelectOptions(eligible, participationType, options.activeOffer);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(participationType === "BOOSTER" ? "signup" : "lootbuddy", runId))
    .setPlaceholder("Select characters to offer, then submit")
    .setMinValues(0)
    .setMaxValues(selectOptions.length)
    .addOptions(selectOptions);

  await interaction.editReply({
    content: `Select the characters to offer for **${options.run.title}**, then submit. This replaces your current offers for this run.`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

/**
 * The Character select's submission. For BOOSTER, resolves each selected
 * Character's role as its existing offer's role, else its specialization
 * default, else omitted entirely — the server is the sole authority and
 * rejects a genuinely ambiguous Character (`INVALID_CHARACTER_ROLE`) rather
 * than this code guessing one. LOOTBUDDY carries no role dimension.
 */
export async function handleCharacterSelect(
  interaction: StringSelectMenuInteraction,
  api: BotApiClient,
  runId: string,
  participationType: "BOOSTER" | "LOOTBUDDY",
): Promise<void> {
  await interaction.deferUpdate();

  let offers: Array<{ characterId: string; role?: CharacterRole }>;
  if (participationType === "BOOSTER") {
    let options: SignupOptionsPayload;
    try {
      options = (await api.getSignupOptions(runId, interaction.user.id)) as SignupOptionsPayload;
    } catch (error) {
      await interaction.editReply({ content: describeBotApiError(error), components: [] });
      return;
    }
    const byId = new Map(options.booster.eligible.map((option) => [option.characterId, option]));
    offers = interaction.values.map((characterId) => {
      const existingRole = options.activeOffer.roleByCharacterId[characterId];
      const role = existingRole ?? byId.get(characterId)?.defaultRole ?? undefined;
      return role ? { characterId, role } : { characterId };
    });
  } else {
    offers = interaction.values.map((characterId) => ({ characterId }));
  }

  try {
    const result = await api.setCharacterOffers(runId, interaction.user.id, {
      participationType,
      offers,
      ...(participationType === "LOOTBUDDY" ? { lootbuddyMode: "LOOT_ONLY", lootbuddyVerification: "NONE" } : {}),
    });

    if (participationType === "BOOSTER" && offers.length > 0) {
      await renderRoleAdjustment(interaction, api, runId, result, offers.length);
      return;
    }

    await interaction.editReply({ content: describeOfferResult(result, offers.length), components: [] });
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error), components: [] });
  }
}

/**
 * Shown right after a BOOSTER offer is applied: one role select per offered
 * Character whose class can perform more than one role, each defaulted to
 * its now-current role. Fully stateless — every render re-fetches the
 * authoritative offer from the server rather than tracking anything between
 * interactions, so there is no session to expire or go stale.
 */
async function renderRoleAdjustment(
  interaction: StringSelectMenuInteraction,
  api: BotApiClient,
  runId: string,
  result: OfferResult,
  offerCount: number,
): Promise<void> {
  let options: SignupOptionsPayload;
  try {
    options = (await api.getSignupOptions(runId, interaction.user.id)) as SignupOptionsPayload;
  } catch {
    await interaction.editReply({ content: describeOfferResult(result, offerCount), components: [] });
    return;
  }

  const offeredIds = new Set(
    options.activeOffer.participationType === "BOOSTER" ? options.activeOffer.characterIds : [],
  );
  const hybrids = options.booster.eligible.filter(
    (option) => offeredIds.has(option.characterId) && (option.roles?.length ?? 0) > 1,
  );

  if (hybrids.length === 0) {
    await interaction.editReply({ content: describeOfferResult(result, offerCount), components: [] });
    return;
  }

  const shown = hybrids.slice(0, MAX_ROLE_SELECT_ROWS);
  const rows = shown.map((option) => {
    const currentRole = options.activeOffer.roleByCharacterId[option.characterId] ?? option.defaultRole ?? undefined;
    const menu = new StringSelectMenuBuilder()
      .setCustomId(buildCharacterScopedCustomId("signup-role", runId, option.characterId))
      .setPlaceholder(`Role for ${option.characterName}`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        orderedRoles(option.roles ?? []).map((role) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${option.characterName}-${option.realm}: ${ROLE_LABELS[role]}`)
            .setValue(role)
            .setDefault(role === currentRole),
        ),
      );
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  });

  const remaining = hybrids.length - shown.length;
  const truncatedNote =
    remaining > 0
      ? `\n${remaining} more character${remaining === 1 ? "" : "s"} can have their role changed from the Web signup dialog.`
      : "";

  await interaction.editReply({
    content: `${describeOfferResult(result, offerCount)} You can change a role below.${truncatedNote}`,
    components: rows,
  });
}

/**
 * One per-Character role select's submission. Rebuilds the User's complete
 * current desired offer set from the server and replaces only this one
 * Character's role — `setCharacterOffers` is not additive, so every other
 * offered Character's role must be resent unchanged.
 */
export async function handleRoleSelect(
  interaction: StringSelectMenuInteraction,
  api: BotApiClient,
  runId: string,
  characterId: string,
): Promise<void> {
  await interaction.deferUpdate();
  const role = interaction.values[0] as CharacterRole;

  let options: SignupOptionsPayload;
  try {
    options = (await api.getSignupOptions(runId, interaction.user.id)) as SignupOptionsPayload;
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error), components: [] });
    return;
  }

  if (
    options.activeOffer.participationType !== "BOOSTER" ||
    !options.activeOffer.characterIds.includes(characterId)
  ) {
    await interaction.editReply({
      content: "This signup has changed since this menu was shown. Click Signup again to continue.",
      components: [],
    });
    return;
  }

  const offers = options.activeOffer.characterIds.map((id) => ({
    characterId: id,
    role: id === characterId ? role : options.activeOffer.roleByCharacterId[id],
  }));

  try {
    const result = await api.setCharacterOffers(runId, interaction.user.id, {
      participationType: "BOOSTER",
      offers,
    });
    await renderRoleAdjustment(interaction, api, runId, result, offers.length);
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error), components: [] });
  }
}

export function describeOfferResult(result: OfferResult, offerCount: number): string {
  if (offerCount === 0) {
    return "Your offers for this run were cleared.";
  }
  const active = result.created + result.reactivated + result.kept;
  return `Signed up with ${active} character${active === 1 ? "" : "s"} offered.`;
}
