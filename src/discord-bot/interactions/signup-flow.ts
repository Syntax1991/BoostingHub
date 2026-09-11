import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { BotApiClient } from "@/discord-bot/bot-api-client";
import { buildCustomId } from "@/discord-bot/custom-ids";
import { describeBotApiError } from "@/discord-bot/interactions/error-copy";

const MAX_SELECT_OPTIONS = 25;
/** Separator between characterId and role in a BOOSTER option's value — id shape never contains ":". */
const ROLE_SEPARATOR = ":";

type EligibleCharacterOption = { characterId: string; characterName: string; realm: string; role?: string };
type SignupOptionsPayload = {
  run: { title: string; signupWindowOpen: boolean };
  booster: { eligible: EligibleCharacterOption[]; ineligible: unknown[] };
  lootbuddy: { eligible: EligibleCharacterOption[]; ineligible: unknown[] };
  activeOffer: { participationType: "BOOSTER" | "LOOTBUDDY" | null; characterIds: string[]; roleByCharacterId: Record<string, string> };
};

/**
 * BOOSTER gets one option per (Character, eligible role) pair — the same
 * approach the Web dialog's original single-select used — so a hybrid class
 * (e.g. a Paladin eligible as TANK, HEALER, or DPS) is genuinely User-
 * selectable rather than silently defaulted to one role. LOOTBUDDY has no
 * role dimension, so it stays one option per Character. Discord's 25-option
 * cap is counted after this expansion, so a run with many hybrid-eligible
 * Characters may truncate — an accepted MVP tradeoff, not a silent one (the
 * menu still shows exactly what's selectable).
 */
export function buildSelectOptions(
  eligible: EligibleCharacterOption[],
  participationType: "BOOSTER" | "LOOTBUDDY",
  activeOffer: { participationType: "BOOSTER" | "LOOTBUDDY" | null; characterIds: string[]; roleByCharacterId: Record<string, string> },
): StringSelectMenuOptionBuilder[] {
  const isActiveType = activeOffer.participationType === participationType;

  if (participationType === "LOOTBUDDY") {
    const activeIds = new Set(isActiveType ? activeOffer.characterIds : []);
    return eligible.slice(0, MAX_SELECT_OPTIONS).map((option) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${option.characterName}-${option.realm}`)
        .setValue(option.characterId)
        .setDefault(activeIds.has(option.characterId)),
    );
  }

  return eligible.slice(0, MAX_SELECT_OPTIONS).map((option) => {
    const role = option.role ?? "DPS";
    const isCurrentRole = isActiveType && activeOffer.roleByCharacterId[option.characterId] === role;
    return new StringSelectMenuOptionBuilder()
      .setLabel(`${option.characterName}-${option.realm} (${role})`)
      .setValue(`${option.characterId}${ROLE_SEPARATOR}${role}`)
      .setDefault(isCurrentRole)
      .setDescription(`Offer as ${role}`);
  });
}

/** Inverse of buildSelectOptions' value encoding. LOOTBUDDY values are plain characterIds. */
export function parseSelectedOffers(
  values: string[],
  participationType: "BOOSTER" | "LOOTBUDDY",
): Array<{ characterId: string; role?: string }> {
  if (participationType === "LOOTBUDDY") {
    return values.map((characterId) => ({ characterId }));
  }
  return values.map((value) => {
    const [characterId, role] = value.split(ROLE_SEPARATOR);
    return { characterId, role };
  });
}

/**
 * The Signup / Sign as Lootbuddy button: shows an ephemeral multi-select of
 * eligible Characters (one option per eligible role for BOOSTER), preselecting
 * the User's current active offers.
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

  const action = participationType === "BOOSTER" ? "signup" : "lootbuddy";
  const selectOptions = buildSelectOptions(eligible, participationType, options.activeOffer);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(action, runId))
    .setPlaceholder("Select characters to offer, then submit")
    .setMinValues(0)
    .setMaxValues(selectOptions.length)
    .addOptions(selectOptions);

  const roleNote =
    participationType === "BOOSTER"
      ? " A Character eligible for more than one role appears once per role — pick the one you want to offer."
      : "";
  await interaction.editReply({
    content: `Select the characters to offer for **${options.run.title}**, then submit. This replaces your current offers for this run.${roleNote}`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

/** The select menu's own submission acts as the confirm step — no extra round trip. */
export async function handleCharacterSelect(
  interaction: StringSelectMenuInteraction,
  api: BotApiClient,
  runId: string,
  participationType: "BOOSTER" | "LOOTBUDDY",
): Promise<void> {
  await interaction.deferUpdate();

  const offers = parseSelectedOffers(interaction.values, participationType);
  try {
    const result = await api.setCharacterOffers(runId, interaction.user.id, {
      participationType,
      offers,
      ...(participationType === "LOOTBUDDY" ? { lootbuddyMode: "LOOT_ONLY", lootbuddyVerification: "NONE" } : {}),
    });
    await interaction.editReply({ content: describeOfferResult(result, offers.length), components: [] });
  } catch (error) {
    await interaction.editReply({ content: describeBotApiError(error), components: [] });
  }
}

export function describeOfferResult(
  result: { created: number; reactivated: number; withdrawn: number; kept: number },
  offerCount: number,
): string {
  if (offerCount === 0) {
    return "Your offers for this run were cleared.";
  }
  const active = result.created + result.reactivated + result.kept;
  return `Signed up with ${active} character${active === 1 ? "" : "s"} offered.`;
}
