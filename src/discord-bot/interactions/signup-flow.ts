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
type SignupOptionsPayload = {
  run: { title: string; signupWindowOpen: boolean };
  booster: { eligible: EligibleCharacterOption[]; ineligible: unknown[] };
  lootbuddy: { eligible: EligibleCharacterOption[]; ineligible: unknown[] };
  activeOffer: { participationType: "BOOSTER" | "LOOTBUDDY" | null; characterIds: string[] };
};

/**
 * The Signup / Sign as Lootbuddy button: shows an ephemeral multi-select of
 * eligible Characters, preselecting whatever the User already has active.
 * Role is resolved server-side to each Character's own specialization by
 * default — offering a non-default role for a hybrid class stays a Web-only
 * refinement for this MVP rather than a second Discord interaction round.
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

  const preselected = new Set(
    options.activeOffer.participationType === participationType ? options.activeOffer.characterIds : [],
  );
  const action = participationType === "BOOSTER" ? "signup" : "lootbuddy";
  const limited = eligible.slice(0, MAX_SELECT_OPTIONS);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(action, runId))
    .setPlaceholder("Select characters to offer, then submit")
    .setMinValues(0)
    .setMaxValues(limited.length)
    .addOptions(
      limited.map((option) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${option.characterName}-${option.realm}`)
          .setValue(option.characterId)
          .setDefault(preselected.has(option.characterId))
          .setDescription(option.role ? `Offered as ${option.role}` : "Lootbuddy"),
      ),
    );

  await interaction.editReply({
    content: `Select the characters to offer for **${options.run.title}**, then submit. This replaces your current offers for this run.`,
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
