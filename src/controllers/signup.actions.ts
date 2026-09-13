"use server";

import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { signupService } from "@/services/signup.service";
import {
  boosterSignupSchema,
  cancelSignupSchema,
  setCharacterOffersSchema,
  setLootbuddiesSchema,
  signupOptionsSchema,
  withdrawSignupSchema,
} from "@/validators/signup";

type SignupOptions = Awaited<ReturnType<typeof signupService.getSignupOptions>>;

/**
 * Signup mutations resolve the authenticated user server-side.
 * Client-supplied userId / status / eligibility flags are ignored.
 */
export async function getSignupOptionsAction(
  input: unknown,
): Promise<ActionResult & { data: SignupOptions | null }> {
  try {
    const user = await requireUser();
    const parsed = signupOptionsSchema.parse(input);
    const data = await signupService.getSignupOptions(user, parsed.runId);
    return { ok: true, message: "Options loaded.", data };
  } catch (error) {
    return { ...mapActionError(error), data: null };
  }
}

export async function createBoosterSignupAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = boosterSignupSchema.parse(input);
    await signupService.createBoosterSignup(user, parsed);
    return { ok: true, message: "Signed up as booster." };
  } catch (error) {
    return mapActionError(error);
  }
}

/**
 * The complete desired BOOSTER Character-offer set for one Run. Replaces the
 * granular create/withdraw actions for the Web signup dialog — one submit
 * reconciles the whole set instead of one request per Character. Never
 * touches the User's Lootbuddy entries — see `setLootbuddiesAction`.
 */
export async function setCharacterOffersAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = setCharacterOffersSchema.parse(input);
    await signupService.setCharacterOffers(user, parsed);
    return {
      ok: true,
      message:
        parsed.offers.length === 0
          ? "Booster offers cleared."
          : `Booster offers updated (${parsed.offers.length} character${parsed.offers.length === 1 ? "" : "s"} offered).`,
    };
  } catch (error) {
    return mapActionError(error);
  }
}

/**
 * The complete desired LOOTBUDDY entry set for one Run — a distinct
 * collection from Booster offers. Never touches Booster rows — see
 * `setCharacterOffersAction`.
 */
export async function setLootbuddiesAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = setLootbuddiesSchema.parse(input);
    await signupService.setLootbuddies(user, parsed);
    return {
      ok: true,
      message:
        parsed.lootbuddies.length === 0
          ? "Lootbuddy entries cleared."
          : `Lootbuddy entries updated (${parsed.lootbuddies.length} entr${parsed.lootbuddies.length === 1 ? "y" : "ies"}).`,
    };
  } catch (error) {
    return mapActionError(error);
  }
}

/** Withdraws the User's entire active BOOSTER offer-set for a Run in one atomic step. Never touches Lootbuddy entries. */
export async function cancelBoosterSignupAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = cancelSignupSchema.parse(input);
    await signupService.cancelBoosterSignup(user, parsed);
    return { ok: true, message: "Booster signup cancelled." };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function withdrawSignupAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = withdrawSignupSchema.parse(input);
    await signupService.withdrawSignup(user, parsed.signupId);
    return { ok: true, message: "Signup withdrawn." };
  } catch (error) {
    return mapActionError(error);
  }
}
