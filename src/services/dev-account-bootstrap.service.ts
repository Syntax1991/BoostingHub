import {
  getDevAdminDiscordUserId,
  isDevAccountBootstrapEnabled,
  isProductionRuntime,
} from "@/auth/dev-auth";
import { devAccountBootstrapRepository } from "@/repositories/dev-account-bootstrap.repository";
import { userRepository } from "@/repositories/user.repository";

export type DevAccountBootstrapInput = { userId: string };

function uniqueViolation(error: unknown): boolean {
  return error instanceof Error && /unique|duplicate|constraint/i.test(error.message);
}

/**
 * Core bootstrap logic — throws on misconfiguration instead of silently
 * doing nothing, so a broken dev setup fails loudly. `bootstrapDevelopmentAccount`
 * below is the safe wrapper actually wired into Better Auth; call this
 * directly only to assert the configuration-failure behavior itself.
 */
export async function bootstrapDevelopmentAccountOrThrow(input: DevAccountBootstrapInput): Promise<void> {
  if (isProductionRuntime() || !isDevAccountBootstrapEnabled()) {
    return;
  }

  const targetDiscordUserId = getDevAdminDiscordUserId();
  if (!targetDiscordUserId) {
    throw new Error(
      "Development account bootstrap is enabled (DEV_ACCOUNT_BOOTSTRAP_ENABLED=true) but " +
        "DEV_ADMIN_DISCORD_USER_ID is not configured. Set it in .env, or disable bootstrap.",
    );
  }

  // Never trust a hook-provided discordUserId — re-read the authoritative,
  // already-persisted User row by id and compare the immutable Discord
  // snowflake exactly.
  const user = await userRepository.findById(input.userId);
  if (!user || user.discordUserId !== targetDiscordUserId) {
    return;
  }

  try {
    await devAccountBootstrapRepository.restoreDevAdminAccount(input.userId);
  } catch (error) {
    if (!uniqueViolation(error)) throw error;
    await devAccountBootstrapRepository.restoreDevAdminAccount(input.userId);
  }
}

/**
 * Development-only: after a Discord sign-in persists/updates its User row,
 * restores the ONE explicitly-configured account to ADMIN/ACTIVE with
 * APPROVED NORMAL/HEROIC/MYTHIC Booster qualifications. Wired as Better
 * Auth's `databaseHooks.session.create.after` (see auth.ts) — fires once per
 * sign-in, covering both a brand-new User (first Discord sign-in after a DB
 * reset) and an existing one whose privileges were wiped, without a separate
 * first-login code path.
 *
 * No-op (0 writes) when disabled, in production, for a non-matching user, or
 * on a misconfigured target ID. Never creates a User itself, never logs
 * ActivityEvent rows, and never throws — a misconfigured local dev setup must
 * never break a real sign-in.
 */
export async function bootstrapDevelopmentAccount(input: DevAccountBootstrapInput): Promise<void> {
  try {
    await bootstrapDevelopmentAccountOrThrow(input);
  } catch (error) {
    console.error("[dev-account-bootstrap] development account bootstrap failed:", error);
  }
}
