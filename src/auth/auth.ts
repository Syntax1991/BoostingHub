import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { pgPool } from "@/lib/pg-pool";
import { isDevAuthEnabled, isDiscordOAuthConfigured } from "@/auth/dev-auth";
import { bootstrapDevelopmentAccount } from "@/services/dev-account-bootstrap.service";

/**
 * Better Auth owns session/account rows via its built-in Kysely PostgreSQL adapter.
 * Domain queries go through Prisma 8. Both use the shared `pgPool` so they cannot
 * exhaust the hosted connection limit against each other.
 *
 * Better Auth's Prisma adapter still targets Prisma 7's client API, so it is not
 * used with Prisma 8.
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
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  database: pgPool,
  emailAndPassword: {
    enabled: isDevAuthEnabled(),
    minPasswordLength: 8,
  },
  socialProviders: discord,
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
