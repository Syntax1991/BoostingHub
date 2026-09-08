import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { Pool } from "pg";
import { isDevAuthEnabled, isDiscordOAuthConfigured } from "@/auth/dev-auth";

/**
 * Better Auth owns session/account rows via its built-in Kysely PostgreSQL adapter.
 * Domain queries go through Prisma 8. Both share DATABASE_URL; they must not drift
 * on the `user` table shape.
 *
 * Better Auth's Prisma adapter still targets Prisma 7's client API, so it is not
 * used with Prisma 8.
 */
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

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
  database: new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("sslmode=") ? { rejectUnauthorized: false } : undefined,
  }),
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
  plugins: [nextCookies()],
});
