import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { pgPool } from "@/lib/pg-pool";
import { isDevAuthEnabled, isDiscordOAuthConfigured } from "@/auth/dev-auth";
import { resolveBetterAuthBaseURL } from "@/auth/better-auth-base-url";
import {
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "@/auth/session-policy";
import { bootstrapDevelopmentAccount } from "@/services/dev-account-bootstrap.service";

export { SESSION_EXPIRES_IN_SECONDS, SESSION_UPDATE_AGE_SECONDS };

/**
 * Better Auth owns session/account rows via its built-in Kysely PostgreSQL adapter.
 * Domain queries go through Prisma 8. Both use the shared `pgPool` so they cannot
 * exhaust the hosted connection limit against each other.
 *
 * Better Auth's Prisma adapter still targets Prisma 7's client API, so it is not
 * used with Prisma 8.
 *
 * Session policy (Better Auth 1.7.3):
 * - expiresIn: 30 days (sliding lifetime)
 * - updateAge: 1 day (refresh threshold while active)
 * - cookieCache: left disabled (default) so revocation is immediately authoritative
 *
 * OAuth provider tokens (Discord Account rows) are encrypted at rest when
 * account.encryptOAuthTokens is true. Better Auth still reads legacy plaintext
 * tokens via isLikelyEncrypted() — no manual rewrite required.
 */
const discord = isDiscordOAuthConfigured()
  ? {
      discord: {
        clientId: process.env.DISCORD_CLIENT_ID!,
        clientSecret: process.env.DISCORD_CLIENT_SECRET!,
        mapProfileToUser: (profile: {
          id: string;
          username: string;
          global_name?: string | null;
          image_url?: string | null;
        }) => ({
          name: profile.global_name || profile.username,
          image: profile.image_url ?? undefined,
          discordUserId: profile.id,
          discordUsername: profile.username,
        }),
      },
    }
  : {};

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: resolveBetterAuthBaseURL(),
  database: pgPool,
  emailAndPassword: {
    enabled: isDevAuthEnabled(),
    minPasswordLength: 8,
  },
  socialProviders: discord,
  session: {
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },
  account: {
    encryptOAuthTokens: true,
  },
  user: {
    additionalFields: {
      discordUserId: {
        type: "string",
        required: false,
        input: true,
      },
      discordUsername: {
        type: "string",
        required: false,
        input: true,
      },
      accountStatus: {
        type: "string",
        required: false,
        defaultValue: "ACTIVE",
        input: false,
      },
      accountRole: {
        type: "string",
        required: false,
        defaultValue: "USER",
        input: false,
      },
    },
  },
  advanced: {
    database: {
      generateId: () => crypto.randomUUID(),
    },
  },
  // Fires once per sign-in (new or returning user) — see
  // dev-account-bootstrap.service.ts for what this restores and why
  // session.create is the seam that covers both cases.
  databaseHooks: {
    session: {
      create: {
        after: (session) => bootstrapDevelopmentAccount({ userId: session.userId }),
      },
    },
  },
  plugins: [nextCookies()],
});
