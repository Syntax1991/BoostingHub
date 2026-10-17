import { timingSafeEqual } from "node:crypto";
import type { AuthenticatedUser } from "@/auth/authorization";
import { resolveBetterAuthBaseURL } from "@/auth/better-auth-base-url";
import { APP_BRAND_NAME } from "@/lib/branding";
import { DomainError } from "@/lib/errors";
import { userRepository } from "@/repositories/user.repository";

/**
 * Service-to-service authentication for the Discord bot process. This proves
 * only "this request came from our bot" — it grants access to the bot API
 * surface, never a domain-role bypass. Every mutation still runs normal
 * per-user authorization against the acting User resolved from a Discord ID.
 */
export function assertBotServiceAuthorized(request: Request): void {
  const expected = process.env.BOOSTINGHUB_BOT_API_TOKEN;
  if (!expected) {
    throw new DomainError("NOT_AUTHORIZED", "Bot API is not configured.", 503);
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!provided || !constantTimeEquals(provided, expected)) {
    throw new DomainError("NOT_AUTHORIZED", "Invalid bot credential.", 401);
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still perform a fixed-cost comparison so a length mismatch doesn't
    // return measurably faster than a same-length mismatch.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Resolves the Discord interaction's own user (never a client-supplied
 * BoostingHub userId) to the account that will perform the action. Discord
 * has already authenticated that this is genuinely that Discord member
 * before the bot ever saw the interaction — this call only maps identity,
 * it does not re-verify Discord's own signature.
 */
/** "You haven't logged in yet" copy with the website's dashboard link. */
export function notLinkedMessage(env: NodeJS.ProcessEnv = process.env): string {
  const dashboardUrl = `${resolveBetterAuthBaseURL(env).replace(/\/+$/, "")}/dashboard`;
  return `You haven't logged in to ${APP_BRAND_NAME} yet. Please go to ${dashboardUrl} and log in with Discord, then try again.`;
}

export async function resolveActingDiscordUser(discordUserId: string | null): Promise<AuthenticatedUser> {
  if (!discordUserId) {
    throw new DomainError("NOT_AUTHENTICATED", "Missing Discord user identity.", 401);
  }
  const user = await userRepository.findByDiscordUserId(discordUserId);
  if (!user) {
    // Shown to the member as-is in Discord: they only need to log in once on the website.
    throw new DomainError("DISCORD_ACCOUNT_NOT_LINKED", notLinkedMessage(), 404);
  }
  if (user.accountStatus !== "ACTIVE") {
    throw new DomainError("ACCOUNT_DISABLED", "This account is disabled.", 403);
  }
  return user;
}
