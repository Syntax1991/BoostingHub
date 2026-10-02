import { resolveBetterAuthBaseURL } from "@/auth/better-auth-base-url";
import { runDetailPath, type RunDetailTab } from "@/lib/run-routes";

/**
 * Absolute site URL for a root-relative path.
 * Returns null when the canonical origin is missing or not http(s), so callers
 * can omit the link instead of failing Discord sync or other optional navigation.
 */
export function absoluteAppUrl(path: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!path.startsWith("/")) return null;
  try {
    const base = resolveBetterAuthBaseURL(env).replace(/\/+$/, "");
    const url = new URL(`${base}${path}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Absolute canonical Run page. Null when the public origin cannot be resolved. */
export function absoluteRunUrl(
  runId: string,
  tab?: RunDetailTab,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const id = runId.trim();
  if (!id) return null;
  return absoluteAppUrl(runDetailPath(id, tab), env);
}
