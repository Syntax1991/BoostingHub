import { isProductionRuntime } from "@/auth/dev-auth";

/**
 * Canonical Better Auth base URL.
 *
 * Development may fall back to localhost when BETTER_AUTH_URL is unset.
 * Production must never silently use localhost — misconfigured cookie/origin
 * behavior is worse than a loud failure.
 */
export function resolveBetterAuthBaseURL(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.BETTER_AUTH_URL?.trim();
  if (configured) {
    return configured;
  }

  const production =
    env.NODE_ENV === "production" ||
    (env === process.env && isProductionRuntime());

  if (!production) {
    return "http://localhost:3000";
  }

  throw new Error(
    "BETTER_AUTH_URL must be set to the canonical production HTTPS origin. Silent localhost fallback is not allowed in production.",
  );
}
