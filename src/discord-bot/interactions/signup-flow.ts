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

type EligibleCharacterOption = { characterId: string; characterName: string; realm: string; role?: string };
type ActiveOffer = { participationType: "BOOSTER" | "LOOTBUDDY" | null; characterIds: string[]; roleByCharacterId: Record<string, string> };
type SignupOptionsPayload = {
  run: { title: string; signupWindowOpen: boolean };
  booster: { eligible: EligibleCharacterOption[]; ineligible: unknown[] };
  lootbuddy: { eligible: EligibleCharacterOption[]; ineligible: unknown[] };
  activeOffer: ActiveOffer;
};

/**
 * One option per Character. A Character's signup role is never a Discord
 * choice — the server already derived BOOSTER's role from the Character's
 * current specialization (one eligible role per Character, shown here for
 * information only); LOOTBUDDY has no role dimension.
 */
export function buildCharacterSelectOptions(
  eligible: EligibleCharacterOption[],
  participationType: "BOOSTER" | "LOOTBUDDY",
  activeOffer: ActiveOffer,
): StringSelectMenuOptionBuilder[] {
  const activeIds = new Set(activeOffer.participationType === participationType ? activeOffer.characterIds : []);
  return eligible.slice(0, MAX_SELECT_OPTIONS).map((option) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(option.role ? `${option.characterName}-${option.realm} — ${option.role}` : `${option.characterName}-${option.realm}`)
      .setValue(option.characterId)
      .setDefault(activeIds.has(option.characterId)),
  );
}

/**
 * The Signup / Sign as Lootbuddy button: shows an ephemeral multi-select of
 * eligible Characters. Submitting the select is the final step — there is no
 * role choice, so no second interaction is needed.
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
 * The Character select's own submission is the final step for both
 * participation types — role is never sent from Discord; the server derives
 * it from each Character's current specialization for BOOSTER.
 */
export async function handleCharacterSelect(
  interaction: StringSelectMenuInteraction,
  api: BotApiClient,
  runId: string,
  participationType: "BOOSTER" | "LOOTBUDDY",
): Promise<void> {
  await interaction.deferUpdate();
  const offers = interaction.values.map((characterId) => ({ characterId }));
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
