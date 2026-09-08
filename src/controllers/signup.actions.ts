"use server";

import { requireUser } from "@/auth/session";
import { mapActionError, type ActionResult } from "@/lib/action-result";
import { signupService } from "@/services/signup.service";
import {
  boosterSignupSchema,
  lootbuddySignupSchema,
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

export async function createLootbuddySignupAction(input: unknown): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = lootbuddySignupSchema.parse(input);
    await signupService.createLootbuddySignup(user, parsed);
    return { ok: true, message: "Signed up as lootbuddy." };
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
