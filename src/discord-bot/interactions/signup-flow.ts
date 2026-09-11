import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { BotApiClient } from "@/discord-bot/bot-api-client";
import { buildCustomId } from "@/discord-bot/custom-ids";
import { describeBotApiError } from "@/discord-bot/interactions/error-copy";

const MAX_SELECT_OPTIONS = 25;
/** Discord allows at most 5 action rows per message; one row is reserved for the Confirm button. */
const MAX_ROLE_SELECTS = 4;
const SESSION_TTL_MS = 15 * 60 * 1000;

type EligibleCharacterOption = { characterId: string; characterName: string; realm: string; role?: string };
type ActiveOffer = { participationType: "BOOSTER" | "LOOTBUDDY" | null; characterIds: string[]; roleByCharacterId: Record<string, string> };
type SignupOptionsPayload = {
  run: { title: string; signupWindowOpen: boolean };
  booster: { eligible: EligibleCharacterOption[]; ineligible: unknown[] };
  lootbuddy: { eligible: EligibleCharacterOption[]; ineligible: unknown[] };
  activeOffer: ActiveOffer;
};

/** A BOOSTER signup pending a role choice for at least one hybrid Character, keyed by the ephemeral message id. */
type PendingBoosterSignup = {
  runId: string;
  discordUserId: string;
  offers: Map<string, string>;
  createdAt: number;
};

const pendingSignups = new Map<string, PendingBoosterSignup>();

function pruneExpiredSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [messageId, session] of pendingSignups) {
    if (session.createdAt < cutoff) {
      pendingSignups.delete(messageId);
    }
  }
}

/** Step 1 (both BOOSTER and LOOTBUDDY): one option per unique Character, no role dimension yet. */
export function buildCharacterSelectOptions(
  eligible: EligibleCharacterOption[],
  participationType: "BOOSTER" | "LOOTBUDDY",
  activeOffer: ActiveOffer,
): StringSelectMenuOptionBuilder[] {
  const activeIds = new Set(activeOffer.participationType === participationType ? activeOffer.characterIds : []);
  const seen = new Set<string>();
  const options: StringSelectMenuOptionBuilder[] = [];
  for (const option of eligible) {
    if (seen.has(option.characterId) || options.length >= MAX_SELECT_OPTIONS) continue;
    seen.add(option.characterId);
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(`${option.characterName}-${option.realm}`)
        .setValue(option.characterId)
        .setDefault(activeIds.has(option.characterId)),
    );
  }
  return options;
}

/** Folds BOOSTER's flattened (Character, role) rows back into one entry per Character, listing its eligible roles. */
export function groupRolesByCharacter(
  eligible: EligibleCharacterOption[],
): Map<string, { characterName: string; realm: string; roles: string[] }> {
  const grouped = new Map<string, { characterName: string; realm: string; roles: string[] }>();
  for (const option of eligible) {
    const role = option.role ?? "DPS";
    const entry = grouped.get(option.characterId);
    if (!entry) {
      grouped.set(option.characterId, { characterName: option.characterName, realm: option.realm, roles: [role] });
    } else if (!entry.roles.includes(role)) {
      entry.roles.push(role);
    }
  }
  return grouped;
}

/** Step 2 (BOOSTER only, hybrid Characters only): one option per eligible role for a single Character. */
export function buildRoleSelectOptions(roles: string[], defaultRole: string): StringSelectMenuOptionBuilder[] {
  return roles.map((role) =>
    new StringSelectMenuOptionBuilder().setLabel(role).setValue(role).setDefault(role === defaultRole),
  );
}

/**
 * The Signup / Sign as Lootbuddy button: shows an ephemeral multi-select of
 * eligible Characters (no role dimension yet — BOOSTER's role choice, for any
 * hybrid Character, happens as a second step once Characters are picked).
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
    content:
      `Select the characters to offer for **${options.run.title}**, then submit. This replaces your current offers for this run.` +
      (participationType === "BOOSTER" ? " You'll pick a role next for any character eligible for more than one." : ""),
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

/** LOOTBUDDY has no role dimension, so its Character select is also the final submit — no second step. */
export async function handleLootbuddySelect(
  interaction: StringSelectMenuInteraction,
  api: BotApiClient,
  runId: string,
): Promise<void> {
  await interaction.deferUpdate();
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
}

/**
 * BOOSTER step 1 submit: Characters with exactly one eligible role are
 * submitted immediately (no ambiguity, no extra round trip). Any Character
 * eligible for more than one role moves to step 2 — a role select per
 * hybrid Character plus a Confirm button, seeded with the User's current
 * role for that Character where still valid.
 */
export async function handleCharacterStepSelect(
  interaction: StringSelectMenuInteraction,
  api: BotApiClient,
  runId: string,
): Promise<void> {
  await interaction.deferUpdate();
  pruneExpiredSessions();

  const selectedCharacterIds = interaction.values;
  if (selectedCharacterIds.length === 0) {
    try {
      const result = await api.setCharacterOffers(runId, interaction.user.id, { participationType: "BOOSTER", offers: [] });
      await interaction.editReply({ content: describeOfferResult(result, 0), components: [] });
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

  const rolesByCharacter = groupRolesByCharacter(options.booster.eligible);
  const isActiveBooster = options.activeOffer.participationType === "BOOSTER";

  const offers = new Map<string, string>();
  const hybridCharacterIds: string[] = [];
  for (const characterId of selectedCharacterIds) {
    const entry = rolesByCharacter.get(characterId);
    if (!entry || entry.roles.length === 0) continue;
    if (entry.roles.length === 1) {
      offers.set(characterId, entry.roles[0]);
      continue;
    }
    const currentRole = isActiveBooster ? options.activeOffer.roleByCharacterId[characterId] : undefined;
    offers.set(characterId, currentRole && entry.roles.includes(currentRole) ? currentRole : entry.roles[0]);
    hybridCharacterIds.push(characterId);
  }

  if (hybridCharacterIds.length === 0) {
    try {
      const result = await api.setCharacterOffers(runId, interaction.user.id, {
        participationType: "BOOSTER",
        offers: Array.from(offers, ([characterId, role]) => ({ characterId, role })),
      });
      await interaction.editReply({ content: describeOfferResult(result, offers.size), components: [] });
    } catch (error) {
      await interaction.editReply({ content: describeBotApiError(error), components: [] });
    }
    return;
  }

  pendingSignups.set(interaction.message.id, {
    runId,
    discordUserId: interaction.user.id,
    offers,
    createdAt: Date.now(),
  });

  const shown = hybridCharacterIds.slice(0, MAX_ROLE_SELECTS);
  const truncated = hybridCharacterIds.length > MAX_ROLE_SELECTS;

  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = shown.map((characterId) => {
    const entry = rolesByCharacter.get(characterId)!;
    const menu = new StringSelectMenuBuilder()
      .setCustomId(buildCustomId("signup-role", runId, characterId))
      .setPlaceholder(`Role for ${entry.characterName}-${entry.realm}`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(buildRoleSelectOptions(entry.roles, offers.get(characterId)!));
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  });

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(buildCustomId("signup-confirm", runId)).setLabel("Confirm").setStyle(ButtonStyle.Primary),
    ),
  );

  await interaction.editReply({
    content:
      "Choose a role for each character below (defaults to your current or first eligible role), then press Confirm." +
      (truncated
        ? ` Only the first ${MAX_ROLE_SELECTS} characters needing a role choice are shown; the rest were assigned their current or default role automatically.`
        : ""),
    components: rows,
  });
}

/**
 * BOOSTER step 2: a single Character's role select. Updates the pending
 * session only — Discord's own client reflects the chosen option, and the
 * Confirm button reads the freshest session state, so no message re-render
 * is needed here.
 */
export async function handleRoleSelect(
  interaction: StringSelectMenuInteraction,
  runId: string,
  characterId: string,
): Promise<void> {
  await interaction.deferUpdate();
  const session = pendingSignups.get(interaction.message.id);
  if (!session || session.discordUserId !== interaction.user.id || session.runId !== runId) {
    await interaction.editReply({ content: "This signup session has expired. Please click Signup again.", components: [] });
    return;
  }
  const [role] = interaction.values;
  session.offers.set(characterId, role);
}

/** BOOSTER step 2 submit: the select menus' own submissions only update the session; this is the actual write. */
export async function handleSignupConfirm(interaction: ButtonInteraction, api: BotApiClient, runId: string): Promise<void> {
  await interaction.deferUpdate();
  const session = pendingSignups.get(interaction.message.id);
  if (!session || session.discordUserId !== interaction.user.id || session.runId !== runId) {
    await interaction.editReply({ content: "This signup session has expired. Please click Signup again.", components: [] });
    return;
  }
  pendingSignups.delete(interaction.message.id);

  try {
    const result = await api.setCharacterOffers(runId, interaction.user.id, {
      participationType: "BOOSTER",
      offers: Array.from(session.offers, ([characterId, role]) => ({ characterId, role })),
    });
    await interaction.editReply({ content: describeOfferResult(result, session.offers.size), components: [] });
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
